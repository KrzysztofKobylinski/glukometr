import HID from "node-hid";
import { DeviceInvalid, DeviceNotConnected, GlucometerError } from "./errors.ts";
import type {
  DeviceInfo,
  GlucoseReading,
  GlucometerDevice,
  MeterRecord,
} from "./types.ts";

const ABBOTT_VENDOR_ID = 0x1a61;
const PRECISION_NEO_PRODUCT_ID = 0x3850;
const DEVICE_LABEL = "FreeStyle Precision Neo / Optium Neo";

const INIT_COMMAND = 0x01;
const INIT_RESPONSE = 0x71;
const KEEPALIVE_RESPONSE = 0x22;
const UNKNOWN_MESSAGE_RESPONSE = 0x30;
const TEXT_MESSAGE_TYPE = 0x60;

const TEXT_COMPLETION_RE = /CMD (?:OK|Fail!)/;
const TEXT_REPLY_FORMAT =
  /^(?<message>.*)CKSM:(?<checksum>[0-9A-F]{8})\r\nCMD (?<status>OK|Fail!)\r\n$/s;
const MULTIRECORDS_FORMAT =
  /^(?<message>.+\r\n)(?<count>[0-9]+),(?<checksum>[0-9A-F]{8})\r\n$/s;

const GLUCOSE_RECORD_TYPE = "7";
const KETONE_RECORD_TYPE = "9";
const INSULIN_RECORD_TYPE = "10";

const INSULIN_TYPE_LABELS: Record<string, string> = {
  "0": "Morning long-acting",
  "1": "Breakfast short-acting",
  "2": "Lunch short-acting",
  "3": "Evening long-acting",
  "4": "Dinner short-acting",
};

class HidSessionError extends GlucometerError {
  constructor(message: string) {
    super(message);
    this.name = "HidSessionError";
  }
}

function verifyChecksum(message: Buffer, expectedChecksumHex: string): void {
  const expected = Number.parseInt(expectedChecksumHex, 16);
  let calculated = 0;
  for (const byte of message) {
    calculated += byte;
  }
  if (expected !== calculated) {
    throw new HidSessionError(
      `Invalid checksum, expected ${expected}, calculated ${calculated}`,
    );
  }
}

function parseRecordDate(record: string[]): Date {
  const month = Number(record[2]);
  const day = Number(record[3]);
  const year = Number(record[4]);
  const hour = Number(record[5]);
  const minute = Number(record[6]);
  return new Date(2000 + year, month - 1, day, hour, minute);
}

function parseGlucoseUnits(value: string): DeviceInfo["glucoseUnits"] {
  if (value === "1") return "mg/dL";
  if (value === "0") return "mmol/L";
  return "unknown";
}

function parseClockFields(dateLine: string, timeLine: string): { clockValid: boolean; date?: Date } {
  const [month, day, year] = dateLine.split(",").map(Number);
  const [hour, minute] = timeLine.split(",").map(Number);
  if ([month, day, year, hour, minute].some((v) => v === 255 || Number.isNaN(v))) {
    return { clockValid: false };
  }
  return {
    clockValid: true,
    date: new Date(2000 + year, month - 1, day, hour, minute),
  };
}

class AbbottHidSession {
  private handle: HID.HID;

  constructor(vendorId: number, productId: number, devicePath?: string) {
    try {
      this.handle =
        devicePath !== undefined
          ? new HID.HID(devicePath)
          : new HID.HID(vendorId, productId);
    } catch (error) {
      throw new DeviceNotConnected(String(error));
    }
  }

  close(): void {
    this.handle.close();
  }

  private writeHid(packet: Buffer): void {
    const report = Buffer.alloc(65);
    report[0] = 0;
    packet.copy(report, 1, 0, Math.min(packet.length, 64));
    const written = this.handle.write(report);
    if (written < 0) {
      throw new HidSessionError(`HID write failed (${written})`);
    }
  }

  sendCommand(messageType: number, command: Buffer): void {
    const message = Buffer.alloc(64);
    message[0] = messageType;
    message[1] = command.length;
    command.copy(message, 2, 0, command.length);
    this.writeHid(message);
  }

  readResponse(): [number, Buffer] {
    while (true) {
      const usbPacket = Buffer.from(this.handle.readTimeout(5000));
      if (usbPacket.length === 0) {
        throw new DeviceNotConnected("Device not responding");
      }

      const messageType = usbPacket[0];
      if (messageType === KEEPALIVE_RESPONSE) {
        continue;
      }
      if (messageType === UNKNOWN_MESSAGE_RESPONSE) {
        throw new DeviceInvalid("Invalid command");
      }

      const messageLength = usbPacket[1];
      const messageContent = usbPacket.subarray(2, 2 + messageLength);
      return [messageType, messageContent];
    }
  }

  connect(): void {
    this.sendCommand(INIT_COMMAND, Buffer.alloc(0));
    const [responseType, response] = this.readResponse();
    if (responseType !== INIT_RESPONSE || !response.equals(Buffer.from([0x01]))) {
      throw new DeviceInvalid(
        `Unexpected init response ${responseType.toString(16)}:${response.toString("hex")}`,
      );
    }
  }

