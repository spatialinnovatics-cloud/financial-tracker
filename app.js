window.jsPDF = window.jspdf?.jsPDF;

const STORAGE = {
  data: "fin_tracker_data_v2",
  lists: "fin_tracker_lists_v2",
  dark: "darkMode"
};

const LEGACY_LEDGER_STORAGE = "personal-ledger:v2";

const LIST_KEYS = {
  methods: "methods",
  coreTypes: "coreTypes",
  debtTypes: "debtTypes"
};

window.LIST_KEYS = LIST_KEYS;

let currentMonthIndex = 0;
let monthsData = [];
let listManagerOverlay = null;
let notificationTimeout = null;

window.lists = {
  [LIST_KEYS.methods]: [],
  [LIST_KEYS.coreTypes]: [],
  [LIST_KEYS.debtTypes]: []
};

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }

  return String(value).replace(/["\\]/g, "\\$&");
}

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

function formatCurrency(value) {
  const amount = Number.parseFloat(value || "0") || 0;
  return `\u00A3${amount.toFixed(2)}`;
}

function sanitizeFilename(value) {
  return String(value || "file")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "file";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function monthLabelFromKey(key) {
  if (!/^\d{4}-\d{2}$/.test(key || "")) {
    return "Imported Month";
  }

  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });
}

function createDefaultMonthName() {
  const lastMonthName = monthsData.at(-1)?.name;

  if (lastMonthName) {
    const parsed = new Date(lastMonthName);
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setMonth(parsed.getMonth() + 1);
      return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
  }

  return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getDefaultLists() {
  return {
    [LIST_KEYS.methods]: [
      "Cash",
      "Debit Card",
      "Credit Card",
      "Bank Transfer",
      "Direct Debit",
      "Standing Order",
      "PayPal",
      "Apple Pay",
      "Google Pay",
      "Other"
    ],
    [LIST_KEYS.coreTypes]: [
      "Utility",
      "Rent/Mortgage",
      "Insurance",
      "Subscription",
      "Loan",
      "Other"
    ],
    [LIST_KEYS.debtTypes]: [
      "Overdraft",
      "BNPL",
      "Finance Plan",
      "Debt"
    ]
  };
}

function showNotification(message, type = "info") {
  const notification = document.getElementById("notification");
  if (!notification) {
    return;
  }

  notification.textContent = message;
  notification.className = "notification show";

  if (type === "error") {
    notification.style.background = "var(--danger)";
  } else if (type === "success") {
    notification.style.background = "var(--success)";
  } else {
    notification.style.background = "var(--accent)";
  }

  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
  }

  notificationTimeout = window.setTimeout(() => {
    notification.className = "notification";
  }, 3000);
}

function showLoading(show) {
  const loading = document.getElementById("loading");
  if (loading) {
    loading.style.display = show ? "flex" : "none";
  }
}

