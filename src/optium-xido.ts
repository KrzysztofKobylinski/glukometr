import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { DeviceInvalid, DeviceNotConnected } from "./errors.ts";
import type {
  DeviceInfo,
  GlucoseReading,
  GlucometerDevice,
  MeterRecord,
} from "./types.ts";

const DEVICE_LABEL = "Abbott Optium Xido";

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function parseReadingDate(parts: string[]): Date {
  const [month, day, year, time] = parts;
  const monthIndex = MONTHS[month.trim()];
  if (monthIndex === undefined) {
    throw new DeviceInvalid(`Unknown month: ${month}`);
  }

  const [hour, minute] = time.split(":").map(Number);
  return new Date(Number(year), monthIndex, Number(day), hour, minute);
}

function parseColqClock(line: string): { clockValid: boolean; date?: Date } {
  const match = line.match(/^Clock:\s+(\w+)\s+(\d+)\s+(\d+)\s+(\d+:\d+:\d+)/);
  if (!match) return { clockValid: false };

  const [, month, day, year, time] = match;
  const monthIndex = MONTHS[month];
  if (monthIndex === undefined) return { clockValid: false };

  const [hour, minute, second] = time.split(":").map(Number);
  return {
    clockValid: true,
    date: new Date(Number(year), monthIndex, Number(day), hour, minute, second),
  };
}

export class OptiumXido implements GlucometerDevice {
  private port: SerialPort;
  private parser: ReadlineParser;
  private lines: string[] = [];
  private lineWaiters: Array<(line: string | null) => void> = [];

  constructor(path: string) {
    try {
      this.port = new SerialPort({ path, baudRate: 19200 });
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
      this.parser.on("data", (line: string) => {
        const waiter = this.lineWaiters.shift();
        if (waiter) {
          waiter(line);
        } else {
          this.lines.push(line);
        }
      });
    } catch (error) {
      throw new DeviceNotConnected(String(error));
    }
  }

  async fetchData(): Promise<GlucoseReading[]> {
    const records = await this.fetchAllRecords();
    return records
      .filter((r): r is Extract<MeterRecord, { kind: "glucose" }> => r.kind === "glucose")
      .map((r) => ({ type: "G" as const, value: r.value, date: r.date }));
  }

  async fetchAllRecords(): Promise<MeterRecord[]> {
    const resp = await this.command("$xmem");

    if (resp[0] !== "") {
      throw new DeviceInvalid();
    }

    const readingsCount = Number(resp[4]);
    const rawDataset = resp.slice(5, 5 + readingsCount);
    const records: MeterRecord[] = [];

    for (const reading of rawDataset) {
      const parts = reading.split(" ");
      const [valueText, month, day, year, time, readingType] = parts;
      const date = parseReadingDate([month, day, year, time]);

      if (readingType === "G") {
        records.push({ kind: "glucose", value: Number(valueText), date });
      } else if (readingType === "K") {
        records.push({ kind: "ketone", valueMgDl: Number(valueText), date });
      }
    }

    return records;
  }

  async getInfo(): Promise<DeviceInfo> {
    const resp = await this.command("$colq");
    const text = resp.join("\n");

    const serialMatch = text.match(/S\/N:\s+(\S+)/);
    const versionMatch = text.match(/Ver:\s+(\S+)\s+(\S+)/);
    const clockLine = resp.find((line) => line.startsWith("Clock:")) ?? "";
    const marketMatch = text.match(/Market:\s+(\S+)\s+(\S+)/);
    const clock = parseColqClock(clockLine);

    const unitText = versionMatch?.[2] ?? "";
    const glucoseUnits: DeviceInfo["glucoseUnits"] =
      unitText === "MMOL" ? "mmol/L" : unitText ? "mg/dL" : "unknown";

    return {
      label: DEVICE_LABEL,
      serialNumber: serialMatch?.[1] ?? "",
      softwareVersion: versionMatch?.[1] ?? "",
      glucoseUnits,
      marketLevel: marketMatch ? `${marketMatch[1]},${marketMatch[2]}` : undefined,
      clockValid: clock.clockValid,
      date: clock.date,
    };
  }

  async setDateTime(date: Date): Promise<void> {
    const month = MONTH_NAMES[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear() % 100;
    const hour = date.getHours();
    const minute = date.getMinutes();

    await this.command(`$tim,${month},${day},${year},${hour},${minute}`);
  }

  close(): void {
    this.port.close();
  }

  private readLine(timeoutMs = 5000): Promise<string | null> {
    const buffered = this.lines.shift();
    if (buffered !== undefined) {
      return Promise.resolve(buffered);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.lineWaiters.indexOf(resolve);
        if (index >= 0) this.lineWaiters.splice(index, 1);
        resolve(null);
      }, timeoutMs);

      this.lineWaiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  private async command(cmd: string): Promise<string[]> {
    await new Promise<void>((resolve, reject) => {
      this.port.write(`${cmd}\r\n`, (error) => {
        if (error) reject(new DeviceNotConnected(String(error)));
        else resolve();
      });
    });

    const resp: string[] = [];
    while (true) {
      const line = await this.readLine(100);
      if (line === null) {
        break;
      }
      resp.push(line.trim());
    }

    if (resp.length === 0) {
      throw new DeviceNotConnected("Device not responding");
    }

    return resp;
  }
}
