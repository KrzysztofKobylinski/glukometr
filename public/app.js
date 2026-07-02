const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const statusPill = document.getElementById("status-pill");
const errorBanner = document.getElementById("error-banner");
const toastEl = document.getElementById("toast");
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
const heroPanel = document.getElementById("hero-panel");
const heroValue = document.getElementById("hero-value");
const heroMeta = document.getElementById("hero-meta");
const chartPanel = document.getElementById("chart-panel");
const chartRange = document.getElementById("chart-range");
const glucoseChart = document.getElementById("glucose-chart");
const chartEmpty = document.getElementById("chart-empty");
const rangeLegend = document.getElementById("range-legend");
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalMessage = document.getElementById("modal-message");
const modalCancel = document.getElementById("modal-cancel");
const modalConfirm = document.getElementById("modal-confirm");
const tabsEl = document.getElementById("tabs");

const CHART_POINTS = 30;
const TAB_LABELS = {
  glucose: "Glucose",
  ketone: "Ketones",
  insulin: "Insulin",
  all: "All",
};

const STAT_ICONS = {
  count: `<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
  avg: `<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  min: `<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>`,
  max: `<svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 11 12 6 17 11"/><polyline points="7 18 12 13 17 18"/></svg>`,
};

let activeKind = "glucose";
let allRecords = [];
let deviceSerial = "";
let hiddenCount = 0;
let currentPage = 1;
let pageSize = 50;
let modalResolve = null;
let toastTimer = null;

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 3000);
}

function setConnectionStatus(state, shortLabel, detail) {
  statusPill.dataset.state = state;
  statusEl.textContent = shortLabel;
  if (detail !== undefined) {
    statusTextEl.textContent = detail;
  }
}

function showConfirm(title, message) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  modalOverlay.classList.remove("hidden");
  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

function closeModal(result) {
  modalOverlay.classList.add("hidden");
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

modalCancel.addEventListener("click", () => closeModal(false));
modalConfirm.addEventListener("click", () => closeModal(true));
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal(false);
});

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

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function glucoseClass(value) {
  if (value < 70) return "low";
  if (value > 140) return "high";
  return "normal";
}

function countByKind(kind) {
  if (kind === "all") return allRecords.length;
  return allRecords.filter((r) => r.kind === kind).length;
}

