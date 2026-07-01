const ONE_HOUR = 60 * 60 * 1000;

export const faultLabels = {
  user_abandoned: "User abandoned",
  awaiting_provider: "Awaiting provider",
  provider_rejected: "Provider rejected",
  provider_reversal: "Provider reversal",
  site_tracking_issue: "Site tracking issue",
  duplicate_account_risk: "Duplicate account risk",
  manual_review_needed: "Manual review needed",
  unknown: "Unknown"
};

export const timelineLabels = {
  clicked: "Opened",
  provider_opened: "Provider opened",
  started: "Started",
  pending: "Waiting for provider",
  approved: "Credited",
  rejected: "Rejected",
  reversed: "Reversed",
  expired: "Expired",
  disputed: "Needs review"
};

export function createEmptyState(now = new Date().toISOString()) {
  return {
    createdAt: now,
    attempts: [],
    ledger: [],
    incidents: [],
    processedPostbacks: [],
    disputes: [],
    manualReviews: []
  };
}

export function createOfferAttempt(input, now = new Date().toISOString()) {
  const clickId = input.clickId || makeId("clk", input.userId, input.offerId, now);
  const sessionId = input.sessionId || makeId("ses", input.userId, input.provider, now);

  return {
    id: input.id || makeId("att", input.userId, input.offerId, now),
    userId: input.userId,
    provider: input.provider,
    offerId: input.offerId,
    offerName: input.offerName,
    expectedPoints: Number(input.expectedPoints || 0),
    clickId,
    sessionId,
    outboundUrl: input.outboundUrl,
    deviceRisk: {
      ipAddress: input.ipAddress || "unknown",
      deviceFingerprint: input.deviceFingerprint || "unknown",
      riskScore: Number(input.riskScore || 0),
      duplicateSignals: input.duplicateSignals || []
    },
    status: "clicked",
    fault: "awaiting_provider",
    creditState: "tracked",
    createdAt: now,
    updatedAt: now,
    events: [
      event("clicked", "local", "Offer opened and tracked before redirect.", now, {
        clickId,
        sessionId,
        outboundUrl: input.outboundUrl
      })
    ],
    providerEvents: []
  };
}

export function addAttempt(state, attempt) {
  return {
    ...state,
    attempts: [...state.attempts, attempt]
  };
}

export function applyProviderPostback(state, postback, options = {}) {
  const now = options.now || new Date().toISOString();
  const idempotencyKey = postback.idempotencyKey;

  if (!options.signatureValid) {
    return recordIncident(state, {
      type: "malformed_postback",
      severity: "high",
      provider: postback.provider,
      clickId: postback.clickId,
      message: "Provider postback failed signature validation.",
      rawEvent: postback
    }, now);
  }

  if (state.processedPostbacks.includes(idempotencyKey)) {
    return {
      ...state,
      incidents: [
        ...state.incidents,
        {
          id: makeId("inc", idempotencyKey, "duplicate", now),
          type: "duplicate_postback",
          severity: "low",
          provider: postback.provider,
          clickId: postback.clickId,
          message: "Duplicate provider postback ignored.",
          createdAt: now,
          rawEvent: postback
        }
      ]
    };
  }

  const attempt = state.attempts.find((candidate) => candidate.clickId === postback.clickId);
  if (!attempt) {
    return recordIncident({
      ...state,
      processedPostbacks: [...state.processedPostbacks, idempotencyKey]
    }, {
      type: "orphan_postback",
      severity: "medium",
      provider: postback.provider,
      clickId: postback.clickId,
      message: "Provider sent a valid postback for an unknown local click ID.",
      rawEvent: postback
    }, now);
  }

  const providerEvent = event(mapProviderStatus(postback.status), "provider", providerMessage(postback), now, {
    idempotencyKey,
    rawStatus: postback.status,
    points: Number(postback.points || 0),
    providerUserId: postback.providerUserId || null
  });

  const updatedAttempt = reduceAttemptWithProviderEvent(attempt, postback, providerEvent, now);
  const ledgerEntries = ledgerEntriesForPostback(attempt, updatedAttempt, postback, now);

  return {
    ...state,
    processedPostbacks: [...state.processedPostbacks, idempotencyKey],
    attempts: state.attempts.map((candidate) => (
      candidate.id === updatedAttempt.id ? updatedAttempt : candidate
    )),
    ledger: [...state.ledger, ...ledgerEntries]
  };
}

