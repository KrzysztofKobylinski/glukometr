import { SerialPort } from "serialport";
import { DeviceInvalid, DeviceNotConnected } from "./errors.ts";
import type {
  DeviceInfo,
  GlucoseReading,
  GlucometerDevice,
  MeterRecord,
} from "./types.ts";

const DEVICE_LABEL = "Diagnosis Diagnostic Gold";

async function readByte(port: SerialPort): Promise<number> {
  const data = await readExact(port, 1);
  if (data.length === 0) {
    throw new DeviceNotConnected("Device not responding");
  }
  return data[0];
}

function readExact(port: SerialPort, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received >= length) {
        cleanup();
        resolve(Buffer.concat(chunks).subarray(0, length));
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(Buffer.alloc(0));
    }, 1000);

    const cleanup = () => {
      clearTimeout(timer);
      port.off("data", onData);
      port.off("error", onError);
    };

    port.on("data", onData);
    port.on("error", onError);
  });
}

function checksum(data: Buffer | Uint8Array): number {
  let sum = 0;
  for (const byte of data) {
    sum ^= byte;
  }
  return sum;
}

export class DiagnosticGold implements GlucometerDevice {
  private port: SerialPort;

  constructor(path: string) {
    try {
      this.port = new SerialPort({
        path,
        baudRate: 38400,
      });
    } catch (error) {
      throw new DeviceNotConnected(String(error));
    }
  }

  async fetchAllRecords(timeoutSec = 5): Promise<MeterRecord[]> {
    const readings = await this.fetchData(timeoutSec);
    return readings.map((r) => ({
      kind: "glucose" as const,
      value: r.value,
      date: r.date,
    }));
  }

  getInfo(): DeviceInfo {
    return {
      label: DEVICE_LABEL,
      serialNumber: "",
      softwareVersion: "",
      glucoseUnits: "unknown",
      clockValid: false,
    };
  }

  async fetchData(timeoutSec = 5): Promise<GlucoseReading[]> {
    const endTime = Date.now() + timeoutSec * 1000;

    while (true) {
      try {
        const data = await this.readPacket();
        if (data.length > 0 && data[0] === 0x10) {
          break;
        }
      } catch (error) {
        if (error instanceof DeviceNotConnected && Date.now() >= endTime) {
          throw error;
        }
      }
    }

    await this.writePacket(Buffer.from([0x10, 0x40]));
    await this.readPacket();

    const readings: GlucoseReading[] = [];

    while (true) {
      await this.writePacket(Buffer.from([0x10, 0x60]));
      const data = await this.readPacket();

      if (data.length < 17) {
        break;
      }

      const dateYear = data[2];
      const dateMonth = data[3];
      const dateDay = data[4];
      const dateHour = data[5];
      const dateMinute = data[6];
      const value = data[8];

      readings.push({
        type: "G",
        value,
        date: new Date(2000 + dateYear, dateMonth - 1, dateDay, dateHour, dateMinute),
      });
    }

    return readings;
  }

  close(): void {
    this.port.close();
  }

  private async readPacket(): Promise<Buffer> {
    const start = await readExact(this.port, 1);
    if (start.length === 0 || start[0] === 0x00) {
      throw new DeviceNotConnected("Device not responding");
    }
    if (start[0] !== 0x53) {
      throw new DeviceInvalid(`Start byte invalid (${start.toString("hex")})`);
    }

    const direction = await readByte(this.port);
    if (direction !== 0x20) {
      throw new DeviceInvalid("Direction byte invalid");
    }

    const dataLength = await readByte(this.port);
    const data = await readExact(this.port, dataLength - 2);
    const chksum = await readByte(this.port);
    if (chksum !== checksum(data)) {
      throw new DeviceInvalid("Checksum invalid");
    }

    const end = await readByte(this.port);
    if (end !== 0xaa) {
      throw new DeviceInvalid("End byte invalid");
    }

    return data;
  }

  private writePacket(data: Buffer): Promise<void> {
    const packet = Buffer.concat([
      Buffer.from([0x53, 0x10, data.length + 2]),
      data,
      Buffer.from([checksum(data), 0xaa]),
    ]);

    return new Promise((resolve, reject) => {
      this.port.write(packet, (error) => {
        if (error) reject(new DeviceNotConnected(String(error)));
        else resolve();
      });
    });
  }
}