function updateLastSaved(message) {
  const label = document.getElementById("last-saved");
  if (!label) {
    return;
  }

  if (message) {
    label.textContent = message;
    return;
  }

  const now = new Date();
  label.textContent = `Saved: ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function saveLists() {
  window.localStorage.setItem(STORAGE.lists, JSON.stringify(window.lists));
}

function loadLists() {
  const defaults = getDefaultLists();
  const saved = window.localStorage.getItem(STORAGE.lists);

  if (!saved) {
    window.lists = { ...defaults };
    saveLists();
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    window.lists = {
      [LIST_KEYS.methods]:
        Array.isArray(parsed?.[LIST_KEYS.methods]) && parsed[LIST_KEYS.methods].length
          ? parsed[LIST_KEYS.methods]
          : defaults[LIST_KEYS.methods],
      [LIST_KEYS.coreTypes]:
        Array.isArray(parsed?.[LIST_KEYS.coreTypes]) && parsed[LIST_KEYS.coreTypes].length
          ? parsed[LIST_KEYS.coreTypes]
          : defaults[LIST_KEYS.coreTypes],
      [LIST_KEYS.debtTypes]:
        Array.isArray(parsed?.[LIST_KEYS.debtTypes]) && parsed[LIST_KEYS.debtTypes].length
          ? parsed[LIST_KEYS.debtTypes]
          : defaults[LIST_KEYS.debtTypes]
    };
  } catch (error) {
    window.lists = { ...defaults };
    saveLists();
  }
}

function listTitle(key) {
  if (key === LIST_KEYS.methods) {
    return "Payment Methods";
  }

  if (key === LIST_KEYS.coreTypes) {
    return "Core Bill Types";
  }

  if (key === LIST_KEYS.debtTypes) {
    return "Debt / Overdraft Types";
  }

  return "Options";
}

function closeListManager() {
  if (listManagerOverlay) {
    listManagerOverlay.remove();
    listManagerOverlay = null;
  }
}

function openListManager(key) {
  closeListManager();

  const items = Array.isArray(window.lists[key]) ? window.lists[key] : [];

  const modalHtml = `
    <div class="modal">
      <div class="modal-header">
        <button class="modal-close" type="button" onclick="closeListManager()">Back</button>
        <h3>Manage: ${escapeHtml(listTitle(key))}</h3>
        <button class="modal-close" type="button" onclick="closeListManager()">Close</button>
      </div>
      <div class="modal-content">
        <p class="report-muted" style="margin-top:0;">
          Add, edit, or remove options. These update every related dropdown in the tracker.
        </p>
        <div id="list-manager-container">
          ${items.map((item, index) => `
            <div class="method-item">
              <input
                type="text"
                value="${escapeHtml(item)}"
                oninput="updateListItem('${key}', ${index}, this.value)"
                placeholder="Option name"
              >
              <button type="button" class="danger" onclick="removeListItem('${key}', ${index})">Remove</button>
            </div>
          `).join("")}
        </div>
        <div class="add-method-form">
          <input
            type="text"
            id="list-new-input"
            placeholder="New option"
            onkeypress="if (event.key === 'Enter') addListItem('${key}')"
          >
          <button type="button" class="success" onclick="addListItem('${key}')">Add</button>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="secondary" onclick="closeListManager()">Close</button>
        <button type="button" class="success" onclick="saveListManager('${key}')">Save & Close</button>
      </div>
    </div>
  `;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = modalHtml;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeListManager();
    }
  });

  document.body.appendChild(overlay);
  listManagerOverlay = overlay;

  window.setTimeout(() => {
    document.getElementById("list-new-input")?.focus();
  }, 50);
}

function updateListItem(key, index, value) {
  if (!Array.isArray(window.lists[key])) {
    window.lists[key] = [];
  }

  window.lists[key][index] = value;
}

function removeListItem(key, index) {
  if (!Array.isArray(window.lists[key])) {
    return;
  }

  if (window.lists[key].length <= 1) {
    showNotification("You must keep at least one option.", "error");
    return;
  }

  window.lists[key].splice(index, 1);
  openListManager(key);
}

function addListItem(key) {
  const input = document.getElementById("list-new-input");
  const value = (input?.value || "").trim();
  if (!value) {
    return;
  }

  const list = Array.isArray(window.lists[key]) ? window.lists[key] : [];
  if (list.some((item) => String(item).trim().toLowerCase() === value.toLowerCase())) {
    showNotification("This option already exists.", "error");
    return;
  }

  list.push(value);
  window.lists[key] = list;
  openListManager(key);
}

function saveListManager(key) {
  const unique = [];
  const seen = new Set();

  (window.lists[key] || []).forEach((item) => {
    const trimmed = String(item || "").trim();
    const signature = trimmed.toLowerCase();
    if (!trimmed || seen.has(signature)) {
      return;
    }

    seen.add(signature);
    unique.push(trimmed);
  });

  if (unique.length === 0) {
    showNotification("Keep at least one option in this list.", "error");
    return;
  }

  window.lists[key] = unique;
  saveLists();
  renderAllDynamicDropdowns();
  saveAll();
  closeListManager();
  showNotification("Options saved.", "success");
}

function getSelectHTML(key, current = "") {
  const items = Array.isArray(window.lists[key]) ? [...window.lists[key]] : [];
  const normalizedCurrent = String(current || "");

  if (normalizedCurrent && !items.includes(normalizedCurrent)) {
    items.unshift(normalizedCurrent);
  }

  const manageValue = `__manage__${key}`;

  return `
    <select data-dynamic-select="1" data-list-key="${escapeHtml(key)}" onchange="handleDynamicSelectChange(this)">
      <option value=""></option>
      ${items.map((item) => {
        const value = escapeHtml(item);
        const selected = item === normalizedCurrent ? "selected" : "";
        return `<option value="${value}" ${selected}>${value}</option>`;
      }).join("")}
      <option value="${manageValue}">Manage...</option>
    </select>
  `;
}

function handleDynamicSelectChange(select) {
  const key = select.getAttribute("data-list-key");
  const value = select.value;

  if (value && value.startsWith("__manage__")) {
    select.value = "";
    openListManager(key);
    return;
  }

  saveAll();
}

function renderAllDynamicDropdowns() {
  document.querySelectorAll('select[data-dynamic-select="1"]').forEach((select) => {
    const key = select.getAttribute("data-list-key");
    const current = select.value;
    select.outerHTML = getSelectHTML(key, current);
  });
}

function ensureRowId(row) {
  const nextRow = row && typeof row === "object" ? { ...row } : {};
  if (!nextRow._rid) {
    nextRow._rid = uid("row");
  }
  return nextRow;
}

function normalizeMonth(raw) {
  const month = raw && typeof raw === "object" ? raw : {};

  return {
    id: month.id || uid("month"),
    name: month.name || "New Month",
    coreBills: Array.isArray(month.coreBills) ? month.coreBills.map(ensureRowId) : [],
    overdraftEntries: Array.isArray(month.overdraftEntries) ? month.overdraftEntries.map(ensureRowId) : []
  };
}

function getPaidRadioGroup(rowId, paidValue = "not-paid") {
  const name = `paid_${rowId}`;
  const isPaid = paidValue === "paid";

  return `
    <div class="radio-group" data-paid-group="${escapeHtml(name)}">
      <label><input type="radio" name="${escapeHtml(name)}" value="paid" ${isPaid ? "checked" : ""} onchange="saveAll()">Paid</label>
      <label><input type="radio" name="${escapeHtml(name)}" value="not-paid" ${isPaid ? "" : "checked"} onchange="saveAll()">Not Paid</label>
    </div>
  `;
}

function getCoreBillsRow(data = {}) {
  const row = ensureRowId(data);

  return `
    <tr data-rid="${escapeHtml(row._rid)}">
      <td><input type="date" class="date-input" value="${escapeHtml(row.date || "")}" oninput="saveAll()"></td>
      <td>${getSelectHTML(LIST_KEYS.methods, row.method || "")}</td>
      <td><input type="text" class="company-input" value="${escapeHtml(row.company || "")}" placeholder="Company" oninput="saveAll()"></td>
      <td><input type="number" step="0.01" inputmode="decimal" value="${escapeHtml(row.amount ?? "")}" class="amount-input" placeholder="0.00" oninput="saveAll()"></td>
      <td>${getSelectHTML(LIST_KEYS.coreTypes, row.type || "")}</td>
      <td class="paid-status">${getPaidRadioGroup(row._rid, row.paid || "not-paid")}</td>
      <td class="actions"><button type="button" class="delete-btn" onclick="deleteRow(this)" title="Delete row">Delete</button></td>
    </tr>
  `;
}

function getOverdraftRow(data = {}) {
  const row = ensureRowId(data);

  return `
    <tr data-rid="${escapeHtml(row._rid)}">
      <td><input type="date" class="date-input" value="${escapeHtml(row.date || "")}" oninput="saveAll()"></td>
      <td>${getSelectHTML(LIST_KEYS.methods, row.method || "")}</td>
      <td><input type="text" class="company-input" value="${escapeHtml(row.company || "")}" placeholder="Bank / Company" oninput="saveAll()"></td>
      <td><input type="number" step="0.01" inputmode="decimal" value="${escapeHtml(row.amount ?? "")}" class="amount-input" placeholder="0.00" oninput="saveAll()"></td>
      <td>${getSelectHTML(LIST_KEYS.debtTypes, row.type || "")}</td>
      <td><input type="number" step="0.01" inputmode="decimal" value="${escapeHtml(row.currentBalance || "")}" class="current-balance" placeholder="Current balance" oninput="saveAll()"></td>
      <td><input type="number" step="0.01" inputmode="decimal" value="${escapeHtml(row.outstandingBalance || "")}" class="outstanding-balance" placeholder="Outstanding" oninput="saveAll()"></td>
      <td><input type="number" step="0.01" inputmode="decimal" value="${escapeHtml(row.limit || "")}" class="limit-input" placeholder="Limit" oninput="saveAll()"></td>
      <td class="paid-status">${getPaidRadioGroup(row._rid, row.paid || "not-paid")}</td>
      <td class="actions"><button type="button" class="delete-btn" onclick="deleteRow(this)" title="Delete row">Delete</button></td>
    </tr>
  `;
}

function createMonthElement(monthData) {
  const month = normalizeMonth(monthData);
  const container = document.createElement("div");
  container.className = "month-section";
  container.id = month.id;

  const coreRows = month.coreBills.length
    ? month.coreBills.map((row) => getCoreBillsRow(row)).join("")
    : getCoreBillsRow();

  const debtRows = month.overdraftEntries.length
    ? month.overdraftEntries.map((row) => getOverdraftRow(row)).join("")
    : getOverdraftRow();

  container.innerHTML = `
    <div class="month-header">
      <input type="text" class="month-name" value="${escapeHtml(month.name)}" oninput="saveAll()">
      <div class="month-actions">
        <button type="button" class="warning" onclick="clearMonth(${currentMonthIndex})">Clear</button>
        <button type="button" class="secondary" onclick="exportMonthCSV(${currentMonthIndex})">CSV</button>
        <button type="button" class="danger" onclick="deleteMonth(${currentMonthIndex})">Delete</button>
      </div>
    </div>

    <div class="overview-cards">
      <article class="overview-card">
        <span>Core bills total</span>
        <strong class="core-total">\u00A30.00</strong>
      </article>
      <article class="overview-card">
        <span>Debt / overdraft total</span>
        <strong class="overdraft-total">\u00A30.00</strong>
      </article>
      <article class="overview-card">
        <span>Remaining salary</span>
        <strong class="remaining-salary">\u00A30.00</strong>
      </article>
      <article class="overview-card">
        <span>Unpaid items</span>
        <strong class="unpaid-total">0</strong>
      </article>
    </div>

    <div class="table-section">
      <div class="table-header">
        <h3>Core Bills</h3>
      </div>
      <div class="table-container">
        <table id="core-bills-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Method</th>
              <th>Company</th>
              <th>Amount (GBP)</th>
              <th>Type</th>
              <th>Paid</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${coreRows}</tbody>
        </table>
      </div>
      <button type="button" class="secondary" style="margin-top:10px;" onclick="addCoreBillsRow(this)">+ Add Bill</button>
    </div>

    <div class="table-section">
      <div class="table-header">
        <h3>Overdraft Tracking, BNPL, Finance Plan, Debt Tracking</h3>
      </div>
      <div class="table-container">
        <table id="overdraft-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Method</th>
              <th>Bank / Company</th>
              <th>Amount (GBP)</th>
              <th>Type</th>
              <th>Current Balance</th>
              <th>Outstanding</th>
              <th>Limit</th>
              <th>Paid</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${debtRows}</tbody>
        </table>
      </div>
      <button type="button" class="secondary" style="margin-top:10px;" onclick="addOverdraftRow(this)">+ Add Entry</button>
      <span class="help-text">Overdraft tip: use Current Balance for what is used now, Outstanding for what remains, and Limit for the maximum available.</span>
    </div>

    <div class="summary">
      <div class="summary-item">
        <span>Total Core Bills</span>
        <b class="core-total">\u00A30.00</b>
      </div>
      <div class="summary-item">
        <span>Total Overdraft / Debt</span>
        <b class="overdraft-total">\u00A30.00</b>
      </div>
      <div class="summary-item summary-item--remaining">
        <span>Remaining Salary</span>
        <b class="remaining-salary">\u00A30.00</b>
      </div>
      <div class="summary-item">
        <span>Tracked Rows</span>
        <b class="row-count">0</b>
      </div>
    </div>
  `;

  return container;
}

function countUnpaidRows(monthElement) {
  let unpaid = 0;

  monthElement.querySelectorAll('tbody tr').forEach((row) => {
    if (getPaidValueFromRow(row) !== "paid") {
      unpaid += 1;
    }
  });

  return unpaid;
}

function setValueTone(element, value) {
  if (!element) {
    return;
  }

  element.classList.remove("value-positive", "value-negative", "value-neutral");
  if (value > 0) {
    element.classList.add("value-positive");
  } else if (value < 0) {
    element.classList.add("value-negative");
  } else {
    element.classList.add("value-neutral");
  }
}

function calculateMonthTotals(monthElement) {
  let coreTotal = 0;
  let debtTotal = 0;

  monthElement.querySelectorAll("#core-bills-table tbody tr").forEach((row) => {
    coreTotal += Number.parseFloat(row.querySelector(".amount-input")?.value || "0") || 0;
  });

  monthElement.querySelectorAll("#overdraft-table tbody tr").forEach((row) => {
    debtTotal += Number.parseFloat(row.querySelector(".amount-input")?.value || "0") || 0;
  });

  const salary = Number.parseFloat(document.getElementById("salary")?.value || "0") || 0;
  const remaining = salary - coreTotal - debtTotal;
  const unpaid = countUnpaidRows(monthElement);
  const rowCount = monthElement.querySelectorAll("tbody tr").length;

  monthElement.querySelectorAll(".core-total").forEach((element) => {
    element.textContent = formatCurrency(coreTotal);
  });

  monthElement.querySelectorAll(".overdraft-total").forEach((element) => {
    element.textContent = formatCurrency(debtTotal);
  });

  monthElement.querySelectorAll(".remaining-salary").forEach((element) => {
    element.textContent = formatCurrency(remaining);
    setValueTone(element, remaining);
  });

  monthElement.querySelector(".unpaid-total").textContent = String(unpaid);
  monthElement.querySelector(".row-count").textContent = String(rowCount);

  return { coreTotal, debtTotal, remaining, unpaid, rowCount };
}

function updateHeaderSummary(monthElement, totals) {
  const monthName = monthElement?.querySelector(".month-name")?.value || "No months yet";
  const activeMonth = document.getElementById("header-active-month");
  const coreTotal = document.getElementById("header-core-total");
  const debtTotal = document.getElementById("header-debt-total");
  const remaining = document.getElementById("header-remaining");
  const unpaid = document.getElementById("header-unpaid-count");

  activeMonth.textContent = monthName;
  coreTotal.textContent = formatCurrency(totals.coreTotal);
  debtTotal.textContent = formatCurrency(totals.debtTotal);
  remaining.textContent = formatCurrency(totals.remaining);
  unpaid.textContent = `${totals.unpaid}`;

  setValueTone(remaining, totals.remaining);
}

function updateAll() {
  const monthElement = document.querySelector(".month-section.active");
  if (!monthElement) {
    const remaining = document.getElementById("header-remaining");
    document.getElementById("header-active-month").textContent = "No months yet";
    document.getElementById("header-core-total").textContent = "\u00A30.00";
    document.getElementById("header-debt-total").textContent = "\u00A30.00";
    document.getElementById("header-unpaid-count").textContent = "0";
    remaining.textContent = "\u00A30.00";
    setValueTone(remaining, 0);
    return;
  }

  const totals = calculateMonthTotals(monthElement);
  updateHeaderSummary(monthElement, totals);
}

function renderCurrentMonth() {
  const container = document.getElementById("months-container");
  const pagination = document.getElementById("pagination");

  if (monthsData.length === 0) {
    container.innerHTML = `
      <div class="empty-state" id="empty-state">
        <h3>No months added yet</h3>
        <p>Click "Add Month" to start tracking your finances.</p>
      </div>
    `;
    pagination.hidden = true;
    updateAll();
    return;
  }

  container.innerHTML = "";
  const monthElement = createMonthElement(monthsData[currentMonthIndex]);
  monthElement.classList.add("active");
  container.appendChild(monthElement);

  pagination.hidden = false;
  updatePagination();
  updateAll();
}

function updatePagination() {
  const pageInfo = document.getElementById("page-info");
  const prevButton = document.getElementById("prev-btn");
  const nextButton = document.getElementById("next-btn");

  pageInfo.textContent = `Month ${currentMonthIndex + 1} of ${monthsData.length}`;
  prevButton.disabled = currentMonthIndex === 0;
  nextButton.disabled = currentMonthIndex === monthsData.length - 1;
}

function prevMonth() {
  if (currentMonthIndex <= 0) {
    return;
  }

  saveCurrentMonthData();
  currentMonthIndex -= 1;
  renderCurrentMonth();
}

function nextMonth() {
  if (currentMonthIndex >= monthsData.length - 1) {
    return;
  }

  saveCurrentMonthData();
  currentMonthIndex += 1;
  renderCurrentMonth();
}

function getPaidValueFromRow(row) {
  const rowId = row.getAttribute("data-rid");
  const name = `paid_${rowId}`;
  const checked = row.querySelector(`input[name="${cssEscape(name)}"]:checked`);
  return checked ? checked.value : "not-paid";
}

function saveCurrentMonthData() {
  const monthElement = document.querySelector(".month-section.active");
  if (!monthElement || !monthsData[currentMonthIndex]) {
    return;
  }

  const monthData = {
    id: monthElement.id,
    name: monthElement.querySelector(".month-name")?.value || "New Month",
    coreBills: [],
    overdraftEntries: []
  };

  monthElement.querySelectorAll("#core-bills-table tbody tr").forEach((row) => {
    const rowId = row.getAttribute("data-rid") || uid("row");
    monthData.coreBills.push({
      _rid: rowId,
      date: row.querySelector(".date-input")?.value || "",
      method: row.querySelector(`select[data-list-key="${cssEscape(LIST_KEYS.methods)}"]`)?.value || "",
      company: row.querySelector(".company-input")?.value || "",
      amount: row.querySelector(".amount-input")?.value || "",
      type: row.querySelector(`select[data-list-key="${cssEscape(LIST_KEYS.coreTypes)}"]`)?.value || "",
      paid: getPaidValueFromRow(row)
    });
  });

  monthElement.querySelectorAll("#overdraft-table tbody tr").forEach((row) => {
    const rowId = row.getAttribute("data-rid") || uid("row");
    monthData.overdraftEntries.push({
      _rid: rowId,
      date: row.querySelector(".date-input")?.value || "",
      method: row.querySelector(`select[data-list-key="${cssEscape(LIST_KEYS.methods)}"]`)?.value || "",
      company: row.querySelector(".company-input")?.value || "",
      amount: row.querySelector(".amount-input")?.value || "",
      type: row.querySelector(`select[data-list-key="${cssEscape(LIST_KEYS.debtTypes)}"]`)?.value || "",
      currentBalance: row.querySelector(".current-balance")?.value || "",
      outstandingBalance: row.querySelector(".outstanding-balance")?.value || "",
      limit: row.querySelector(".limit-input")?.value || "",
      paid: getPaidValueFromRow(row)
    });
  });

  monthsData[currentMonthIndex] = normalizeMonth(monthData);
}

function saveAll() {
  try {
    saveCurrentMonthData();

    const payload = {
      version: 2,
      salary: document.getElementById("salary")?.value || "0",
      months: monthsData,
      lastSaved: new Date().toISOString()
    };

    window.localStorage.setItem(STORAGE.data, JSON.stringify(payload));
    updateAll();
    updateLastSaved();
  } catch (error) {
    console.error("saveAll error:", error);
    showNotification("Error saving data.", "error");
  }
}

function addCoreBillsRow(button) {
  const table = button.previousElementSibling;
  const tbody = table?.querySelector("tbody");
  if (!tbody) {
    return;
  }

  tbody.insertAdjacentHTML("beforeend", getCoreBillsRow());
  const row = tbody.lastElementChild;
  row?.querySelector(".company-input")?.focus();
  saveAll();
}

function addOverdraftRow(button) {
  const table = button.previousElementSibling;
  const tbody = table?.querySelector("tbody");
  if (!tbody) {
    return;
  }

  tbody.insertAdjacentHTML("beforeend", getOverdraftRow());
  const row = tbody.lastElementChild;
  row?.querySelector(".company-input")?.focus();
  saveAll();
}

function deleteRow(button) {
  const row = button.closest("tr");
  const tbody = row?.parentElement;

  if (!row || !tbody) {
    return;
  }

  if (tbody.children.length <= 1) {
    showNotification("Cannot delete the last row. Clear the month instead.", "error");
    return;
  }

  row.remove();
  saveAll();
}

function addMonth() {
  saveCurrentMonthData();

  monthsData.push({
    id: uid("month"),
    name: createDefaultMonthName(),
    coreBills: [],
    overdraftEntries: []
  });

  currentMonthIndex = monthsData.length - 1;
  renderCurrentMonth();
  saveAll();
  showNotification("Month added successfully.", "success");
}

function clearMonth(index) {
  if (!monthsData[index]) {
    return;
  }

  if (!window.confirm("Clear all data in this month? This cannot be undone.")) {
    return;
  }

  monthsData[index].coreBills = [];
  monthsData[index].overdraftEntries = [];
  renderCurrentMonth();
  saveAll();
  showNotification("Month cleared.", "success");
}

function deleteMonth(index) {
  if (!window.confirm("Delete this entire month? This cannot be undone.")) {
    return;
  }

  monthsData.splice(index, 1);

  if (currentMonthIndex >= monthsData.length) {
    currentMonthIndex = Math.max(0, monthsData.length - 1);
  }

  renderCurrentMonth();
  saveAll();
  showNotification("Month deleted.", "success");
}

function closeTopModal() {
  if (listManagerOverlay) {
    closeListManager();
    return;
  }

  document.querySelector(".modal-overlay")?.remove();
}

function openModal(title, contentHtml, footerHtml = "") {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <button class="modal-close" type="button" onclick="this.closest('.modal-overlay').remove()">Back</button>
        <h3>${title}</h3>
        <button class="modal-close" type="button" onclick="this.closest('.modal-overlay').remove()">Close</button>
      </div>
      <div class="modal-content">${contentHtml}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ""}
    </div>
  `;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
}