export function openDispute(state, attemptId, input, now = new Date().toISOString()) {
  const attempt = findAttempt(state, attemptId);
  const requiredProof = proofForAttempt(attempt);
  const dispute = {
    id: makeId("dsp", attemptId, input.userId, now),
    attemptId,
    userId: input.userId,
    status: "open",
    requiredProof,
    userEvidence: {
      completionTime: input.completionTime || null,
      screenshotNames: input.screenshotNames || [],
      emailReceipt: input.emailReceipt || null,
      appUserId: input.appUserId || null,
      notes: input.notes || ""
    },
    createdAt: now
  };

  return updateAttempt({
    ...state,
    disputes: [...state.disputes, dispute]
  }, attemptId, (candidate) => ({
    ...candidate,
    status: "disputed",
    fault: "manual_review_needed",
    updatedAt: now,
    events: [
      ...candidate.events,
      event("disputed", "user", "User opened a dispute with supporting evidence.", now, {
        requiredProof
      })
    ]
  }));
}

export function grantManualCredit(state, attemptId, input, now = new Date().toISOString()) {
  if (!input.reason || !input.evidence || !input.reviewerId) {
    throw new Error("Manual credit requires reason, evidence, and reviewerId.");
  }

  const attempt = findAttempt(state, attemptId);
  const points = Number(input.points || attempt.expectedPoints || 0);
  const ledgerEntry = ledger("manual_credit", attempt, points, "available", now, {
    reason: input.reason,
    evidence: input.evidence,
    reviewerId: input.reviewerId
  });
  const review = {
    id: makeId("rev", attemptId, input.reviewerId, now),
    attemptId,
    reviewerId: input.reviewerId,
    outcome: "manual_credit",
    reason: input.reason,
    evidence: input.evidence,
    points,
    createdAt: now
  };

  return updateAttempt({
    ...state,
    ledger: [...state.ledger, ledgerEntry],
    manualReviews: [...state.manualReviews, review]
  }, attemptId, (candidate) => ({
    ...candidate,
    status: "approved",
    fault: "unknown",
    creditState: "approved",
    updatedAt: now,
    events: [
      ...candidate.events,
      event("approved", "admin", "Manual credit granted after evidence review.", now, {
        reviewerId: input.reviewerId,
        points
      })
    ]
  }));
}

export function classifyAttempt(state, attempt, now = new Date().toISOString()) {
  const hasSiteIncident = state.incidents.some((incident) => incident.clickId === attempt.clickId);
  if (hasSiteIncident) return "site_tracking_issue";
  if (attempt.deviceRisk.duplicateSignals.length > 0 || attempt.deviceRisk.riskScore >= 80) {
    return "duplicate_account_risk";
  }
  if (attempt.status === "disputed") return "manual_review_needed";
  if (attempt.status === "rejected") return "provider_rejected";
  if (attempt.status === "reversed") return "provider_reversal";
  if (attempt.status === "approved") return "unknown";
  if (attempt.providerEvents.length > 0) return "awaiting_provider";

  const age = new Date(now).getTime() - new Date(attempt.createdAt).getTime();
  return age > 24 * ONE_HOUR ? "user_abandoned" : "awaiting_provider";
}

export function getBalances(state, userId) {
  return state.ledger
    .filter((entry) => entry.userId === userId)
    .reduce((totals, entry) => {
      totals[entry.bucket] += entry.points;
      return totals;
    }, { available: 0, pending: 0, rejected: 0, underReview: 0 });
}

export function getAttemptView(state, attemptId, now = new Date().toISOString()) {
  const attempt = findAttempt(state, attemptId);
  const fault = classifyAttempt(state, attempt, now);
  const disputes = state.disputes.filter((dispute) => dispute.attemptId === attemptId);
  const ledgerImpact = state.ledger.filter((entry) => entry.attemptId === attemptId);
  const incidents = state.incidents.filter((incident) => incident.clickId === attempt.clickId);

  return {
    ...attempt,
    fault,
    faultLabel: faultLabels[fault],
    displayStatus: timelineLabels[attempt.status] || "Unknown",
    timeline: attempt.events.map((item) => ({
      ...item,
      label: timelineLabels[item.type] || item.type
    })),
    disputes,
    incidents,
    ledgerImpact,
    userMessage: messageForFault(fault, attempt)
  };
}

