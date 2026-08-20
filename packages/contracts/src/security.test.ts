import { test } from "node:test";
import assert from "node:assert/strict";

import { hmacSubjectId } from "./security.ts";

const SECRET_A = "a-server-secret-that-is-long-enough-1234";
const SECRET_B = "a-different-server-secret-1234567890abcd";

test("hmacSubjectId: deterministic for the same domain/value/secret", async () => {
  const a = await hmacSubjectId("login-subject", "cliente@example.test", SECRET_A);
  const b = await hmacSubjectId("login-subject", "cliente@example.test", SECRET_A);
  assert.equal(a, b);
});

test("hmacSubjectId: never contains the raw value", async () => {
  const id = await hmacSubjectId("login-subject", "cliente@example.test", SECRET_A);
  assert.equal(id.includes("cliente"), false);
  assert.equal(id.includes("example.test"), false);
});

test("hmacSubjectId: looks like hex-encoded SHA-256 output (64 lowercase hex chars)", async () => {
  const id = await hmacSubjectId("login-subject", "cliente@example.test", SECRET_A);
  assert.match(id, /^[0-9a-f]{64}$/);
});

test("hmacSubjectId: different domains produce different ids for the same value/secret", async () => {
  const a = await hmacSubjectId("login-subject", "cliente@example.test", SECRET_A);
  const b = await hmacSubjectId("other-domain", "cliente@example.test", SECRET_A);
  assert.notEqual(a, b);
});

test("hmacSubjectId: different secrets produce different ids (rotation changes the identifier)", async () => {
  const a = await hmacSubjectId("login-subject", "cliente@example.test", SECRET_A);
  const b = await hmacSubjectId("login-subject", "cliente@example.test", SECRET_B);
  assert.notEqual(a, b);
});

test("hmacSubjectId: not a plain unsalted SHA-256 dictionary target — same value under two secrets does not collide with a well-known sha256(value)", async () => {
  const { createHash } = await import("node:crypto");
  const plainSha256 = createHash("sha256").update("cliente@example.test").digest("hex");
  const id = await hmacSubjectId("login-subject", "cliente@example.test", SECRET_A);
  assert.notEqual(id, plainSha256);
});