function showPage(page) {
  const homeButton = document.getElementById("nav-home");
  const reportsButton = document.getElementById("nav-reports");
  const homePage = document.getElementById("home-page");
  const reportsPage = document.getElementById("reports-page");

  if (page === "home") {
    homeButton.classList.add("active");
    reportsButton.classList.remove("active");
    homePage.style.display = "block";
    reportsPage.classList.remove("active");
    return;
  }

  homeButton.classList.remove("active");
  reportsButton.classList.add("active");
  homePage.style.display = "none";
  reportsPage.classList.add("active");
}

function generateMonthlySummaryHTML() {
  const salary = Number.parseFloat(document.getElementById("salary")?.value || "0") || 0;

  return monthsData.map((month) => {
    const coreTotal = month.coreBills.reduce((sum, row) => sum + (Number.parseFloat(row.amount || "0") || 0), 0);
    const debtTotal = month.overdraftEntries.reduce((sum, row) => sum + (Number.parseFloat(row.amount || "0") || 0), 0);
    const remaining = salary - coreTotal - debtTotal;
    const unpaid = [...month.coreBills, ...month.overdraftEntries].filter((row) => row.paid !== "paid").length;

    return `
      <div class="report-summary-card">
        <h4 style="margin-bottom:10px;">${escapeHtml(month.name || "Month")}</h4>
        <div class="summary" style="margin:0;">
          <div class="summary-item"><span>Core Bills</span><b>${formatCurrency(coreTotal)}</b></div>
          <div class="summary-item"><span>Debt / Overdraft</span><b>${formatCurrency(debtTotal)}</b></div>
          <div class="summary-item"><span>Remaining</span><b class="${remaining >= 0 ? "value-positive" : "value-negative"}">${formatCurrency(remaining)}</b></div>
          <div class="summary-item"><span>Unpaid</span><b>${unpaid}</b></div>
        </div>
      </div>
    `;
  }).join("");
}

