import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { DeviceInvalid, DeviceNotConnected } from "./errors.ts";
import type { GlucoseReading, GlucometerDevice } from "./types.ts";

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

function parseReadingDate(parts: string[]): Date {
  const [month, day, year, time] = parts;
  const monthIndex = MONTHS[month];
  if (monthIndex === undefined) {
    throw new DeviceInvalid(`Unknown month: ${month}`);
  }

  const [hour, minute] = time.split(":").map(Number);
  return new Date(Number(year), monthIndex, Number(day), hour, minute);
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
    const resp = await this.command("$xmem");

    if (resp[0] !== "") {
      throw new DeviceInvalid();
    }

    const readingsCount = Number(resp[4]);
    const rawDataset = resp.slice(5, 5 + readingsCount);
    const readings: GlucoseReading[] = [];

    for (const reading of rawDataset) {
      const [value, month, day, year, time, readingType] = reading.split(" ");
      readings.push({
        type: readingType as "G",
        value: Number(value),
        date: parseReadingDate([month, day, year, time]),
      });
    }

    return readings;
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
