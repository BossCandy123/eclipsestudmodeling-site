import {
  faultLabels,
  getAnalytics,
  getAttemptView,
  getBalances,
  seedDemoState
} from "./crediting-engine.js";

const state = seedDemoState();
const userId = "user-1";
let selectedAttemptId = state.attempts[0].id;

const elements = {
  balances: document.querySelector("[data-balances]"),
  attempts: document.querySelector("[data-attempts]"),
  timeline: document.querySelector("[data-timeline]"),
  evidence: document.querySelector("[data-evidence]"),
  dispute: document.querySelector("[data-dispute]"),
  analytics: document.querySelector("[data-analytics]"),
  providerSummary: document.querySelector("[data-provider-summary]"),
  heroProof: document.querySelector("[data-hero-proof]"),
  selectedStatus: document.querySelector("[data-selected-status]"),
  selectedFacts: document.querySelector("[data-selected-facts]"),
  selectedTitles: document.querySelectorAll("[data-selected-title]"),
  selectedMessages: document.querySelectorAll("[data-selected-message]")
};

function render() {
  const selected = getAttemptView(state, selectedAttemptId);
  renderBalances();
  renderHeroProof();
  renderAttempts();
  renderTimeline(selected);
  renderEvidence(selected);
  renderDispute(selected);
  renderAnalytics();
  renderSelectedSummary(selected);
}

function renderBalances() {
  const balances = getBalances(state, userId);
  const cards = [
    ["Available", balances.available, "available"],
    ["Pending", balances.pending, "pending"],
    ["Rejected", balances.rejected, "rejected"],
    ["Under Review", state.disputes.length, "review"]
  ];
  elements.balances.innerHTML = cards.map(([label, value, tone]) => `
    <article class="metric metric-${tone}">
      <span>${label}</span>
      <strong>${value.toLocaleString()}</strong>
      <small>${metricCaption(tone)}</small>
    </article>
  `).join("");
}

function renderHeroProof() {
  const balances = getBalances(state, userId);
  const totalAttempts = state.attempts.length;
  const reviewedAttempts = state.attempts.filter((attempt) => (
    attempt.status === "disputed" || attempt.deviceRisk.riskScore >= 80
  )).length;
  const providerCount = new Set(state.attempts.map((attempt) => attempt.provider)).size;

  elements.heroProof.innerHTML = [
    {
      value: balances.available.toLocaleString(),
      label: "Available points only reflect trusted credit or audited manual review."
    },
    {
      value: `${providerCount}`,
      label: "Providers represented in the current attempt stream and analytics layer."
    },
    {
      value: `${reviewedAttempts}/${totalAttempts}`,
      label: "Attempts already routed into review or elevated for risk attention."
    }
  ].map((item) => `
    <div class="proof-pill">
      <strong>${item.value}</strong>
      <span>${item.label}</span>
    </div>
  `).join("");
}

function renderAttempts() {
  elements.attempts.innerHTML = state.attempts.map((attempt) => {
    const view = getAttemptView(state, attempt.id);
    return `
      <button class="attempt-row ${attempt.id === selectedAttemptId ? "is-active" : ""}" data-attempt-id="${attempt.id}">
        <span>
          <strong>${attempt.offerName}</strong>
          <small>${attempt.provider} · ${attempt.expectedPoints.toLocaleString()} pts</small>
        </span>
        <em class="status status-${view.fault}">${view.displayStatus}</em>
      </button>
    `;
  }).join("");

  for (const button of elements.attempts.querySelectorAll("[data-attempt-id]")) {
    button.addEventListener("click", () => {
      selectedAttemptId = button.dataset.attemptId;
      render();
    });
  }
}

function renderTimeline(selected) {
  elements.timeline.innerHTML = selected.timeline.map((item) => `
    <li>
      <span class="timeline-dot"></span>
      <div>
        <strong>${item.label}</strong>
        <p>${item.message}</p>
        <small>${formatTime(item.createdAt)} · ${item.source}</small>
      </div>
    </li>
  `).join("");
}