export function getAnalytics(state) {
  const byProvider = {};
  for (const attempt of state.attempts) {
    const provider = byProvider[attempt.provider] || {
      provider: attempt.provider,
      attempts: 0,
      approved: 0,
      rejected: 0,
      reversed: 0,
      disputes: 0
    };
    provider.attempts += 1;
    provider.approved += attempt.status === "approved" ? 1 : 0;
    provider.rejected += attempt.status === "rejected" ? 1 : 0;
    provider.reversed += attempt.status === "reversed" ? 1 : 0;
    provider.disputes += attempt.status === "disputed" ? 1 : 0;
    byProvider[attempt.provider] = provider;
  }

  return Object.values(byProvider).map((provider) => ({
    ...provider,
    creditRate: provider.attempts === 0 ? 0 : Math.round((provider.approved / provider.attempts) * 100)
  }));
}

export function seedDemoState() {
  let state = createEmptyState("2026-06-29T11:00:00.000Z");
  const attempts = [
    createOfferAttempt({
      id: "att-raid",
      userId: "user-1",
      provider: "ToroX",
      offerId: "raid-shadow-level-12",
      offerName: "Reach Level 12 in Raid Quest",
      expectedPoints: 1800,
      clickId: "clk-raid",
      sessionId: "ses-raid",
      outboundUrl: "https://offers.example/raid?click_id=clk-raid",
      ipAddress: "198.51.100.24",
      deviceFingerprint: "dev-clean-1",
      riskScore: 12
    }, "2026-06-29T11:05:00.000Z"),
    createOfferAttempt({
      id: "att-survey",
      userId: "user-1",
      provider: "AdGem",
      offerId: "survey-fast-42",
      offerName: "Complete Profile Survey",
      expectedPoints: 350,
      clickId: "clk-survey",
      sessionId: "ses-survey",
      outboundUrl: "https://offers.example/survey?click_id=clk-survey",
      ipAddress: "198.51.100.24",
      deviceFingerprint: "dev-clean-1",
      riskScore: 18
    }, "2026-06-29T10:50:00.000Z"),
    createOfferAttempt({
      id: "att-duplicate",
      userId: "user-1",
      provider: "RevenueUniverse",
      offerId: "mobile-install-7",
      offerName: "Install and Open Budget App",
      expectedPoints: 620,
      clickId: "clk-duplicate",
      sessionId: "ses-duplicate",
      outboundUrl: "https://offers.example/install?click_id=clk-duplicate",
      ipAddress: "203.0.113.77",
      deviceFingerprint: "dev-risk-9",
      riskScore: 88,
      duplicateSignals: ["same_device_as_banned_user"]
    }, "2026-06-28T09:20:00.000Z")
  ];

  for (const attempt of attempts) state = addAttempt(state, attempt);
  state = applyProviderPostback(state, {
    provider: "ToroX",
    clickId: "clk-raid",
    idempotencyKey: "pb-raid-pending",
    offerId: "raid-shadow-level-12",
    status: "pending",
    points: 1800
  }, { signatureValid: true, now: "2026-06-29T11:30:00.000Z" });
  state = applyProviderPostback(state, {
    provider: "AdGem",
    clickId: "clk-survey",
    idempotencyKey: "pb-survey-approved",
    offerId: "survey-fast-42",
    status: "approved",
    points: 350
  }, { signatureValid: true, now: "2026-06-29T11:45:00.000Z" });
  state = openDispute(state, "att-duplicate", {
    userId: "user-1",
    completionTime: "2026-06-28 10:15 AM",
    screenshotNames: ["budget-app-open.png"],
    appUserId: "budget-user-8841",
    notes: "User says the app opened and tracked on the partner screen."
  }, "2026-06-29T12:00:00.000Z");
  return state;
}

function reduceAttemptWithProviderEvent(attempt, postback, providerEvent, now) {
  const status = mapProviderStatus(postback.status);
  const fault = faultForStatus(status);
  return {
    ...attempt,
    status,
    fault,
    creditState: creditStateForStatus(status),
    updatedAt: now,
    providerEvents: [...attempt.providerEvents, providerEvent],
    events: [...attempt.events, providerEvent]
  };
}

