import HID from "node-hid";
import { DeviceInvalid, DeviceNotConnected, GlucometerError } from "./errors.ts";
import type { GlucoseReading, GlucometerDevice } from "./types.ts";

const ABBOTT_VENDOR_ID = 0x1a61;
const PRECISION_NEO_PRODUCT_ID = 0x3850;

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

  private sendTextCommandRaw(command: Buffer): Buffer {
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
    const readings: GlucoseReading[] = [];

    for (const record of this.session.queryMultirecord(Buffer.from("$result?"))) {
      if (!record.length || record[0] !== GLUCOSE_RECORD_TYPE) {
        continue;
      }

      const valueText = record[8];
      if (valueText === "HI" || valueText === "LO") {
        continue;
      }

      const month = Number(record[2]);
      const day = Number(record[3]);
      const year = Number(record[4]);
      const hour = Number(record[5]);
      const minute = Number(record[6]);
      const value = Number(valueText);

      readings.push({
        type: "G",
        value,
        date: new Date(2000 + year, month - 1, day, hour, minute),
      });
    }

    return readings;
  }

  close(): void {
    this.session.close();
  }
}

type DeviceEntry = {
  path: string;
  create: (path: string) => GlucometerDevice;
};

export function listHidDevices(): DeviceEntry[] {
  const supported = new Map<number, DeviceEntry["create"]>([
    [PRECISION_NEO_PRODUCT_ID, (path) => new FreeStylePrecisionNeo(path)],
  ]);

  const results: DeviceEntry[] = [];

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
