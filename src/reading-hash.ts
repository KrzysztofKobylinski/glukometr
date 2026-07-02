import type { MeterRecord } from "./types.ts";

function recordValuePart(record: MeterRecord): string {
  if (record.kind === "glucose") return String(record.value);
  if (record.kind === "ketone") return String(record.valueMgDl);
  return `${record.units}|${record.insulinType}`;
}

export function readingFingerprint(serial: string, record: MeterRecord): string {
  return [
    serial,
    String(record.id),
    String(record.recordType),
    record.kind,
    record.date.toISOString(),
    recordValuePart(record),
  ].join("\0");
}

export async function hashReading(
  serial: string,
  record: MeterRecord,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(readingFingerprint(serial, record)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
