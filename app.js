const STORAGE_KEY = "northstar-ledger:v1";
const DEFAULT_BUDGET = 2500;
const CURRENCIES = ["USD", "GBP", "EUR", "CAD"];
const SAMPLE_TRANSACTIONS = [
  { description: "Monthly salary", amount: 4200, type: "income", category: "Salary", date: offsetDate(-25) },
  { description: "Studio rent", amount: 1380, type: "expense", category: "Housing", date: offsetDate(-22) },
  { description: "Coffee with client", amount: 18.5, type: "expense", category: "Food", date: offsetDate(-18) },
  { description: "Freelance invoice", amount: 640, type: "income", category: "Freelance", date: offsetDate(-15) },
  { description: "Train pass", amount: 92, type: "expense", category: "Transport", date: offsetDate(-12) },
  { description: "Savings transfer", amount: 350, type: "expense", category: "Savings", date: offsetDate(-9) },
  { description: "Groceries", amount: 126.4, type: "expense", category: "Food", date: offsetDate(-5) },
  { description: "Cinema night", amount: 34, type: "expense", category: "Entertainment", date: offsetDate(-2) }
].map(createTransactionRecord);

const elements = {
  transactionForm: document.getElementById("transactionForm"),
  descriptionInput: document.getElementById("descriptionInput"),
  amountInput: document.getElementById("amountInput"),
  typeInput: document.getElementById("typeInput"),
  categoryInput: document.getElementById("categoryInput"),
  dateInput: document.getElementById("dateInput"),
  searchInput: document.getElementById("searchInput"),
  filterTypeInput: document.getElementById("filterTypeInput"),
  monthFilterInput: document.getElementById("monthFilterInput"),
  sortInput: document.getElementById("sortInput"),
  budgetInput: document.getElementById("budgetInput"),
  currencyInput: document.getElementById("currencyInput"),
  clearFiltersButton: document.getElementById("clearFiltersButton"),
  exportButton: document.getElementById("exportButton"),
  transactionList: document.getElementById("transactionList"),
  transactionEmptyState: document.getElementById("transactionEmptyState"),
  topCategories: document.getElementById("topCategories"),
  loadSampleButtons: document.querySelectorAll('[data-action="load-sample"]'),
  fields: Array.from(document.querySelectorAll("[data-field]")).reduce((map, element) => {
    map[element.dataset.field] = element;
    return map;
  }, {})
};

const state = loadState();
let statusTimeout = null;

initialize();

function initialize() {
  state.transactions = state.transactions
    .map(normalizeTransaction)
    .filter(Boolean)
    .sort(sortByNewest);

  state.budget = Number.isFinite(state.budget) ? state.budget : DEFAULT_BUDGET;
  state.currency = CURRENCIES.includes(state.currency) ? state.currency : guessCurrency();

  elements.dateInput.value = todayKey();
  elements.budgetInput.value = state.budget.toFixed(2);
  elements.currencyInput.value = state.currency;

  bindEvents();
  refreshMonthOptions();
  render();
  registerServiceWorker();
}

function bindEvents() {
  elements.transactionForm.addEventListener("submit", handleTransactionSubmit);
  elements.transactionList.addEventListener("click", handleTransactionListClick);
  elements.exportButton.addEventListener("click", exportData);
  elements.clearFiltersButton.addEventListener("click", clearFilters);
  elements.budgetInput.addEventListener("change", handleBudgetChange);
  elements.currencyInput.addEventListener("change", handleCurrencyChange);
  elements.searchInput.addEventListener("input", render);
  elements.filterTypeInput.addEventListener("change", render);
  elements.monthFilterInput.addEventListener("change", render);
  elements.sortInput.addEventListener("change", render);

  elements.loadSampleButtons.forEach((button) => {
    button.addEventListener("click", loadSampleData);
  });
}

function handleTransactionSubmit(event) {
  event.preventDefault();

  const description = elements.descriptionInput.value.trim();
  const amount = Number.parseFloat(elements.amountInput.value);
  const type = elements.typeInput.value;
  const category = elements.categoryInput.value;
  const date = elements.dateInput.value;

  if (!description || !Number.isFinite(amount) || amount <= 0 || !date) {
    flashStatus("Add a description, a valid amount, and a date before saving.");
    return;
  }

  state.transactions.unshift(
    createTransactionRecord({
      description,
      amount,
      type,
      category,
      date
    })
  );

  persistState();
  refreshMonthOptions();
  render();

  elements.transactionForm.reset();
  elements.typeInput.value = "expense";
  elements.categoryInput.value = "Food";
  elements.dateInput.value = todayKey();
  elements.descriptionInput.focus();

  flashStatus("Transaction saved.");
}

