#!/usr/bin/env bun

import { join } from "node:path";
import {
  clearHidden,
  getHiddenHashes,
  hideHashes,
} from "./src/hidden-readings.ts";
import {
  DeviceInvalid,
  DeviceNotConnected,
  fetchSessionFromFirst,
  getDeviceInfoFromFirst,
  listDevices,
  setDateTimeOnFirst,
  setPatientOnFirst,
  type DeviceInfo,
  type MeterRecord,
} from "./src/glucolib.ts";
import { hashReading } from "./src/reading-hash.ts";

const ROOT = import.meta.dir;
const PUBLIC_DIR = join(ROOT, "public");
const PORT = 3000;

let deviceLock: Promise<void> = Promise.resolve();

function withDeviceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = deviceLock.then(fn, fn);
  deviceLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

function serializeInfo(info: DeviceInfo) {
  return {
    ...info,
    date: info.date?.toISOString() ?? null,
  };
}

async function serializeRecord(serial: string, record: MeterRecord) {
  return {
    ...record,
    hash: await hashReading(serial, record),
    date: record.date.toISOString(),
    valueMmolL:
      record.kind === "ketone"
        ? Math.round((record.valueMgDl / 18) * 100) / 100
        : undefined,
  };
}

async function handleApiDevices(): Promise<Response> {
  const devices = await listDevices();
  return json({
    devices: devices.map((d) => ({ path: d.path, label: d.label })),
  });
}

async function handleApiInfo(): Promise<Response> {
  return withDeviceLock(async () => {
    try {
      const info = await getDeviceInfoFromFirst();
      const serial = info.serialNumber || info.label;
      const hiddenCount = (await getHiddenHashes(serial)).size;
      return json({ ...serializeInfo(info), hiddenCount });
    } catch (e) {
      return mapDeviceError(e);
    }
  });
}

async function handleApiReadings(url: URL): Promise<Response> {
  const kind = url.searchParams.get("kind");

  return withDeviceLock(async () => {
    try {
      const { label, serialNumber, records } = await fetchSessionFromFirst();
      const hidden = await getHiddenHashes(serialNumber);
      const visible: MeterRecord[] = [];

      for (const record of records) {
        const hash = await hashReading(serialNumber, record);
        if (!hidden.has(hash)) {
          visible.push(record);
        }
      }

      let filtered = visible;
      if (kind && kind !== "all") {
        filtered = visible.filter((r) => r.kind === kind);
      }

      return json({
        label,
        serialNumber,
        count: filtered.length,
        totalOnDevice: records.length,
        hiddenCount: hidden.size,
        records: await Promise.all(
          filtered.map((record) => serializeRecord(serialNumber, record)),
        ),
      });
    } catch (e) {
      return mapDeviceError(e);
    }
  });
}

async function handleApiHideOne(request: Request): Promise<Response> {
  let body: { hash?: string; serialNumber?: string };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body", 400);
  }

  if (!body.hash?.trim()) {
    return error("Missing hash field", 400);
  }
  if (!body.serialNumber?.trim()) {
    return error("Missing serialNumber field", 400);
  }

  try {
    const hiddenCount = await hideHashes(body.serialNumber.trim(), [body.hash.trim()]);
    return json({ ok: true, hiddenCount });
  } catch (e) {
    return mapDeviceError(e);
  }
}

async function handleApiHideAll(): Promise<Response> {
  return withDeviceLock(async () => {
    try {
      const { serialNumber, records } = await fetchSessionFromFirst();
      const hidden = await getHiddenHashes(serialNumber);
      const newHashes: string[] = [];

      for (const record of records) {
        const hash = await hashReading(serialNumber, record);
        if (!hidden.has(hash)) {
          newHashes.push(hash);
        }
      }

      const hiddenCount = await hideHashes(serialNumber, newHashes);
      return json({ ok: true, hiddenCount, newlyHidden: newHashes.length });
    } catch (e) {
      return mapDeviceError(e);
    }
  });
}

async function handleApiRestoreHidden(request: Request): Promise<Response> {
  let body: { serialNumber?: string };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body", 400);
  }

  if (!body.serialNumber?.trim()) {
    return error("Missing serialNumber field", 400);
  }

  try {
    const restoredCount = await clearHidden(body.serialNumber.trim());
    return json({ ok: true, restoredCount });
  } catch (e) {
    return mapDeviceError(e);
  }
}

async function handleApiDateTime(request: Request): Promise<Response> {
  let body: { iso?: string };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body", 400);
  }

  if (!body.iso) {
    return error("Missing iso field", 400);
  }

  const date = new Date(body.iso);
  if (Number.isNaN(date.getTime())) {
    return error("Invalid date", 400);
  }

  return withDeviceLock(async () => {
    try {
      await setDateTimeOnFirst(date);
      return json({ ok: true });
    } catch (e) {
      return mapDeviceError(e);
    }
  });
}

async function handleApiPatient(request: Request): Promise<Response> {
  let body: { name?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body", 400);
  }

  if (!body.name?.trim()) {
    return error("Missing name field", 400);
  }

  return withDeviceLock(async () => {
    try {
      await setPatientOnFirst(body.name!.trim(), body.id?.trim() || undefined);
      return json({ ok: true });
    } catch (e) {
      return mapDeviceError(e);
    }
  });
}

function mapDeviceError(e: unknown): Response {
  if (e instanceof DeviceNotConnected || e instanceof DeviceInvalid) {
    return error(
      "Device not responding. Make sure it is connected and awake.",
      502,
    );
  }
  if (e instanceof Error) {
    if (e.message.includes("No supported glucose meter")) {
      return error(e.message, 404);
    }
    return error(e.message, 500);
  }
  return error("Unknown error", 500);
}

async function serveStatic(pathname: string): Promise<Response | null> {
  const filePath = join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  return new Response(file);
}

const server = Bun.serve({
  port: PORT,
  hostname: "localhost",
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method === "GET" && url.pathname === "/api/devices") {
        return handleApiDevices();
      }
      if (request.method === "GET" && url.pathname === "/api/device/info") {
        return handleApiInfo();
      }
      if (request.method === "GET" && url.pathname === "/api/readings") {
        return handleApiReadings(url);
      }
      if (request.method === "POST" && url.pathname === "/api/device/datetime") {
        return handleApiDateTime(request);
      }
      if (request.method === "POST" && url.pathname === "/api/device/patient") {
        return handleApiPatient(request);
      }
      if (request.method === "POST" && url.pathname === "/api/readings/hide") {
        return handleApiHideOne(request);
      }
      if (request.method === "POST" && url.pathname === "/api/readings/hide-all") {
        return handleApiHideAll();
      }
      if (request.method === "POST" && url.pathname === "/api/readings/restore-hidden") {
        return handleApiRestoreHidden(request);
      }
      return error("Not found", 404);
    }

    const staticResponse = await serveStatic(url.pathname);
    if (staticResponse) return staticResponse;

    return error("Not found", 404);
  },
});

console.log(`Glukometr web UI running at http://localhost:${server.port}`);