function updateTabCounts() {
  tabsEl.querySelectorAll(".tab").forEach((tab) => {
    const kind = tab.dataset.kind;
    const count = countByKind(kind);
    tab.textContent = `${TAB_LABELS[kind]} (${count})`;
  });
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

function renderHero(glucoseRecords) {
  if (glucoseRecords.length === 0) {
    heroPanel.classList.add("hidden");
    return;
  }

  const latest = getSortedRecords(glucoseRecords)[0];
  heroPanel.classList.remove("hidden");
  heroValue.textContent = latest.value;
  heroValue.className = `hero-value ${glucoseClass(latest.value)}`;
  const { date, time } = formatDateTime(latest.date);
  heroMeta.textContent = `${relativeTime(latest.date)} · ${date} ${time}`;
}

function renderChart(glucoseRecords) {
  const sorted = [...glucoseRecords].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const points = sorted.slice(-CHART_POINTS);

  if (points.length < 2) {
    glucoseChart.innerHTML = "";
    chartEmpty.classList.remove("hidden");
    chartRange.textContent =
      points.length === 1 ? "1 reading" : "Need at least 2 readings";
    return;
  }

  chartEmpty.classList.add("hidden");
  chartRange.textContent = `Last ${points.length} readings`;

  const width = 800;
  const height = 160;
  const padX = 8;
  const padY = 12;
  const values = points.map((p) => p.value);
  const minVal = Math.min(...values, 70) - 10;
  const maxVal = Math.max(...values, 140) + 10;
  const range = maxVal - minVal || 1;

  const toX = (i) => padX + (i / (points.length - 1)) * (width - padX * 2);
  const toY = (v) => height - padY - ((v - minVal) / range) * (height - padY * 2);

  const y70 = toY(70);
  const y140 = toY(140);

  const polyline = points
    .map((p, i) => `${toX(i)},${toY(p.value)}`)
    .join(" ");

  const last = points[points.length - 1];
  const lastX = toX(points.length - 1);
  const lastY = toY(last.value);
  const lastClass = glucoseClass(last.value);

  const colors = {
    low: "var(--range-low)",
    normal: "var(--range-normal)",
    high: "var(--range-high)",
  };

  glucoseChart.innerHTML = `
    <rect x="0" y="${y140}" width="${width}" height="${y70 - y140}" style="fill: var(--range-band)" />
    <line x1="${padX}" y1="${y70}" x2="${width - padX}" y2="${y70}" style="stroke: var(--range-normal); stroke-opacity: 0.35" stroke-dasharray="4 4" />
    <line x1="${padX}" y1="${y140}" x2="${width - padX}" y2="${y140}" style="stroke: var(--range-normal); stroke-opacity: 0.35" stroke-dasharray="4 4" />
    <polyline points="${polyline}" fill="none" style="stroke: var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx="${lastX}" cy="${lastY}" r="5" style="fill: ${colors[lastClass]}" stroke="var(--card)" stroke-width="2" />
  `;
}

function renderStats(records) {
  readingStats.innerHTML = "";

  const stat = (label, value, iconKey, extraClass = "") => {
    const div = document.createElement("div");
    div.className = `stat ${extraClass}`.trim();
    div.innerHTML = `
      <div class="stat-header">
        ${STAT_ICONS[iconKey] || ""}
        <span class="stat-label">${label}</span>
      </div>
      <div class="stat-value">${value}</div>`;
    return div;
  };

  readingStats.appendChild(stat("Count", records.length, "count"));

  const glucose =
    activeKind === "glucose"
      ? records
      : records.filter((r) => r.kind === "glucose");

  if (
    activeKind === "glucose" ||
    (activeKind === "all" && glucose.length > 0)
  ) {
    if (glucose.length > 0) {
      const values = glucose.map((r) => r.value);
      const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
      const avgClass = avg >= 70 && avg <= 140 ? "in-range" : "";
      readingStats.appendChild(stat("Average", `${avg} mg/dL`, "avg", avgClass));
      readingStats.appendChild(stat("Lowest", `${Math.min(...values)} mg/dL`, "min"));
      readingStats.appendChild(stat("Highest", `${Math.max(...values)} mg/dL`, "max"));
    }
  }
}

function renderSkeletonRows(cols = 4) {
  readingsBody.innerHTML = Array.from({ length: 5 }, () =>
    `<tr class="skeleton-row"><td colspan="${cols}"><span class="skeleton"></span></td></tr>`,
  ).join("");
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
        <th class="num">Units</th>
        <th>Type</th>
        <th>Date</th>
        <th>Time</th>
        ${showHide ? "<th></th>" : ""}
      </tr>`;
  } else if (activeKind === "ketone") {
    readingsHead.innerHTML = `
      <tr>
        <th class="num">mg/dL</th>
        <th class="num">mmol/L</th>
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
        <th class="num">mg/dL</th>
        <th>Date</th>
        <th>Time</th>
        ${showHide ? "<th></th>" : ""}
      </tr>`;
  }

  const colSpan =
    (activeKind === "all" ? 4 : activeKind === "insulin" || activeKind === "ketone" ? 4 : 3) +
    actionCol;

  if (records.length === 0) {
    readingsBody.innerHTML = `
      <tr>
        <td colspan="${colSpan}" class="empty-state">
          <span class="empty-state-icon">◎</span>
          No readings in this view
        </td>
      </tr>`;
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
          <td class="num value ${glucoseClass(record.value)}">${record.value}</td>
          <td>${date}</td>
          <td>${time}</td>
          ${action}
        </tr>`;
      }

      if (record.kind === "ketone") {
        return `<tr>
          <td class="num">${record.valueMgDl}</td>
          <td class="num">${record.valueMmolL ?? (record.valueMgDl / 18).toFixed(2)}</td>
          <td>${date}</td>
          <td>${time}</td>
          ${action}
        </tr>`;
      }

      if (record.kind === "insulin") {
        return `<tr>
          <td class="num">${record.units}</td>
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

function getGlucoseRecords() {
  return allRecords.filter((r) => r.kind === "glucose");
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
  const glucose = getGlucoseRecords();
  currentPage = clampPage(currentPage, filtered.length);

  updateTabCounts();
  renderHero(glucose);
  renderChart(glucose);
  chartPanel.classList.toggle("hidden", glucose.length === 0);
  rangeLegend.classList.toggle("hidden", activeKind !== "glucose" && activeKind !== "all");
  renderStats(filtered);
  renderTable(filtered);
  renderPagination(filtered.length);
}

async function loadDeviceInfo() {
  const info = await api("/api/device/info");
  renderDeviceInfo(info);
  setConnectionStatus("connected", "Connected", info.label);
}

async function loadReadings() {
  refreshBtn.disabled = true;
  refreshBtn.classList.add("loading");
  renderSkeletonRows();
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
    refreshBtn.classList.remove("loading");
  }
}

async function hideOneRecord(hash) {
  const ok = await showConfirm(
    "Hide reading",
    "Hide this reading from the list? It will still be stored on the meter.",
  );
  if (!ok) return;

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
  const ok = await showConfirm(
    "Hide all readings",
    "Hide ALL readings from the list? They will remain stored on the meter.",
  );
  if (!ok) return;

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
  if (hiddenCount === 0) return;

  const ok = await showConfirm(
    "Show hidden readings",
    `Show all ${hiddenCount} hidden readings again?`,
  );
  if (!ok) return;

  try {
    await api("/api/readings/restore-hidden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serialNumber: deviceSerial }),
    });
    await loadDeviceInfo();
    await loadReadings();
    showToast("Hidden readings restored");
    clearError();
  } catch (err) {
    showError(err.message);
  }
}

async function init() {
  setConnectionStatus("loading", "Connecting…", "Looking for glucose meter…");
  try {
    const { devices } = await api("/api/devices");
    if (devices.length === 0) {
      setConnectionStatus("disconnected", "No device", "No supported meter found");
      showError("No supported glucose meter found. Connect the device and try again.");
      return;
    }

    await loadDeviceInfo();
    await loadReadings();
  } catch (e) {
    setConnectionStatus("error", "Error", "Connection failed");
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

  const ok = await showConfirm(
    "Set date & time",
    "Set this date and time on the glucose meter?",
  );
  if (!ok) return;

  try {
    await api("/api/device/datetime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iso }),
    });
    await loadDeviceInfo();
    showToast("Clock updated on device");
    clearError();
  } catch (err) {
    showError(err.message);
  }
});

patientForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("set-patient-name").value.trim();
  const id = document.getElementById("set-patient-id").value.trim();

  const ok = await showConfirm(
    "Set patient",
    `Set patient name to "${name}" on the glucose meter?`,
  );
  if (!ok) return;

  try {
    await api("/api/device/patient", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, id: id || undefined }),
    });
    await loadDeviceInfo();
    showToast("Patient info updated");
    clearError();
  } catch (err) {
    showError(err.message);
  }
});

init();
