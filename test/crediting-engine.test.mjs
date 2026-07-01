import test from "node:test";
import assert from "node:assert/strict";
import {
  addAttempt,
  applyProviderPostback,
  classifyAttempt,
  createEmptyState,
  createOfferAttempt,
  getAttemptView,
  getBalances,
  grantManualCredit,
  openDispute
} from "../src/crediting-engine.js";
import { signPostback, verifyPostbackSignature } from "../src/postback-security.js";

const now = "2026-06-29T12:00:00.000Z";

function stateWithAttempt(input = {}) {
  const attempt = createOfferAttempt({
    id: "att-1",
    userId: "user-1",
    provider: "TestWall",
    offerId: "offer-1",
    offerName: "Install Test App",
    expectedPoints: 500,
    clickId: "click-1",
    sessionId: "session-1",
    outboundUrl: "https://offers.example/test",
    ...input
  }, now);
  return addAttempt(createEmptyState(now), attempt);
}

test("duplicate postbacks do not double-credit", () => {
  let state = stateWithAttempt();
  const postback = {
    provider: "TestWall",
    clickId: "click-1",
    idempotencyKey: "pb-1",
    offerId: "offer-1",
    status: "approved",
    points: 500
  };

  state = applyProviderPostback(state, postback, { signatureValid: true, now });
  state = applyProviderPostback(state, postback, { signatureValid: true, now });

  assert.equal(getBalances(state, "user-1").available, 500);
  assert.equal(state.incidents[0].type, "duplicate_postback");
});

test("invalid signatures are rejected and logged as site-side incidents", () => {
  let state = stateWithAttempt();
  state = applyProviderPostback(state, {
    provider: "TestWall",
    clickId: "click-1",
    idempotencyKey: "bad-1",
    offerId: "offer-1",
    status: "approved",
    points: 500
  }, { signatureValid: false, now });

  assert.equal(getBalances(state, "user-1").available, 0);
  assert.equal(state.incidents[0].type, "malformed_postback");
  assert.equal(getAttemptView(state, "att-1", now).fault, "site_tracking_issue");
});

test("completed offers move from tracked attempt to pending to approved", () => {
  let state = stateWithAttempt();
  state = applyProviderPostback(state, {
    provider: "TestWall",
    clickId: "click-1",
    idempotencyKey: "pb-pending",
    offerId: "offer-1",
    status: "pending",
    points: 500
  }, { signatureValid: true, now });

  assert.equal(getBalances(state, "user-1").pending, 500);
  assert.equal(getBalances(state, "user-1").available, 0);

  state = applyProviderPostback(state, {
    provider: "TestWall",
    clickId: "click-1",
    idempotencyKey: "pb-approved",
    offerId: "offer-1",
    status: "approved",
    points: 500
  }, { signatureValid: true, now });

  assert.equal(getBalances(state, "user-1").pending, 0);
  assert.equal(getBalances(state, "user-1").available, 500);
});

test("rejected and reversed offers preserve audit trail and update balances", () => {
  let state = stateWithAttempt();
  state = applyProviderPostback(state, {
    provider: "TestWall",
    clickId: "click-1",
    idempotencyKey: "pb-approved",
    offerId: "offer-1",
    status: "approved",
    points: 500
  }, { signatureValid: true, now });
  state = applyProviderPostback(state, {
    provider: "TestWall",
    clickId: "click-1",
    idempotencyKey: "pb-reversed",
    offerId: "offer-1",
    status: "reversed",
    points: 500
  }, { signatureValid: true, now });

  assert.equal(getBalances(state, "user-1").available, 0);
  assert.equal(getBalances(state, "user-1").rejected, 500);
  assert.equal(getAttemptView(state, "att-1", now).fault, "provider_reversal");
});

test("missing postbacks remain non-withdrawable and visible as awaiting provider", () => {
  const state = stateWithAttempt();
  const view = getAttemptView(state, "att-1", "2026-06-29T13:00:00.000Z");

  assert.equal(getBalances(state, "user-1").available, 0);
  assert.equal(view.fault, "awaiting_provider");
  assert.match(view.userMessage, /provider has not confirmed/);
});

test("old missing postbacks classify as user abandoned", () => {
  const state = stateWithAttempt();
  const attempt = state.attempts[0];

  assert.equal(classifyAttempt(state, attempt, "2026-07-01T13:00:00.000Z"), "user_abandoned");
});

test("admin manual credits require evidence and create ledger audit entries", () => {
  let state = stateWithAttempt();
  assert.throws(() => grantManualCredit(state, "att-1", {
    points: 500,
    reviewerId: "admin-1"
  }, now), /reason, evidence, and reviewerId/);

  state = grantManualCredit(state, "att-1", {
    points: 500,
    reason: "Receipt and app user ID match provider support response.",
    evidence: "ticket-123",
    reviewerId: "admin-1"
  }, now);

  assert.equal(getBalances(state, "user-1").available, 500);
  assert.equal(state.manualReviews[0].reviewerId, "admin-1");
});

test("user status page distinguishes provider delay, duplicate risk, and manual review", () => {
  let state = stateWithAttempt({
    riskScore: 90,
    duplicateSignals: ["same_wallet_as_banned_user"]
  });

  assert.equal(getAttemptView(state, "att-1", now).fault, "duplicate_account_risk");

  state = openDispute(state, "att-1", {
    userId: "user-1",
    completionTime: "2026-06-29 12:10 PM",
    screenshotNames: ["proof.png"],
    appUserId: "player-42"
  }, now);

  const view = getAttemptView(state, "att-1", now);
  assert.equal(view.fault, "duplicate_account_risk");
  assert.equal(view.disputes[0].requiredProof.includes("app user ID"), true);
});

test("postback signature helper verifies canonical provider payloads", () => {
  const secret = "provider-secret";
  const postback = {
    idempotencyKey: "pb-1",
    provider: "TestWall",
    clickId: "click-1",
    offerId: "offer-1",
    status: "approved",
    points: 500
  };
  const signed = { ...postback, signature: signPostback(postback, secret) };

  assert.equal(verifyPostbackSignature(signed, secret), true);
  assert.equal(verifyPostbackSignature({ ...signed, points: 999 }, secret), false);
});
