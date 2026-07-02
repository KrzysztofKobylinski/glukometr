const statusEl = document.getElementById("status");
const errorBanner = document.getElementById("error-banner");
const readingsBody = document.getElementById("readings-body");
const readingsHead = document.getElementById("readings-head");
const readingStats = document.getElementById("reading-stats");
const refreshBtn = document.getElementById("refresh-readings");
const hideAllBtn = document.getElementById("hide-all-readings");
const restoreHiddenBtn = document.getElementById("restore-hidden");
const hiddenCountLabel = document.getElementById("hidden-count-label");
const datetimeForm = document.getElementById("datetime-form");
const patientForm = document.getElementById("patient-form");
const syncClockBtn = document.getElementById("sync-clock");
const pageSizeSelect = document.getElementById("page-size");
const pageFirstBtn = document.getElementById("page-first");
const pagePrevBtn = document.getElementById("page-prev");
const pageNextBtn = document.getElementById("page-next");
const pageLastBtn = document.getElementById("page-last");
const pageIndicator = document.getElementById("page-indicator");
const paginationInfo = document.getElementById("pagination-info");

let activeKind = "glucose";
let allRecords = [];
let deviceSerial = "";
let hiddenCount = 0;
let currentPage = 1;
let pageSize = 50;

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

function updateHiddenLabel() {
  if (hiddenCount > 0) {
    hiddenCountLabel.textContent = `(${hiddenCount} hidden locally)`;
    restoreHiddenBtn.disabled = false;
  } else {
    hiddenCountLabel.textContent = "";
    restoreHiddenBtn.disabled = true;
  }
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

  if (info.serialNumber) {
    deviceSerial = info.serialNumber;
  }

  if (typeof info.hiddenCount === "number") {
    hiddenCount = info.hiddenCount;
    updateHiddenLabel();
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

function hideButton(record) {
  if (!record.hash) return "";
  return `<button type="button" class="btn danger secondary small hide-one" data-hash="${record.hash}">Hide</button>`;
}

function renderTable(records) {
  const showHide = true;
  const actionCol = showHide ? 1 : 0;

  if (activeKind === "insulin") {
    readingsHead.innerHTML = `
      <tr>
        <th>Units</th>
        <th>Type</th>
        <th>Date</th>
        <th>Time</th>
        ${showHide ? "<th></th>" : ""}
      </tr>`;
  } else if (activeKind === "ketone") {
    readingsHead.innerHTML = `
      <tr>
        <th>Value (mg/dL)</th>
        <th>mmol/L</th>
        <th>Date</th>
        <th>Time</th>
        ${showHide ? "<th></th>" : ""}
      </tr>`;
  } else if (activeKind === "all") {
    readingsHead.innerHTML = `
      <tr>
        <th>Type</th>
        <th>Value</th>
        <th>Date</th>
        <th>Time</th>
        ${showHide ? "<th></th>" : ""}
      </tr>`;
  } else {
    readingsHead.innerHTML = `
      <tr>
        <th>Value (mg/dL)</th>
        <th>Date</th>
        <th>Time</th>
        ${showHide ? "<th></th>" : ""}
      </tr>`;
  }

  const colSpan = (activeKind === "all" ? 4 : activeKind === "insulin" || activeKind === "ketone" ? 4 : 3) + actionCol;

  if (records.length === 0) {
    readingsBody.innerHTML = `<tr><td colspan="${colSpan}">No readings found.</td></tr>`;
    return;
  }

  const sorted = getSortedRecords(records);
  const pageRecords = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  readingsBody.innerHTML = pageRecords
    .map((record) => {
      const { date, time } = formatDateTime(record.date);
      const action = showHide ? `<td>${hideButton(record)}</td>` : "";

      if (record.kind === "glucose") {
        if (activeKind === "all") {
          return `<tr>
            <td>Glucose</td>
            <td class="value ${glucoseClass(record.value)}">${record.value} mg/dL</td>
            <td>${date}</td>
            <td>${time}</td>
            ${action}
          </tr>`;
        }
        return `<tr>
          <td class="value ${glucoseClass(record.value)}">${record.value}</td>
          <td>${date}</td>
          <td>${time}</td>
          ${action}
        </tr>`;
      }

      if (record.kind === "ketone") {
        return `<tr>
          <td>${record.valueMgDl}</td>
          <td>${record.valueMmolL ?? (record.valueMgDl / 18).toFixed(2)}</td>
          <td>${date}</td>
          <td>${time}</td>
          ${action}
        </tr>`;
      }

      if (record.kind === "insulin") {
        return `<tr>
          <td>${record.units}</td>
          <td>${record.insulinType}</td>
          <td>${date}</td>
          <td>${time}</td>
          ${action}
        </tr>`;
      }

      return "";
    })
    .join("");

  document.querySelectorAll(".hide-one").forEach((button) => {
    button.addEventListener("click", () => {
      hideOneRecord(button.dataset.hash);
    });
  });
}

function filterRecords() {
  if (activeKind === "all") return allRecords;
  return allRecords.filter((r) => r.kind === activeKind);
}

function getSortedRecords(records) {
  return [...records].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

function getPageCount(total) {
  return Math.max(1, Math.ceil(total / pageSize));
}

function clampPage(page, total) {
  return Math.min(Math.max(1, page), getPageCount(total));
}

function renderPagination(total) {
  const pageCount = getPageCount(total);

  if (total === 0) {
    paginationInfo.textContent = "No readings";
    pageIndicator.textContent = "—";
    pageFirstBtn.disabled = true;
    pagePrevBtn.disabled = true;
    pageNextBtn.disabled = true;
    pageLastBtn.disabled = true;
    return;
  }

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);
  paginationInfo.textContent = `Showing ${start}–${end} of ${total}`;
  pageIndicator.textContent = `${currentPage} / ${pageCount}`;

  pageFirstBtn.disabled = currentPage <= 1;
  pagePrevBtn.disabled = currentPage <= 1;
  pageNextBtn.disabled = currentPage >= pageCount;
  pageLastBtn.disabled = currentPage >= pageCount;
}

function renderReadingsView() {
  const filtered = filterRecords();
  currentPage = clampPage(currentPage, filtered.length);
  renderStats(filtered);
  renderTable(filtered);
  renderPagination(filtered.length);
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
    if (data.serialNumber) {
      deviceSerial = data.serialNumber;
    }
    if (typeof data.hiddenCount === "number") {
      hiddenCount = data.hiddenCount;
      updateHiddenLabel();
    }
    currentPage = 1;
    renderReadingsView();
    clearError();
  } finally {
    refreshBtn.disabled = false;
  }
}

async function hideOneRecord(hash) {
  if (!confirm("Hide this reading from the list? It will still be stored on the meter.")) {
    return;
  }

  try {
    await api("/api/readings/hide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash, serialNumber: deviceSerial }),
    });
    await loadReadings();
    clearError();
  } catch (err) {
    showError(err.message);
  }
}

