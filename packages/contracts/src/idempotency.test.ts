import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateIdempotencyKey,
  canonicalizePayload,
  computePayloadHash,
  checkIdempotency,
  type IdempotencyRecord,
} from "./idempotency.ts";

test("generateIdempotencyKey: produces distinct UUID-shaped keys", () => {
  const a = generateIdempotencyKey();
  const b = generateIdempotencyKey();

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  assert.match(a, uuidPattern);
  assert.match(b, uuidPattern);
  assert.notEqual(a, b);
});

test("canonicalizePayload: key order does not change the result", () => {
  const p1 = canonicalizePayload({ treatmentId: "t1", startAt: "2026-08-06T10:00:00Z" });
  const p2 = canonicalizePayload({ startAt: "2026-08-06T10:00:00Z", treatmentId: "t1" });

  assert.equal(p1, p2);
});

test("canonicalizePayload: different values produce different results", () => {
  const p1 = canonicalizePayload({ treatmentId: "t1" });
  const p2 = canonicalizePayload({ treatmentId: "t2" });

  assert.notEqual(p1, p2);
});

test("computePayloadHash: same logical payload (different key order) hashes identically", async () => {
  const h1 = await computePayloadHash({ a: 1, b: 2 });
  const h2 = await computePayloadHash({ b: 2, a: 1 });

  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("computePayloadHash: different payloads hash differently", async () => {
  const h1 = await computePayloadHash({ a: 1 });
  const h2 = await computePayloadHash({ a: 2 });

  assert.notEqual(h1, h2);
});

test("checkIdempotency: no existing record -> new", () => {
  const outcome = checkIdempotency(null, "hash-a");
  assert.equal(outcome.kind, "new");
});

test("checkIdempotency: same payloadHash -> duplicate, returns existing record", () => {
  const record: IdempotencyRecord = {
    key: "11111111-1111-4111-8111-111111111111",
    payloadHash: "hash-a",
    status: "completed",
    resultRef: "meeting-1",
    createdAt: "2026-08-05T10:00:00Z",
    expiresAt: "2026-08-05T15:00:00Z",
  };

  const outcome = checkIdempotency(record, "hash-a");

  assert.equal(outcome.kind, "duplicate");
  assert.equal(outcome.kind === "duplicate" && outcome.record.resultRef, "meeting-1");
});

test("checkIdempotency: different payloadHash for the same key -> conflict", () => {
  const record: IdempotencyRecord = {
    key: "11111111-1111-4111-8111-111111111111",
    payloadHash: "hash-a",
    status: "completed",
    resultRef: "meeting-1",
    createdAt: "2026-08-05T10:00:00Z",
    expiresAt: "2026-08-05T15:00:00Z",
  };

  const outcome = checkIdempotency(record, "hash-b");

  assert.equal(outcome.kind, "conflict");
});