function showMonthlySummaryReport() {
  if (monthsData.length === 0) {
    showNotification("No data available for reports.", "error");
    return;
  }

  openModal(
    "Monthly Summary Report",
    generateMonthlySummaryHTML(),
    `
      <button type="button" class="success" onclick="exportPDF()">Export PDF</button>
      <button type="button" class="secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
    `
  );
}

function showCategoryBreakdown() {
  if (monthsData.length === 0) {
    showNotification("No data available for reports.", "error");
    return;
  }

  const totals = {};

  monthsData.forEach((month) => {
    month.coreBills.forEach((row) => {
      const key = row.type || "Uncategorized";
      totals[key] = (totals[key] || 0) + (Number.parseFloat(row.amount || "0") || 0);
    });
  });

  const content = Object.entries(totals)
    .sort((left, right) => right[1] - left[1])
    .map(([category, total]) => `
      <div class="report-row">
        <div class="report-row__split">
          <span>${escapeHtml(category)}</span>
          <b>${formatCurrency(total)}</b>
        </div>
      </div>
    `)
    .join("");

  openModal(
    "Category Breakdown",
    content || `<p class="report-muted" style="margin:0;">No category totals available yet.</p>`,
    `<button type="button" class="secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>`
  );
}

function showPaymentMethodAnalysis() {
  if (monthsData.length === 0) {
    showNotification("No data available for reports.", "error");
    return;
  }

  const totals = {};

  monthsData.forEach((month) => {
    month.coreBills.forEach((row) => {
      const key = row.method || "Not specified";
      totals[key] = (totals[key] || 0) + (Number.parseFloat(row.amount || "0") || 0);
    });

    month.overdraftEntries.forEach((row) => {
      const key = row.method || "Not specified";
      totals[key] = (totals[key] || 0) + (Number.parseFloat(row.amount || "0") || 0);
    });
  });

  const content = Object.entries(totals)
    .sort((left, right) => right[1] - left[1])
    .map(([method, total]) => `
      <div class="report-row">
        <div class="report-row__split">
          <span>${escapeHtml(method)}</span>
          <b>${formatCurrency(total)}</b>
        </div>
      </div>
    `)
    .join("");

  openModal(
    "Payment Method Analysis",
    content || `<p class="report-muted" style="margin:0;">No payment method totals available yet.</p>`,
    `<button type="button" class="secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>`
  );
}

