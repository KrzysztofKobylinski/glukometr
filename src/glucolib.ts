import { SerialPort } from "serialport";
import { DiagnosticGold } from "./diagnostic-gold.ts";
import { OptiumXido } from "./optium-xido.ts";
import { listHidDevices } from "./abbott-hid.ts";
import type { DeviceEntry, GlucoseReading, GlucometerDevice } from "./types.ts";

export { DeviceInvalid, DeviceNotConnected } from "./errors.ts";
export type { GlucoseReading };

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
  {
    vendorId: "10c4",
    productId: "ea60",
    label: "Diagnosis Diagnostic Gold",
    create: (path) => new DiagnosticGold(path),
  },
];

async function listDevices(): Promise<DeviceEntry[]> {
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

export async function readFromFirstDevice(): Promise<{
  label: string;
  readings: GlucoseReading[];
}> {
  const devices = await listDevices();
  if (devices.length === 0) {
    throw new Error("No supported glucose meter found. Connect the device and try again.");
  }

  const { path, label, create } = devices[0];
  const meter = create(path);

  try {
    const readings = await meter.fetchData();
    const glucose = readings.filter((reading) => reading.type === "G");
    return { label, readings: glucose };
  } finally {
    meter.close();
  }
}