function ledgerEntriesForPostback(previousAttempt, updatedAttempt, postback, now) {
  const points = Number(postback.points || previousAttempt.expectedPoints || 0);
  const entries = [];
  if (updatedAttempt.status === "pending" && previousAttempt.creditState !== "pending") {
    entries.push(ledger("provider_pending", updatedAttempt, points, "pending", now, {
      idempotencyKey: postback.idempotencyKey
    }));
  }
  if (updatedAttempt.status === "approved") {
    const pendingEntry = previousAttempt.creditState === "pending"
      ? ledger("provider_pending_release", updatedAttempt, -points, "pending", now, {
        idempotencyKey: postback.idempotencyKey
      })
      : null;
    if (pendingEntry) entries.push(pendingEntry);
    entries.push(ledger("provider_approved", updatedAttempt, points, "available", now, {
      idempotencyKey: postback.idempotencyKey
    }));
  }
  if (updatedAttempt.status === "rejected") {
    if (previousAttempt.creditState === "pending") {
      entries.push(ledger("provider_rejected_release", updatedAttempt, -points, "pending", now, {
        idempotencyKey: postback.idempotencyKey
      }));
    }
    entries.push(ledger("provider_rejected", updatedAttempt, points, "rejected", now, {
      idempotencyKey: postback.idempotencyKey
    }));
  }
  if (updatedAttempt.status === "reversed") {
    const bucket = previousAttempt.creditState === "pending" ? "pending" : "available";
    entries.push(ledger("provider_reversal", updatedAttempt, -points, bucket, now, {
      idempotencyKey: postback.idempotencyKey
    }));
    entries.push(ledger("provider_reversal_audit", updatedAttempt, points, "rejected", now, {
      idempotencyKey: postback.idempotencyKey
    }));
  }
  return entries;
}

function mapProviderStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (["completed", "pending", "started"].includes(normalized)) return "pending";
  if (["approved", "credited", "paid"].includes(normalized)) return "approved";
  if (["rejected", "declined", "chargeback"].includes(normalized)) return "rejected";
  if (["reversed", "reversal", "clawed_back"].includes(normalized)) return "reversed";
  return "pending";
}

function creditStateForStatus(status) {
  if (status === "approved") return "approved";
  if (status === "pending") return "pending";
  if (status === "rejected" || status === "reversed") return "closed";
  return "tracked";
}

function faultForStatus(status) {
  if (status === "rejected") return "provider_rejected";
  if (status === "reversed") return "provider_reversal";
  if (status === "pending") return "awaiting_provider";
  return "unknown";
}

function providerMessage(postback) {
  return `Provider reported ${postback.status} for ${postback.offerId}.`;
}

function recordIncident(state, incidentInput, now) {
  return {
    ...state,
    incidents: [
      ...state.incidents,
      {
        id: makeId("inc", incidentInput.type, incidentInput.clickId || "none", now),
        ...incidentInput,
        createdAt: now
      }
    ]
  };
}

function updateAttempt(state, attemptId, reducer) {
  return {
    ...state,
    attempts: state.attempts.map((attempt) => (
      attempt.id === attemptId ? reducer(attempt) : attempt
    ))
  };
}

function findAttempt(state, attemptId) {
  const attempt = state.attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) throw new Error(`Unknown attempt: ${attemptId}`);
  return attempt;
}

function proofForAttempt(attempt) {
  if (attempt.offerName.toLowerCase().includes("survey")) {
    return ["completion time", "survey completion screenshot"];
  }
  if (attempt.offerName.toLowerCase().includes("install") || attempt.offerName.toLowerCase().includes("app")) {
    return ["completion time", "app user ID", "screenshot"];
  }
  return ["completion time", "screenshot or email receipt"];
}

function messageForFault(fault, attempt) {
  if (fault === "awaiting_provider") {
    return "We have your click, but the offer provider has not confirmed completion yet.";
  }
  if (fault === "user_abandoned") {
    return "We tracked the offer opening, but we have no provider activity after that point.";
  }
  if (fault === "provider_rejected") {
    return "The provider rejected this completion. You can dispute it with completion proof.";
  }
  if (fault === "provider_reversal") {
    return "The provider reversed this credit after approval. The original credit remains in the audit trail.";
  }
  if (fault === "site_tracking_issue") {
    return "We detected a platform tracking issue and routed this attempt for admin review.";
  }
  if (fault === "duplicate_account_risk") {
    return "This attempt needs review because duplicate-account risk signals were detected.";
  }
  if (fault === "manual_review_needed") {
    return "Support has the attempt and evidence trail queued for review.";
  }
  return `${attempt.offerName} has no current blocking issue.`;
}

function ledger(type, attempt, points, bucket, now, metadata = {}) {
  return {
    id: makeId("led", type, attempt.id, now),
    type,
    attemptId: attempt.id,
    userId: attempt.userId,
    provider: attempt.provider,
    offerId: attempt.offerId,
    points,
    bucket,
    createdAt: now,
    metadata
  };
}

function event(type, source, message, now, metadata = {}) {
  return {
    id: makeId("evt", type, source, now),
    type,
    source,
    message,
    createdAt: now,
    metadata
  };
}

function makeId(prefix, ...parts) {
  return `${prefix}-${parts.join("-")}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
