import { createHmac, timingSafeEqual } from "node:crypto";

export function signPostback(postback, secret) {
  return createHmac("sha256", secret)
    .update(canonicalPostbackPayload(postback))
    .digest("hex");
}

export function verifyPostbackSignature(postback, secret) {
  if (!postback.signature || !secret) return false;
  const expected = Buffer.from(signPostback({ ...postback, signature: undefined }, secret), "hex");
  const provided = Buffer.from(postback.signature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function canonicalPostbackPayload(postback) {
  return [
    postback.idempotencyKey,
    postback.provider,
    postback.clickId,
    postback.offerId,
    postback.status,
    Number(postback.points || 0)
  ].join("|");
}