function handleTransactionListClick(event) {
  const deleteButton = event.target.closest('[data-action="delete-transaction"]');
  if (!deleteButton) {
    return;
  }

  const { id } = deleteButton.dataset;
  state.transactions = state.transactions.filter((transaction) => transaction.id !== id);
  persistState();
  refreshMonthOptions();
  render();
  flashStatus("Transaction removed.");
}

function handleBudgetChange() {
  const parsedBudget = Number.parseFloat(elements.budgetInput.value);
  if (!Number.isFinite(parsedBudget) || parsedBudget < 0) {
    elements.budgetInput.value = state.budget.toFixed(2);
    flashStatus("Monthly budget must be zero or greater.");
    return;
  }

  state.budget = parsedBudget;
  persistState();
  render();
  flashStatus("Monthly budget updated.");
}

function handleCurrencyChange() {
  state.currency = elements.currencyInput.value;
  persistState();
  render();
  flashStatus(`Currency switched to ${state.currency}.`);
}

function clearFilters() {
  elements.searchInput.value = "";
  elements.filterTypeInput.value = "all";
  elements.monthFilterInput.value = "all";
  elements.sortInput.value = "newest";
  render();
  flashStatus("Filters cleared.");
}

function loadSampleData() {
  if (state.transactions.length > 0) {
    const shouldReplace = window.confirm("Replace the current entries with sample data?");
    if (!shouldReplace) {
      return;
    }
  }

  state.transactions = SAMPLE_TRANSACTIONS.map((transaction) => ({ ...transaction })).sort(sortByNewest);
  persistState();
  refreshMonthOptions();
  render();
  flashStatus("Sample data loaded.");
}