function showDebtOverview() {
  if (monthsData.length === 0) {
    showNotification("No data available for reports.", "error");
    return;
  }

  const totals = {
    Debt: 0,
    Overdraft: 0,
    BNPL: 0,
    "Finance Plan": 0
  };

  monthsData.forEach((month) => {
    month.overdraftEntries.forEach((row) => {
      const key = row.type || "";
      if (Object.prototype.hasOwnProperty.call(totals, key)) {
        totals[key] += Number.parseFloat(row.amount || "0") || 0;
      }
    });
  });

  const grandTotal = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const content = `
    <div class="report-summary-card">
      ${Object.entries(totals).map(([label, total]) => `
        <div class="report-row__split" style="margin-bottom:10px;">
          <span>${escapeHtml(label)}</span>
          <b style="color:${label === "Debt" ? "var(--danger)" : "var(--warning)"};">${formatCurrency(total)}</b>
        </div>
      `).join("")}
    </div>
    <p class="report-muted" style="margin-bottom:0;text-align:center;">Total Outstanding: ${formatCurrency(grandTotal)}</p>
  `;

  openModal(
    "Debt & Overdraft Overview",
    content,
    `<button type="button" class="secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>`
  );
}

function showYearlyTrends() {
  if (monthsData.length === 0) {
    showNotification("No data available for reports.", "error");
    return;
  }

  const years = {};

  monthsData.forEach((month) => {
    const match = String(month.name || "").match(/\d{4}/);
    if (!match) {
      return;
    }

    const year = match[0];
    if (!years[year]) {
      years[year] = { core: 0, debt: 0, count: 0 };
    }

    years[year].core += month.coreBills.reduce((sum, row) => sum + (Number.parseFloat(row.amount || "0") || 0), 0);
    years[year].debt += month.overdraftEntries.reduce((sum, row) => sum + (Number.parseFloat(row.amount || "0") || 0), 0);
    years[year].count += 1;
  });

  const content = Object.entries(years)
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([year, data]) => `
      <div class="report-summary-card">
        <h4 style="margin-bottom:10px;">${year} (${data.count} months)</h4>
        <div class="report-row__split" style="margin-bottom:8px;">
          <span>Average Core Bills</span>
          <b>${formatCurrency(data.core / data.count)}/month</b>
        </div>
        <div class="report-row__split">
          <span>Average Debt / Overdraft</span>
          <b>${formatCurrency(data.debt / data.count)}/month</b>
        </div>
      </div>
    `)
    .join("");

  openModal(
    "Yearly Trends",
    content || `<p class="report-muted" style="margin:0;">No yearly trends available yet.</p>`,
    `<button type="button" class="secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>`
  );
}