  sendTextCommandRaw(command: Buffer): Buffer {
    this.sendCommand(TEXT_MESSAGE_TYPE, command);

    let fullContent = Buffer.alloc(0);
    while (true) {
      const [messageType, content] = this.readResponse();
      if (messageType !== TEXT_MESSAGE_TYPE) {
        throw new DeviceInvalid(
          `Unexpected message type ${messageType.toString(16)}`,
        );
      }

      fullContent = Buffer.concat([fullContent, content]);
      if (TEXT_COMPLETION_RE.test(fullContent.toString("ascii"))) {
        break;
      }
    }

    const match = fullContent.toString("ascii").match(TEXT_REPLY_FORMAT);
    if (!match?.groups) {
      throw new DeviceInvalid(fullContent.toString("ascii"));
    }

    const message = Buffer.from(match.groups.message, "ascii");
    verifyChecksum(message, match.groups.checksum);

    if (match.groups.status !== "OK") {
      throw new DeviceInvalid(message.toString("ascii") || "Command failed");
    }

    return message;
  }

  queryText(command: string): string {
    return this.sendTextCommandRaw(Buffer.from(command)).toString("ascii").trim();
  }

  queryMultirecord(command: Buffer): string[][] {
    const message = this.sendTextCommandRaw(command);
    if (message.equals(Buffer.from("Log Empty\r\n"))) {
      return [];
    }

    const match = message.toString("ascii").match(MULTIRECORDS_FORMAT);
    if (!match?.groups) {
      throw new DeviceInvalid(message.toString("ascii"));
    }

    const recordsRaw = Buffer.from(match.groups.message, "ascii");
    verifyChecksum(recordsRaw, match.groups.checksum);

    return recordsRaw
      .toString("ascii")
      .split("\r\n")
      .filter(Boolean)
      .map((line) => parseCsvLine(line));
  }
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  fields.push(current);
  return fields;
}

function parseMeterRecord(record: string[]): MeterRecord | null {
  if (!record.length) return null;

  const date = parseRecordDate(record);

  if (record[0] === GLUCOSE_RECORD_TYPE) {
    const valueText = record[8];
    if (valueText === "HI" || valueText === "LO") return null;
    return { kind: "glucose", value: Number(valueText), date };
  }

  if (record[0] === KETONE_RECORD_TYPE) {
    return { kind: "ketone", valueMgDl: Number(record[8]), date };
  }

  if (record[0] === INSULIN_RECORD_TYPE) {
    const insulinType = INSULIN_TYPE_LABELS[record[8]] ?? `Type ${record[8]}`;
    return {
      kind: "insulin",
      units: Number(record[9]),
      insulinType,
      date,
    };
  }

  return null;
}

export class FreeStylePrecisionNeo implements GlucometerDevice {
  private session: AbbottHidSession;

  constructor(path?: string) {
    this.session = new AbbottHidSession(
      ABBOTT_VENDOR_ID,
      PRECISION_NEO_PRODUCT_ID,
      path,
    );
    this.session.connect();
  }

  fetchData(): GlucoseReading[] {
    return this.fetchAllRecords()
      .filter((r): r is Extract<MeterRecord, { kind: "glucose" }> => r.kind === "glucose")
      .map((r) => ({ type: "G" as const, value: r.value, date: r.date }));
  }

  fetchAllRecords(): MeterRecord[] {
    const records: MeterRecord[] = [];

    for (const record of this.session.queryMultirecord(Buffer.from("$result?"))) {
      const parsed = parseMeterRecord(record);
      if (parsed) records.push(parsed);
    }

    return records;
  }

  getInfo(): DeviceInfo {
    const softwareVersion = this.session.queryText("$swver?");
    const serialNumber = this.session.queryText("$serlnum?");
    const glucoseUnits = parseGlucoseUnits(this.session.queryText("$gunits?"));
    const marketLevel = this.session.queryText("$marketlev?");
    const patientName = this.session.queryText("$ptname?");
    const patientId = this.session.queryText("$ptid?");
    const clock = parseClockFields(
      this.session.queryText("$date?"),
      this.session.queryText("$time?"),
    );

    return {
      label: DEVICE_LABEL,
      serialNumber,
      softwareVersion,
      glucoseUnits,
      marketLevel,
      patientName: patientName || undefined,
      patientId: patientId || undefined,
      clockValid: clock.clockValid,
      date: clock.date,
    };
  }

  setDateTime(date: Date): void {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear() % 100;
    const hour = date.getHours();
    const minute = date.getMinutes();

    this.session.sendTextCommandRaw(
      Buffer.from(`$date,${month},${day},${year}`),
    );
    this.session.sendTextCommandRaw(
      Buffer.from(`$time,${hour},${minute}`),
    );
  }

  setPatient(name: string, id?: string): void {
    this.session.sendTextCommandRaw(Buffer.from(`$ptname,${name}`));
    if (id !== undefined) {
      this.session.sendTextCommandRaw(Buffer.from(`$ptid,${id}`));
    }
  }

  close(): void {
    this.session.close();
  }
}

type HidDeviceEntry = {
  path: string;
  create: (path: string) => GlucometerDevice;
};

export function listHidDevices(): HidDeviceEntry[] {
  const supported = new Map<number, HidDeviceEntry["create"]>([
    [PRECISION_NEO_PRODUCT_ID, (path) => new FreeStylePrecisionNeo(path)],
  ]);

  const results: HidDeviceEntry[] = [];

  for (const dev of HID.devices()) {
    if (dev.vendorId !== ABBOTT_VENDOR_ID || !dev.path) {
      continue;
    }

    const create = supported.get(dev.productId ?? 0);
    if (create) {
      results.push({ path: dev.path, create });
    }
  }

  return results;
}