function exportData() {
  const snapshot = {
    exportedAt: new Date().toISOString(),
    budget: state.budget,
    currency: state.currency,
    transactions: state.transactions
  };

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `northstar-ledger-${todayKey()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  flashStatus("JSON export ready.");
}

function render() {
  const allTransactions = [...state.transactions].sort(sortByNewest);
  const visibleTransactions = applyFilters(allTransactions);

  const overall = summarize(allTransactions);
  const visible = summarize(visibleTransactions);
  const currentMonthTransactions = allTransactions.filter(
    (transaction) => monthKey(transaction.date) === monthKey(todayKey())
  );
  const currentMonth = summarize(currentMonthTransactions);

  updateHero(overall, currentMonth, allTransactions);
  updateVisibleMetrics(visible, visibleTransactions.length);
  renderTransactionList(visibleTransactions);
  renderCategoryBreakdown(visibleTransactions);
  renderBudgetHealth(currentMonth);
  syncStatusLine();
}

function updateHero(overall, currentMonth, transactions) {
  elements.fields.balanceValue.textContent = formatCurrency(overall.net);
  elements.fields.incomeValue.textContent = formatCurrency(overall.income);
  elements.fields.expenseValue.textContent = formatCurrency(overall.expenses);
  elements.fields.budgetValue.textContent = formatCurrency(state.budget);

  const budgetRemaining = state.budget - currentMonth.expenses;
  const budgetStatus = currentMonth.expenses === 0
    ? "No spend recorded yet"
    : budgetRemaining >= 0
      ? `${formatCurrency(budgetRemaining)} left this month`
      : `Over by ${formatCurrency(Math.abs(budgetRemaining))}`;

  elements.fields.budgetStatus.textContent = budgetStatus;
  elements.fields.budgetStatus.classList.toggle("is-over", budgetRemaining < 0);
  elements.fields.sparklinePoints.setAttribute("points", buildSparklinePoints(transactions));
}

function updateVisibleMetrics(visible, count) {
  const savingsRate = visible.income > 0
    ? ((visible.income - visible.expenses) / visible.income) * 100
    : 0;

  elements.fields.visibleNet.textContent = formatCurrency(visible.net);
  elements.fields.visibleSpend.textContent = formatCurrency(visible.expenses);
  elements.fields.averageTransaction.textContent = formatCurrency(visible.average);
  elements.fields.savingsRate.textContent = `${Math.round(savingsRate)}%`;
  elements.fields.transactionCount.textContent = String(count);
}

function renderTransactionList(transactions) {
  elements.transactionList.replaceChildren();

  if (transactions.length === 0) {
    elements.transactionEmptyState.textContent = state.transactions.length === 0
      ? "No transactions yet. Add your first entry or load the sample dataset."
      : "Nothing matches the current filters. Try clearing them.";
    elements.transactionEmptyState.classList.add("is-visible");
    return;
  }

  elements.transactionEmptyState.classList.remove("is-visible");

  transactions.forEach((transaction) => {
    const item = document.createElement("li");
    item.className = "transaction";

    const main = document.createElement("div");

    const title = document.createElement("h3");
    title.className = "transaction__title";
    title.textContent = transaction.description;

    const meta = document.createElement("div");
    meta.className = "transaction__meta";

    const category = document.createElement("span");
    category.className = "pill";
    category.textContent = transaction.category;

    const type = document.createElement("span");
    type.className = "pill";
    type.textContent = transaction.type === "income" ? "Income" : "Expense";

    const date = document.createElement("span");
    date.textContent = formatDate(transaction.date);

    meta.append(category, type, date);
    main.append(title, meta);

    const amount = document.createElement("div");
    amount.className = `transaction__amount transaction__amount--${transaction.type}`;
    amount.textContent = `${transaction.type === "expense" ? "-" : "+"}${formatCurrency(transaction.amount)}`;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "transaction__delete";
    deleteButton.dataset.action = "delete-transaction";
    deleteButton.dataset.id = transaction.id;
    deleteButton.setAttribute("aria-label", `Delete ${transaction.description}`);
    deleteButton.textContent = "Remove";

    item.append(main, amount, deleteButton);
    elements.transactionList.append(item);
  });
}

function renderBudgetHealth(currentMonth) {
  const daysElapsed = Math.max(1, new Date().getDate());
  const remaining = state.budget - currentMonth.expenses;
  const spentRatio = state.budget > 0 ? (currentMonth.expenses / state.budget) * 100 : 0;
  const clampedRatio = Math.min(100, Math.max(0, spentRatio));

  elements.fields.monthSpent.textContent = formatCurrency(currentMonth.expenses);
  elements.fields.remainingBudget.textContent = formatCurrency(remaining);
  elements.fields.dailySpend.textContent = formatCurrency(currentMonth.expenses / daysElapsed);
  elements.fields.monthLabel.textContent = formatMonth(monthKey(todayKey()));
  elements.fields.budgetMeter.style.width = `${clampedRatio}%`;
  elements.fields.budgetMeter.classList.toggle("is-over", spentRatio > 100);
  elements.fields.budgetMeterLabel.textContent = state.budget > 0
    ? `${Math.round(spentRatio)}% of the monthly budget used`
    : "Set a monthly budget to track runway";
}

function renderCategoryBreakdown(transactions) {
  elements.topCategories.replaceChildren();

  const expenseTransactions = transactions.filter((transaction) => transaction.type === "expense");
  const categoryTotals = new Map();

  expenseTransactions.forEach((transaction) => {
    const nextAmount = (categoryTotals.get(transaction.category) || 0) + transaction.amount;
    categoryTotals.set(transaction.category, nextAmount);
  });

  const rows = Array.from(categoryTotals.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);

  if (rows.length === 0) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "category-row--empty";
    emptyRow.textContent = "No expense categories to compare in the current view.";
    elements.topCategories.append(emptyRow);
    return;
  }

  const highest = rows[0][1];
  rows.forEach(([category, value]) => {
    const row = document.createElement("div");
    row.className = "category-row";

    const name = document.createElement("div");
    name.className = "category-row__name";
    name.textContent = category;

    const bar = document.createElement("div");
    bar.className = "category-row__bar";

    const fill = document.createElement("span");
    fill.className = "category-row__fill";
    fill.style.width = `${(value / highest) * 100}%`;
    bar.append(fill);

    const amount = document.createElement("div");
    amount.className = "category-row__value";
    amount.textContent = formatCurrency(value);

    row.append(name, bar, amount);
    elements.topCategories.append(row);
  });
}

function applyFilters(transactions) {
  const query = elements.searchInput.value.trim().toLowerCase();
  const filterType = elements.filterTypeInput.value;
  const filterMonth = elements.monthFilterInput.value;
  const sortType = elements.sortInput.value;

  const filtered = transactions.filter((transaction) => {
    const matchesQuery = !query
      || transaction.description.toLowerCase().includes(query)
      || transaction.category.toLowerCase().includes(query);
    const matchesType = filterType === "all" || transaction.type === filterType;
    const matchesMonth = filterMonth === "all" || monthKey(transaction.date) === filterMonth;
    return matchesQuery && matchesType && matchesMonth;
  });

  return filtered.sort((left, right) => {
    if (sortType === "oldest") {
      return left.date.localeCompare(right.date);
    }
    if (sortType === "highest") {
      return right.amount - left.amount;
    }
    if (sortType === "lowest") {
      return left.amount - right.amount;
    }
    if (sortType === "alpha") {
      return left.description.localeCompare(right.description);
    }
    return sortByNewest(left, right);
  });
}

function refreshMonthOptions() {
  const previousValue = elements.monthFilterInput.value;
  const months = Array.from(new Set(state.transactions.map((transaction) => monthKey(transaction.date))))
    .filter(Boolean)
    .sort()
    .reverse();

  elements.monthFilterInput.replaceChildren();
  elements.monthFilterInput.append(new Option("All months", "all"));
  months.forEach((value) => {
    elements.monthFilterInput.append(new Option(formatMonth(value), value));
  });

  elements.monthFilterInput.value = months.includes(previousValue) ? previousValue : "all";
}

function summarize(transactions) {
  const summary = {
    income: 0,
    expenses: 0,
    net: 0,
    average: 0
  };

  transactions.forEach((transaction) => {
    if (transaction.type === "income") {
      summary.income += transaction.amount;
    } else {
      summary.expenses += transaction.amount;
    }
  });

  summary.net = summary.income - summary.expenses;
  summary.average = transactions.length > 0
    ? transactions.reduce((total, transaction) => total + transaction.amount, 0) / transactions.length
    : 0;

  return summary;
}

function buildSparklinePoints(transactions) {
  const months = lastMonthKeys(6);
  const points = months.map((month) => {
    return transactions
      .filter((transaction) => monthKey(transaction.date) === month)
      .reduce((total, transaction) => {
        return total + (transaction.type === "income" ? transaction.amount : -transaction.amount);
      }, 0);
  });

  const width = 320;
  const height = 96;
  const padding = 12;
  const minValue = Math.min(...points, 0);
  const maxValue = Math.max(...points, 0);
  const range = maxValue - minValue || 1;

  return points
    .map((value, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(1, points.length - 1);
      const normalized = (value - minValue) / range;
      const y = height - padding - normalized * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function loadState() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return { transactions: [], budget: DEFAULT_BUDGET, currency: guessCurrency() };
    }

    const parsed = JSON.parse(saved);
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      budget: parsed.budget,
      currency: parsed.currency
    };
  } catch (error) {
    return { transactions: [], budget: DEFAULT_BUDGET, currency: guessCurrency() };
  }
}

function persistState() {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        transactions: state.transactions,
        budget: state.budget,
        currency: state.currency
      })
    );
  } catch (error) {
    flashStatus("Saving is unavailable in this browser session.");
  }
}

function normalizeTransaction(transaction) {
  if (!transaction || typeof transaction !== "object") {
    return null;
  }

  const amount = Number.parseFloat(transaction.amount);
  if (!transaction.description || !Number.isFinite(amount) || amount <= 0 || !transaction.date) {
    return null;
  }

  return {
    id: typeof transaction.id === "string" && transaction.id ? transaction.id : generateId(),
    description: String(transaction.description),
    amount,
    type: transaction.type === "income" ? "income" : "expense",
    category: transaction.category ? String(transaction.category) : "Other",
    date: String(transaction.date)
  };
}

function createTransactionRecord(transaction) {
  return {
    id: generateId(),
    description: transaction.description,
    amount: Number(transaction.amount),
    type: transaction.type,
    category: transaction.category,
    date: transaction.date
  };
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") {
    return;
  }

  navigator.serviceWorker.register("service-worker.js").catch(() => {
    flashStatus("Service worker registration was skipped in this environment.");
  });
}

function flashStatus(message) {
  window.clearTimeout(statusTimeout);
  elements.fields.statusMessage.textContent = message;
  statusTimeout = window.setTimeout(() => {
    statusTimeout = null;
    syncStatusLine();
  }, 3200);
}

function syncStatusLine() {
  if (statusTimeout !== null) {
    return;
  }

  elements.fields.statusMessage.textContent = state.transactions.length === 0
    ? "No entries yet. Add your first transaction to wake up the dashboard."
    : "Everything is stored locally in this browser.";
}

function formatCurrency(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: state.currency,
    maximumFractionDigits: 2
  }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function formatMonth(value) {
  const [year, month] = value.split("-");
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long"
  }).format(new Date(Number(year), Number(month) - 1, 1));
}

function monthKey(dateString) {
  return String(dateString).slice(0, 7);
}

function todayKey() {
  return formatDateKey(new Date());
}

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function lastMonthKeys(count) {
  const months = [];
  const cursor = new Date();
  cursor.setDate(1);

  for (let index = count - 1; index >= 0; index -= 1) {
    const snapshot = new Date(cursor.getFullYear(), cursor.getMonth() - index, 1);
    months.push(`${snapshot.getFullYear()}-${String(snapshot.getMonth() + 1).padStart(2, "0")}`);
  }

  return months;
}

function sortByNewest(left, right) {
  return right.date.localeCompare(left.date);
}

function guessCurrency() {
  const locale = navigator.language || "en-US";
  if (locale.startsWith("en-GB")) {
    return "GBP";
  }
  if (locale.startsWith("en-CA") || locale.startsWith("fr-CA")) {
    return "CAD";
  }
  if (
    locale.startsWith("fr")
    || locale.startsWith("de")
    || locale.startsWith("es")
    || locale.startsWith("it")
    || locale.startsWith("pt")
    || locale.startsWith("nl")
  ) {
    return "EUR";
  }
  return "USD";
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function generateId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `txn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