function toggleDarkMode() {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  document.querySelector(".dark-toggle").textContent = isDark ? "Light Mode" : "Dark Mode";
  window.localStorage.setItem(STORAGE.dark, String(isDark));
}

function showBackupManager() {
  openModal(
    "Backup & Restore",
    `
      <p class="report-muted" style="margin-top:0;">Backup your tracker data or restore it from a previous export.</p>
      <div class="report-summary-card" style="margin-bottom:18px;">
        <h4 style="margin-bottom:8px;">Backup Data</h4>
        <p class="report-muted" style="margin-bottom:12px;">Download all months, lists, salary, and dark mode settings.</p>
        <button type="button" class="success" onclick="downloadBackup()">Download Backup</button>
      </div>
      <div class="report-summary-card">
        <h4 style="margin-bottom:8px;">Restore Data</h4>
        <p class="report-muted" style="margin-bottom:12px;">Upload a backup file to replace the current tracker data.</p>
        <input type="file" id="restore-file" accept=".json,application/json" style="margin-bottom:12px;">
        <button type="button" class="secondary" onclick="restoreBackup()">Restore from Backup</button>
        <p class="report-muted" style="margin-bottom:0;margin-top:10px;color:var(--danger);">Warning: restoring will replace all current data.</p>
      </div>
    `,
    `<button type="button" class="secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>`
  );
}

function safeParseJSON(text) {
  return JSON.parse(String(text || "").replace(/^\uFEFF/, "").trim());
}

function normalizeBackup(raw) {
  let payload = raw;

  if (payload && typeof payload === "object") {
    if (payload.data && typeof payload.data === "object") {
      payload = payload.data;
    } else if (payload.backup && typeof payload.backup === "object") {
      payload = payload.backup;
    }
  }

  const months =
    (Array.isArray(payload?.months) && payload.months) ||
    (Array.isArray(raw?.data?.months) && raw.data.months) ||
    (Array.isArray(raw?.backup?.months) && raw.backup.months) ||
    null;

  if (!months) {
    throw new Error("Invalid backup: months array not found");
  }

  return {
    salary: payload?.salary ?? "0",
    months,
    lists: payload?.lists && typeof payload.lists === "object" ? payload.lists : null,
    paymentMethods: Array.isArray(payload?.paymentMethods) ? payload.paymentMethods : null,
    darkMode: typeof payload?.darkMode === "boolean" ? payload.darkMode : null
  };
}

