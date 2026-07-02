import { SerialPort } from "serialport";
import { OptiumXido } from "./optium-xido.ts";
import { listHidDevices } from "./abbott-hid.ts";
import type {
  DeviceEntry,
  DeviceInfo,
  GlucoseReading,
  GlucometerDevice,
  MeterRecord,
} from "./types.ts";

export { DeleteNotSupported, DeviceInvalid, DeviceNotConnected } from "./errors.ts";
export type { DeviceCapabilities, DeviceEntry, DeviceInfo, GlucoseReading, MeterRecord };

const SERIAL_DEVICES: Array<{
  vendorId: string;
  productId: string;
  label: string;
  create: (path: string) => GlucometerDevice;
}> = [
  {
    vendorId: "1a61",
    productId: "3420",
    label: "Abbott Optium Xido",
    create: (path) => new OptiumXido(path),
  },
];

export async function listDevices(): Promise<DeviceEntry[]> {
  const results: DeviceEntry[] = [];

  for (const port of await SerialPort.list()) {
    const vendorId = port.vendorId?.toLowerCase();
    const productId = port.productId?.toLowerCase();
    if (!vendorId || !productId || !port.path) {
      continue;
    }

    for (const device of SERIAL_DEVICES) {
      if (vendorId === device.vendorId && productId === device.productId) {
        results.push({
          path: port.path,
          label: device.label,
          create: device.create,
        });
        break;
      }
    }
  }

  for (const device of listHidDevices()) {
    results.push({
      path: device.path,
      label: "FreeStyle Precision Neo / Optium Neo",
      create: device.create,
    });
  }

  return results;
}

export function openDevice(entry: DeviceEntry): GlucometerDevice {
  return entry.create(entry.path);
}

async function resolve<T>(value: Promise<T> | T): Promise<T> {
  return await value;
}

export async function withFirstDevice<T>(
  fn: (meter: GlucometerDevice, label: string) => Promise<T> | T,
): Promise<T> {
  const devices = await listDevices();
  if (devices.length === 0) {
    throw new Error("No supported glucose meter found. Connect the device and try again.");
  }

  const { path, label, create } = devices[0];
  const meter = create(path);

  try {
    return await fn(meter, label);
  } finally {
    meter.close();
  }
}

export async function readFromFirstDevice(): Promise<{
  label: string;
  readings: GlucoseReading[];
}> {
  return withFirstDevice(async (meter, label) => {
    const readings = await resolve(meter.fetchData());
    const glucose = readings.filter((reading) => reading.type === "G");
    return { label, readings: glucose };
  });
}

export async function getDeviceInfoFromFirst(): Promise<DeviceInfo> {
  return withFirstDevice(async (meter, label) => {
    if (!meter.getInfo) {
      return {
        label,
        serialNumber: "",
        softwareVersion: "",
        glucoseUnits: "unknown",
        clockValid: false,
      };
    }
    const info = await resolve(meter.getInfo());
    const capabilities =
      meter.getCapabilities?.() ?? info.capabilities ?? { deleteAll: false, deleteOne: false };
    return { ...info, label: info.label || label, capabilities };
  });
}

export async function fetchAllRecordsFromFirst(): Promise<{
  label: string;
  records: MeterRecord[];
}> {
  return withFirstDevice(async (meter, label) => {
    if (meter.fetchAllRecords) {
      const records = await resolve(meter.fetchAllRecords());
      return { label, records };
    }
    const readings = await resolve(meter.fetchData());
    const records: MeterRecord[] = readings.map((r) => ({
      kind: "glucose" as const,
      value: r.value,
      date: r.date,
    }));
    return { label, records };
  });
}

export async function setDateTimeOnFirst(date: Date): Promise<void> {
  await withFirstDevice(async (meter) => {
    if (!meter.setDateTime) {
      throw new Error("This device does not support setting date and time.");
    }
    await resolve(meter.setDateTime(date));
  });
}

export async function setPatientOnFirst(name: string, id?: string): Promise<void> {
  await withFirstDevice(async (meter) => {
    if (!meter.setPatient) {
      throw new Error("This device does not support setting patient info.");
    }
    await resolve(meter.setPatient(name, id));
  });
}

export async function deleteAllRecordsFromFirst(): Promise<void> {
  await withFirstDevice(async (meter) => {
    if (!meter.deleteAllRecords) {
      throw new Error("This device does not support deleting readings.");
    }
    await resolve(meter.deleteAllRecords());
  });
}

export async function deleteRecordFromFirst(id: number, recordType: number): Promise<void> {
  await withFirstDevice(async (meter) => {
    if (!meter.deleteRecord) {
      throw new Error("This device does not support deleting readings.");
    }
    await resolve(meter.deleteRecord(id, recordType));
  });
}
