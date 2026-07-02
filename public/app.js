const statusEl = document.getElementById("status");
const errorBanner = document.getElementById("error-banner");
const readingsBody = document.getElementById("readings-body");
const readingsHead = document.getElementById("readings-head");
const readingStats = document.getElementById("reading-stats");
const refreshBtn = document.getElementById("refresh-readings");
const datetimeForm = document.getElementById("datetime-form");
const patientForm = document.getElementById("patient-form");
const syncClockBtn = document.getElementById("sync-clock");

let activeKind = "glucose";
let allRecords = [];

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return {
    date,
    time: `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`,
  };
}

function glucoseClass(value) {
  if (value < 70) return "low";
  if (value > 140) return "high";
  return "normal";
}

function renderDeviceInfo(info) {
  document.getElementById("info-label").textContent = info.label || "—";
  document.getElementById("info-serial").textContent = info.serialNumber || "—";
  document.getElementById("info-firmware").textContent = info.softwareVersion || "—";
  document.getElementById("info-units").textContent = info.glucoseUnits || "—";

  const patientParts = [info.patientName, info.patientId].filter(Boolean);
  document.getElementById("info-patient").textContent =
    patientParts.length > 0 ? patientParts.join(" · ") : "—";

  const clockEl = document.getElementById("info-clock");
  if (!info.clockValid) {
    clockEl.textContent = "Not set (invalid)";
    clockEl.classList.add("warn");
  } else if (info.date) {
    const { date, time } = formatDateTime(info.date);
    clockEl.textContent = `${date} ${time}`;
    clockEl.classList.remove("warn");
  } else {
    clockEl.textContent = "—";
    clockEl.classList.remove("warn");
  }

  if (info.patientName) {
    document.getElementById("set-patient-name").value = info.patientName;
  }
  if (info.patientId) {
    document.getElementById("set-patient-id").value = info.patientId;
  }

  if (info.date && info.clockValid) {
    const d = new Date(info.date);
    document.getElementById("set-date").value = d.toISOString().slice(0, 10);
    document.getElementById("set-time").value = d.toTimeString().slice(0, 5);
  }
}

function renderStats(records) {
  readingStats.innerHTML = "";

  const stat = (label, value) => {
    const div = document.createElement("div");
    div.className = "stat";
    div.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div>`;
    return div;
  };

  readingStats.appendChild(stat("Count", records.length));

  if (activeKind === "glucose" || (activeKind === "all" && records.some((r) => r.kind === "glucose"))) {
    const glucose = records.filter((r) => r.kind === "glucose");
    if (glucose.length > 0) {
      const values = glucose.map((r) => r.value);
      const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
      readingStats.appendChild(stat("Average", `${avg} mg/dL`));
      readingStats.appendChild(stat("Lowest", `${Math.min(...values)} mg/dL`));
      readingStats.appendChild(stat("Highest", `${Math.max(...values)} mg/dL`));
    }
  }
}

function renderTable(records) {
  if (activeKind === "insulin") {
    readingsHead.innerHTML = `
      <tr>
        <th>Units</th>
        <th>Type</th>
        <th>Date</th>
        <th>Time</th>
      </tr>`;
  } else if (activeKind === "ketone") {
    readingsHead.innerHTML = `
      <tr>
        <th>Value (mg/dL)</th>
        <th>mmol/L</th>
        <th>Date</th>
        <th>Time</th>
      </tr>`;
  } else if (activeKind === "all") {
    readingsHead.innerHTML = `
      <tr>
        <th>Type</th>
        <th>Value</th>
        <th>Date</th>
        <th>Time</th>
      </tr>`;
  } else {
    readingsHead.innerHTML = `
      <tr>
        <th>Value (mg/dL)</th>
        <th>Date</th>
        <th>Time</th>
      </tr>`;
  }

  if (records.length === 0) {
    readingsBody.innerHTML = `<tr><td colspan="4">No readings found.</td></tr>`;
    return;
  }

  const sorted = [...records].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  readingsBody.innerHTML = sorted
    .map((record) => {
      const { date, time } = formatDateTime(record.date);

      if (record.kind === "glucose") {
        if (activeKind === "all") {
          return `<tr>
            <td>Glucose</td>
            <td class="value ${glucoseClass(record.value)}">${record.value} mg/dL</td>
            <td>${date}</td>
            <td>${time}</td>
          </tr>`;
        }
        return `<tr>
          <td class="value ${glucoseClass(record.value)}">${record.value}</td>
          <td>${date}</td>
          <td>${time}</td>
        </tr>`;
      }

      if (record.kind === "ketone") {
        return `<tr>
          <td>${record.valueMgDl}</td>
          <td>${record.valueMmolL ?? (record.valueMgDl / 18).toFixed(2)}</td>
          <td>${date}</td>
          <td>${time}</td>
        </tr>`;
      }

      if (record.kind === "insulin") {
        return `<tr>
          <td>${record.units}</td>
          <td>${record.insulinType}</td>
          <td>${date}</td>
          <td>${time}</td>
        </tr>`;
      }

      return "";
    })
    .join("");
}

function filterRecords() {
  if (activeKind === "all") return allRecords;
  return allRecords.filter((r) => r.kind === activeKind);
}

async function loadDeviceInfo() {
  const info = await api("/api/device/info");
  renderDeviceInfo(info);
  statusEl.textContent = `${info.label} connected`;
}

async function loadReadings() {
  refreshBtn.disabled = true;
  try {
    const data = await api("/api/readings?kind=all");
    allRecords = data.records;
    const filtered = filterRecords();
    renderStats(filtered);
    renderTable(filtered);
    clearError();
  } finally {
    refreshBtn.disabled = false;
  }
}

async function init() {
  try {
    const { devices } = await api("/api/devices");
    if (devices.length === 0) {
      statusEl.textContent = "No device found";
      showError("No supported glucose meter found. Connect the device and try again.");
      return;
    }

    await loadDeviceInfo();
    await loadReadings();
  } catch (e) {
    statusEl.textContent = "Error";
    showError(e.message);
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeKind = tab.dataset.kind;
    const filtered = filterRecords();
    renderStats(filtered);
    renderTable(filtered);
  });
});

refreshBtn.addEventListener("click", () => {
  loadReadings().catch((e) => showError(e.message));
});

syncClockBtn.addEventListener("click", () => {
  const now = new Date();
  document.getElementById("set-date").value = now.toISOString().slice(0, 10);
  document.getElementById("set-time").value = now.toTimeString().slice(0, 5);
});

datetimeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const dateStr = document.getElementById("set-date").value;
  const timeStr = document.getElementById("set-time").value;
  const iso = new Date(`${dateStr}T${timeStr}`).toISOString();

  if (!confirm("Set this date and time on the glucose meter?")) return;

  try {
    await api("/api/device/datetime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iso }),
    });
    await loadDeviceInfo();
    clearError();
  } catch (err) {
    showError(err.message);
  }
});

patientForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("set-patient-name").value.trim();
  const id = document.getElementById("set-patient-id").value.trim();

  if (!confirm(`Set patient name to "${name}" on the glucose meter?`)) return;

  try {
    await api("/api/device/patient", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, id: id || undefined }),
    });
    await loadDeviceInfo();
    clearError();
  } catch (err) {
    showError(err.message);
  }
});

init();