async function hideAllRecords() {
  if (
    !confirm(
      "Hide ALL readings from the list? They will remain stored on the meter.",
    )
  ) {
    return;
  }

  hideAllBtn.disabled = true;
  try {
    await api("/api/readings/hide-all", { method: "POST" });
    await loadReadings();
    clearError();
  } catch (err) {
    showError(err.message);
  } finally {
    hideAllBtn.disabled = false;
  }
}

async function restoreHidden() {
  if (hiddenCount === 0) {
    return;
  }

  if (!confirm(`Show all ${hiddenCount} hidden readings again?`)) {
    return;
  }

  try {
    await api("/api/readings/restore-hidden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serialNumber: deviceSerial }),
    });
    await loadDeviceInfo();
    await loadReadings();
    clearError();
  } catch (err) {
    showError(err.message);
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
    currentPage = 1;
    renderReadingsView();
  });
});

pageSizeSelect.addEventListener("change", () => {
  pageSize = Number(pageSizeSelect.value);
  currentPage = 1;
  renderReadingsView();
});

pageFirstBtn.addEventListener("click", () => {
  currentPage = 1;
  renderReadingsView();
});

pagePrevBtn.addEventListener("click", () => {
  currentPage -= 1;
  renderReadingsView();
});

pageNextBtn.addEventListener("click", () => {
  currentPage += 1;
  renderReadingsView();
});

pageLastBtn.addEventListener("click", () => {
  const total = filterRecords().length;
  currentPage = getPageCount(total);
  renderReadingsView();
});

refreshBtn.addEventListener("click", () => {
  loadReadings().catch((e) => showError(e.message));
});

hideAllBtn.addEventListener("click", () => {
  hideAllRecords().catch((e) => showError(e.message));
});

restoreHiddenBtn.addEventListener("click", () => {
  restoreHidden().catch((e) => showError(e.message));
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