function renderEvidence(selected) {
  const incidentRows = selected.incidents.length === 0
    ? "<li>No site-side incident recorded.</li>"
    : selected.incidents.map((incident) => `<li>${incident.type}: ${incident.message}</li>`).join("");
  const ledgerRows = selected.ledgerImpact.length === 0
    ? "<li>No spendable ledger movement yet.</li>"
    : selected.ledgerImpact.map((entry) => (
      `<li>${entry.type}: ${entry.points > 0 ? "+" : ""}${entry.points} ${entry.bucket}</li>`
    )).join("");
  const flags = selected.deviceRisk.duplicateSignals.length === 0
    ? "No duplicate-account signals"
    : selected.deviceRisk.duplicateSignals.join(", ");

  elements.evidence.innerHTML = `
    <div class="evidence-block">
      <span>Fault classification</span>
      <strong>${faultLabels[selected.fault]}</strong>
      <p>${selected.userMessage}</p>
    </div>
    <div class="evidence-grid">
      <div>
        <span>Click ID</span>
        <strong>${selected.clickId}</strong>
      </div>
      <div>
        <span>Session</span>
        <strong>${selected.sessionId}</strong>
      </div>
      <div>
        <span>Risk score</span>
        <strong>${selected.deviceRisk.riskScore}</strong>
      </div>
      <div>
        <span>Device</span>
        <strong>${selected.deviceRisk.deviceFingerprint}</strong>
      </div>
    </div>
    <h3>Ledger impact</h3>
    <ul>${ledgerRows}</ul>
    <h3>Tracking incidents</h3>
    <ul>${incidentRows}</ul>
    <h3>Fraud flags</h3>
    <p>${flags}</p>
  `;
}

function renderSelectedSummary(selected) {
  for (const node of elements.selectedTitles) {
    node.textContent = selected.offerName;
  }

  for (const node of elements.selectedMessages) {
    node.textContent = selected.userMessage;
  }

  elements.selectedStatus.textContent = selected.displayStatus;
  elements.selectedStatus.className = `status status-${selected.fault}`;
  elements.selectedFacts.innerHTML = [
    {
      label: "Provider",
      value: selected.provider,
      note: `${selected.expectedPoints.toLocaleString()} point target`
    },
    {
      label: "Risk score",
      value: String(selected.deviceRisk.riskScore),
      note: selected.deviceRisk.duplicateSignals.length === 0
        ? "No duplicate markers"
        : selected.deviceRisk.duplicateSignals.join(", ")
    },
    {
      label: "Click proof",
      value: selected.clickId,
      note: `Session ${selected.sessionId}`
    },
    {
      label: "Current fault",
      value: selected.faultLabel,
      note: selected.timeline.at(-1)?.message || selected.userMessage
    }
  ].map((item) => `
    <article class="preview-fact">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
      <em>${item.note}</em>
    </article>
  `).join("");
}

function renderDispute(selected) {
  const latestDispute = selected.disputes[0];
  const proof = latestDispute
    ? latestDispute.requiredProof.join(", ")
    : "Only ask after provider delay, rejection, duplicate risk, or a site issue.";
  elements.dispute.innerHTML = `
    <label>
      Required proof
      <input value="${proof}" readonly>
    </label>
    <label>
      Completion time
      <input value="${latestDispute?.userEvidence.completionTime || ""}" placeholder="Only needed for review">
    </label>
    <label>
      App/game user ID or receipt
      <input value="${latestDispute?.userEvidence.appUserId || latestDispute?.userEvidence.emailReceipt || ""}" placeholder="Optional until requested">
    </label>
    <label>
      Notes
      <textarea placeholder="Explain what happened">${latestDispute?.userEvidence.notes || ""}</textarea>
    </label>
  `;
}

function renderAnalytics() {
  const analytics = getAnalytics(state);
  elements.analytics.innerHTML = analytics.map((row) => `
    <tr>
      <td>${row.provider}</td>
      <td>${row.attempts}</td>
      <td>${row.creditRate}%</td>
      <td>${row.rejected}</td>
      <td>${row.reversed}</td>
      <td>${row.disputes}</td>
    </tr>
  `).join("");

  const strongest = analytics.reduce((best, row) => (
    row.creditRate > best.creditRate ? row : best
  ), analytics[0]);
  const weakest = analytics.reduce((worst, row) => (
    row.creditRate < worst.creditRate ? row : worst
  ), analytics[0]);

  elements.providerSummary.textContent = strongest
    ? `${strongest.provider} leads this sample at ${strongest.creditRate}% confirmed credit rate, while ${weakest.provider} is the current attention point at ${weakest.creditRate}%.`
    : "Provider-level credit rate data will appear here as attempts accumulate.";
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function metricCaption(tone) {
  if (tone === "available") return "Trusted and withdrawable";
  if (tone === "pending") return "Tracked but not withdrawable";
  if (tone === "rejected") return "Denied or reversed";
  return "Needs operator review";
}

render();
