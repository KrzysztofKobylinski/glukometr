#!/usr/bin/env bun

import { join } from "node:path";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import {
  DeviceInvalid,
  DeviceNotConnected,
  readFromFirstDevice,
  type GlucoseReading,
} from "./src/glucolib.ts";

const ROOT = import.meta.dir;
const OUTPUT = join(ROOT, "readings.html");

type DisplayReading = {
  value: number;
  date: string;
  time: string;
};

function formatReadingDate(date: Date): { date: string; time: string } {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return {
    date: `${month}/${day}/${year}`,
    time: `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`,
  };
}

function toDisplayReadings(readings: GlucoseReading[]): DisplayReading[] {
  return readings.map((reading) => {
    const formatted = formatReadingDate(reading.date);
    return {
      value: reading.value,
      date: formatted.date,
      time: formatted.time,
    };
  });
}

function glucoseClass(value: number): string {
  if (value < 70) return "low";
  if (value > 140) return "high";
  return "normal";
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildHtml(deviceLabel: string, readings: DisplayReading[]): string {
  const values = readings.map((r) => r.value);
  const count = readings.length;
  const average =
    count > 0
      ? Math.round(values.reduce((sum, v) => sum + v, 0) / count)
      : 0;
  const min = count > 0 ? Math.min(...values) : 0;
  const max = count > 0 ? Math.max(...values) : 0;
  const exportedAt = new Date().toLocaleString();

  const rows = readings
    .map(
      (reading) => `
      <tr>
        <td class="value ${glucoseClass(reading.value)}">${reading.value}</td>
        <td>${escapeHtml(reading.date)}</td>
        <td>${escapeHtml(reading.time)}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Glucose Readings</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f6f8;
      --card: #ffffff;
      --text: #1a1f24;
      --muted: #5f6b76;
      --border: #d8dee4;
      --low: #1d6fd8;
      --normal: #1f8a4c;
      --high: #d9480f;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f1419;
        --card: #171d24;
        --text: #edf2f7;
        --muted: #9aa7b3;
        --border: #2a3440;
        --low: #5ba3ff;
        --normal: #4fd08a;
        --high: #ff8a5c;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 2rem 1rem 3rem;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
    }
    .meta {
      color: var(--muted);
      margin-bottom: 1.5rem;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .stat {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem;
    }
    .stat-label {
      color: var(--muted);
      font-size: 0.85rem;
      margin-bottom: 0.25rem;
    }
    .stat-value {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      background: color-mix(in srgb, var(--card) 92%, var(--text));
    }
    tr:last-child td { border-bottom: none; }
    .value {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .value.low { color: var(--low); }
    .value.normal { color: var(--normal); }
    .value.high { color: var(--high); }
    .legend {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-top: 1rem;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .legend span::before {
      content: "●";
      margin-right: 0.35rem;
    }
    .legend .low::before { color: var(--low); }
    .legend .normal::before { color: var(--normal); }
    .legend .high::before { color: var(--high); }
  </style>
</head>
<body>
  <main>
    <h1>Glucose Readings</h1>
    <p class="meta">${escapeHtml(deviceLabel)} · Exported ${escapeHtml(exportedAt)} · ${count} readings</p>

    <section class="stats">
      <div class="stat">
        <div class="stat-label">Average</div>
        <div class="stat-value">${average} mg/dL</div>
      </div>
      <div class="stat">
        <div class="stat-label">Lowest</div>
        <div class="stat-value">${min} mg/dL</div>
      </div>
      <div class="stat">
        <div class="stat-label">Highest</div>
        <div class="stat-value">${max} mg/dL</div>
      </div>
    </section>

    <section class="card">
      <table>
        <thead>
          <tr>
            <th>Value (mg/dL)</th>
            <th>Date</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="3">No readings found.</td></tr>'}
        </tbody>
      </table>
    </section>

    <p class="legend">
      <span class="low">Below 70</span>
      <span class="normal">70–140</span>
      <span class="high">Above 140</span>
    </p>
  </main>
</body>
</html>`;
}

async function openInBrowser(path: string): Promise<void> {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? ["open", path]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", path]
        : ["xdg-open", path];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(command[0], command.slice(1), { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Failed to open browser (exit ${code})`));
    });
  });
}

async function main(): Promise<void> {
  console.log("Looking for glucose meter...");
  const { label, readings } = await readFromFirstDevice();
  const displayReadings = toDisplayReadings(readings);

  const html = buildHtml(label, displayReadings);
  await writeFile(OUTPUT, html, "utf8");

  console.log(`Read ${readings.length} readings from ${label}`);
  console.log(`Wrote report to ${OUTPUT}`);
  await openInBrowser(OUTPUT);
}

main().catch((error) => {
  if (error instanceof DeviceNotConnected || error instanceof DeviceInvalid) {
    console.error(
      "Make sure your device is connected and awake (try replugging the cable).",
    );
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