function downloadBackup() {
  try {
    saveAll();
  } catch (error) {
    // ignore save failure here and continue with best available snapshot
  }

  const backup = {
    version: 2,
    exported: new Date().toISOString(),
    salary: document.getElementById("salary")?.value || "0",
    months: monthsData,
    lists: {
      methods: window.lists[LIST_KEYS.methods] || [],
      coreTypes: window.lists[LIST_KEYS.coreTypes] || [],
      debtTypes: window.lists[LIST_KEYS.debtTypes] || []
    },
    darkMode: document.body.classList.contains("dark")
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `financial-tracker-backup-${todayIso()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showNotification("Backup downloaded successfully.", "success");
  document.querySelector(".modal-overlay")?.remove();
}

function restoreBackup() {
  const file = document.getElementById("restore-file")?.files?.[0];
  if (!file) {
    showNotification("Please select a backup file.", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const raw = safeParseJSON(event.target?.result);
      const backup = normalizeBackup(raw);

      if (!window.confirm("Restore backup? This will replace all current data.")) {
        return;
      }

      document.getElementById("salary").value = backup.salary ?? "0";

      if (backup.lists) {
        if (Array.isArray(backup.lists.methods) && backup.lists.methods.length) {
          window.lists[LIST_KEYS.methods] = backup.lists.methods;
        }
        if (Array.isArray(backup.lists.coreTypes) && backup.lists.coreTypes.length) {
          window.lists[LIST_KEYS.coreTypes] = backup.lists.coreTypes;
        }
        if (Array.isArray(backup.lists.debtTypes) && backup.lists.debtTypes.length) {
          window.lists[LIST_KEYS.debtTypes] = backup.lists.debtTypes;
        }
      }

      if (backup.paymentMethods?.length) {
        window.lists[LIST_KEYS.methods] = backup.paymentMethods;
      }

      saveLists();
      monthsData = backup.months.map(normalizeMonth);
      currentMonthIndex = 0;

      if (typeof backup.darkMode === "boolean") {
        document.body.classList.toggle("dark", backup.darkMode);
        document.querySelector(".dark-toggle").textContent = backup.darkMode ? "Light Mode" : "Dark Mode";
        window.localStorage.setItem(STORAGE.dark, String(backup.darkMode));
      }

      renderCurrentMonth();
      saveAll();
      showNotification("Backup restored successfully.", "success");
      document.querySelector(".modal-overlay")?.remove();
    } catch (error) {
      console.error("restoreBackup error:", error);
      showNotification("Error restoring backup. Invalid file format.", "error");
    }
  };

  reader.onerror = () => {
    showNotification("Could not read the selected file.", "error");
  };

  reader.readAsText(file);
}

function downloadCSV(data, filename) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportMonthCSV(index) {
  saveAll();
  const month = monthsData[index];
  if (!month) {
    return;
  }

  const csv = [];
  csv.push("Core Bills");
  csv.push("Date,Payment Method,Company,Amount,Payment Type,Paid Status");
  month.coreBills.forEach((row) => {
    csv.push([row.date, row.method, row.company, row.amount, row.type, row.paid]
      .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
      .join(","));
  });

  csv.push("");
  csv.push("Overdraft, BNPL, Finance Plan, Debt Tracking");
  csv.push("Date,Payment Method,Bank/Company,Amount,Payment Type,Current Balance,Outstanding Balance,Limit,Paid Status");
  month.overdraftEntries.forEach((row) => {
    csv.push([row.date, row.method, row.company, row.amount, row.type, row.currentBalance, row.outstandingBalance, row.limit, row.paid]
      .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
      .join(","));
  });

  downloadCSV(csv.join("\n"), `${sanitizeFilename(month.name)}_${todayIso()}.csv`);
  showNotification("CSV exported successfully.", "success");
}

function exportAllCSV() {
  saveAll();
  if (monthsData.length === 0) {
    showNotification("No data to export.", "error");
    return;
  }

  const csv = [];
  csv.push("Financial Tracker - All Data");
  csv.push(`Generated: ${new Date().toLocaleString()}`);
  csv.push(`Salary: ${formatCurrency(document.getElementById("salary")?.value || "0")}`);
  csv.push("");

  monthsData.forEach((month) => {
    csv.push(`Month: ${month.name || "Month"}`);
    csv.push("==================================================");

    if (month.coreBills.length) {
      csv.push("Core Bills");
      csv.push("Date,Payment Method,Company,Amount,Payment Type,Paid Status");
      month.coreBills.forEach((row) => {
        csv.push([row.date, row.method, row.company, row.amount, row.type, row.paid]
          .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
          .join(","));
      });
      csv.push("");
    }

    if (month.overdraftEntries.length) {
      csv.push("Overdraft, BNPL, Finance Plan, Debt Tracking");
      csv.push("Date,Payment Method,Bank/Company,Amount,Payment Type,Current Balance,Outstanding Balance,Limit,Paid Status");
      month.overdraftEntries.forEach((row) => {
        csv.push([row.date, row.method, row.company, row.amount, row.type, row.currentBalance, row.outstandingBalance, row.limit, row.paid]
          .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
          .join(","));
      });
    }

    csv.push("");
    csv.push("");
  });

  downloadCSV(csv.join("\n"), `financial_tracker_all_data_${todayIso()}.csv`);
  showNotification("All data exported to CSV.", "success");
}

function exportPDF() {
  saveAll();

  if (monthsData.length === 0) {
    showNotification("No data to export.", "error");
    return;
  }

  if (!window.jspdf?.jsPDF) {
    showNotification("PDF library not loaded.", "error");
    return;
  }

  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
  const salary = Number.parseFloat(document.getElementById("salary")?.value || "0") || 0;

  doc.setFontSize(18);
  doc.text("Financial Tracker Report", 40, 50);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 68);
  doc.text(`Monthly Salary: ${formatCurrency(salary)}`, 40, 82);

  monthsData.forEach((month, index) => {
    if (index > 0) {
      doc.addPage();
    }

    let y = 60;
    doc.setFontSize(14);
    doc.text(String(month.name || "Month"), 40, y);
    y += 18;

    const coreRows = month.coreBills
      .filter((row) => row.date || row.company || row.amount || row.type || row.method)
      .map((row) => [
        row.date || "",
        row.method || "",
        row.company || "",
        formatCurrency(row.amount || 0),
        row.type || "",
        row.paid === "paid" ? "Paid" : "Not paid"
      ]);

    if (coreRows.length) {
      doc.setFontSize(11);
      doc.text("Core Bills", 40, y);
      y += 10;

      doc.autoTable({
        startY: y,
        head: [["Date", "Method", "Company", "Amount", "Type", "Paid"]],
        body: coreRows,
        theme: "grid",
        margin: { left: 40, right: 40 },
        styles: { fontSize: 9 },
        headStyles: { fillColor: [37, 99, 235] }
      });

      y = doc.lastAutoTable.finalY + 18;
    }

    const debtRows = month.overdraftEntries
      .filter((row) => row.date || row.company || row.amount || row.type || row.currentBalance || row.outstandingBalance || row.limit || row.method)
      .map((row) => [
        row.date || "",
        row.method || "",
        row.company || "",
        formatCurrency(row.amount || 0),
        row.type || "",
        row.currentBalance ? formatCurrency(row.currentBalance) : "",
        row.outstandingBalance ? formatCurrency(row.outstandingBalance) : "",
        row.limit ? formatCurrency(row.limit) : "",
        row.paid === "paid" ? "Paid" : "Not paid"
      ]);

    if (debtRows.length) {
      doc.setFontSize(11);
      doc.text("Overdraft / BNPL / Finance Plan / Debt", 40, y);
      y += 10;

      doc.autoTable({
        startY: y,
        head: [["Date", "Method", "Company", "Amount", "Type", "Current", "Outstanding", "Limit", "Paid"]],
        body: debtRows,
        theme: "grid",
        margin: { left: 40, right: 40 },
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235] }
      });

      y = doc.lastAutoTable.finalY + 18;
    }

    const coreTotal = month.coreBills.reduce((sum, row) => sum + (Number.parseFloat(row.amount || "0") || 0), 0);
    const debtTotal = month.overdraftEntries.reduce((sum, row) => sum + (Number.parseFloat(row.amount || "0") || 0), 0);
    const remaining = salary - coreTotal - debtTotal;

    doc.setFontSize(11);
    doc.text("Summary", 40, y);
    y += 14;
    doc.setFontSize(10);
    doc.text(`Total Core Bills: ${formatCurrency(coreTotal)}`, 55, y);
    y += 12;
    doc.text(`Total Overdraft / Debt: ${formatCurrency(debtTotal)}`, 55, y);
    y += 12;
    doc.text(`Remaining Salary: ${formatCurrency(remaining)}`, 55, y);
  });

  doc.save(`financial_tracker_report_${todayIso()}.pdf`);
  showNotification("PDF exported successfully.", "success");
}

function mapCategoryToCoreType(category) {
  const value = String(category || "").toLowerCase();

  if (value.includes("rent") || value.includes("mortgage") || value.includes("housing")) {
    return "Rent/Mortgage";
  }

  if (value.includes("utility") || value.includes("electric") || value.includes("water") || value.includes("gas")) {
    return "Utility";
  }

  if (value.includes("insurance")) {
    return "Insurance";
  }

  if (value.includes("loan") || value.includes("debt")) {
    return "Loan";
  }

  if (value.includes("subscription")) {
    return "Subscription";
  }

  return "Other";
}

function mapDebtType(type) {
  switch (String(type || "").toLowerCase()) {
    case "overdraft":
      return "Overdraft";
    case "finance-plan":
      return "Finance Plan";
    case "loan":
    case "mortgage":
      return "Debt";
    default:
      return "Debt";
  }
}

function importLegacyLedgerData() {
  const saved = window.localStorage.getItem(LEGACY_LEDGER_STORAGE);
  if (!saved) {
    return null;
  }

  try {
    const parsed = JSON.parse(saved);
    const transactions = Array.isArray(parsed?.transactions) ? parsed.transactions : [];
    const debts = Array.isArray(parsed?.debts) ? parsed.debts : [];

    if (!transactions.length && !debts.length) {
      return null;
    }

    const monthsByKey = new Map();
    const incomeByMonth = new Map();

    transactions.forEach((transaction) => {
      if (!transaction || typeof transaction !== "object") {
        return;
      }

      const date = String(transaction.date || todayIso());
      const monthKey = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : todayIso().slice(0, 7);

      if (!monthsByKey.has(monthKey)) {
        monthsByKey.set(monthKey, {
          id: uid("month"),
          name: monthLabelFromKey(monthKey),
          coreBills: [],
          overdraftEntries: []
        });
      }

      const month = monthsByKey.get(monthKey);
      const amount = Number.parseFloat(transaction.amount || "0") || 0;

      if (transaction.type === "income") {
        incomeByMonth.set(monthKey, (incomeByMonth.get(monthKey) || 0) + amount);
        return;
      }

      month.coreBills.push(ensureRowId({
        date,
        method: "",
        company: transaction.description || transaction.category || "Imported expense",
        amount: amount ? String(amount) : "",
        type: mapCategoryToCoreType(transaction.category),
        paid: "paid"
      }));
    });

    const orderedMonths = [...monthsByKey.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map((entry) => entry[1]);

    const targetMonth = orderedMonths.at(-1) || {
      id: uid("month"),
      name: monthLabelFromKey(todayIso().slice(0, 7)),
      coreBills: [],
      overdraftEntries: []
    };

    debts.forEach((debt) => {
      if (!debt || typeof debt !== "object") {
        return;
      }

      targetMonth.overdraftEntries.push(ensureRowId({
        date: todayIso(),
        method: "",
        company: debt.name || "Imported debt",
        amount: debt.minimumPayment ? String(debt.minimumPayment) : "",
        type: mapDebtType(debt.type),
        currentBalance: debt.balance ? String(debt.balance) : "",
        outstandingBalance: debt.balance ? String(debt.balance) : "",
        limit: debt.creditLimit ? String(debt.creditLimit) : "",
        paid: "not-paid"
      }));
    });

    if (!orderedMonths.length) {
      orderedMonths.push(targetMonth);
    }

    const mostRecentIncome = [...incomeByMonth.keys()]
      .sort()
      .at(-1);

    return {
      salary: mostRecentIncome ? String(incomeByMonth.get(mostRecentIncome) || 0) : "0",
      months: orderedMonths.map(normalizeMonth)
    };
  } catch (error) {
    console.error("Legacy ledger import failed:", error);
    return null;
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
    return;
  }

  navigator.serviceWorker.register("service-worker.js").catch(() => {
    // offline support is optional here
  });
}

function initApp() {
  showLoading(true);

  try {
    const darkMode = window.localStorage.getItem(STORAGE.dark);
    if (darkMode === "true") {
      document.body.classList.add("dark");
      document.querySelector(".dark-toggle").textContent = "Light Mode";
    }

    loadLists();

    const saved = window.localStorage.getItem(STORAGE.data);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed?.salary != null) {
          document.getElementById("salary").value = parsed.salary;
        }
        if (Array.isArray(parsed?.months)) {
          monthsData = parsed.months.map(normalizeMonth);
        }
      } catch (error) {
        console.error("Error parsing saved data:", error);
        monthsData = [];
      }
    }

    if (!monthsData.length) {
      const legacyImport = importLegacyLedgerData();
      if (legacyImport) {
        monthsData = legacyImport.months;
        document.getElementById("salary").value = legacyImport.salary;
        showNotification("Imported data from the previous ledger layout.", "success");
        saveAll();
      }
    }

    if (monthsData.length) {
      currentMonthIndex = Math.min(currentMonthIndex, monthsData.length - 1);
      renderCurrentMonth();
    } else {
      renderCurrentMonth();
    }

    updateLastSaved("Ready");
    registerServiceWorker();
  } catch (error) {
    console.error(error);
    showNotification("Error loading your tracker. Starting fresh.", "error");
  } finally {
    showLoading(false);
  }
}

window.setInterval(() => {
  try {
    saveAll();
  } catch (error) {
    // ignore periodic save failure
  }
}, 30000);

window.addEventListener("beforeunload", () => {
  try {
    saveAll();
  } catch (error) {
    // ignore save on unload failure
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveAll();
    showNotification("Data saved.", "success");
    return;
  }

  if (event.key === "Escape") {
    closeTopModal();
    return;
  }

  const tagName = document.activeElement?.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return;
  }

  if (event.key === "ArrowLeft") {
    prevMonth();
  } else if (event.key === "ArrowRight") {
    nextMonth();
  }
});

document.addEventListener("DOMContentLoaded", initApp);
