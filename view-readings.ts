#!/usr/bin/env bun

import { join } from "node:path";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const ROOT = import.meta.dir;
const GENERATOR = join(ROOT, "glucosetracker_gen");
const OUTPUT = join(ROOT, "readings.html");

type Reading = {
  value: number;
  category: string;
  date: string;
  time: string;
  notes: string;
};

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i < line.length) {
    if (line[i] !== '"') break;
    const end = line.indexOf('"', i + 1);
    fields.push(line.slice(i + 1, end));
    i = end + 2;
  }

  return fields;
}

function parseCsv(text: string): Reading[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  return lines.slice(1).map((line) => {
    const [value, category, date, time, notes] = parseCsvLine(line);
    return {
      value: Number(value),
      category,
      date,
      time,
      notes,
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

function buildHtml(readings: Reading[]): string {
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
        <td>${escapeHtml(reading.notes)}</td>
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
    <p class="meta">Exported ${escapeHtml(exportedAt)} · ${count} readings</p>

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
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="4">No readings found.</td></tr>'}
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

async function runGenerator(): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(GENERATOR, [], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `glucosetracker_gen exited with ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
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
  console.log("Reading glucose meter...");
  const csv = await runGenerator();
  const readings = parseCsv(csv);

  const html = buildHtml(readings);
  await writeFile(OUTPUT, html, "utf8");

  console.log(`Wrote ${readings.length} readings to ${OUTPUT}`);
  await openInBrowser(OUTPUT);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
