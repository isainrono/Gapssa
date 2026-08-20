import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
  constantTimeEqual,
  OTP_CODE_LENGTH,
  type OtpHashContext,
} from "./otp.ts";

const secret = "server-secret-for-tests";

const contextA: OtpHashContext = {
  challengeId: "challenge-a",
  purpose: "guest_email_verification",
  subjectRef: "booking-request-1",
};

const contextB: OtpHashContext = {
  challengeId: "challenge-b",
  purpose: "guest_email_verification",
  subjectRef: "booking-request-1",
};

test("generateOtpCode: produces a numeric string of the configured length", () => {
  const code = generateOtpCode();

  assert.equal(code.length, OTP_CODE_LENGTH);
  assert.match(code, /^[0-9]+$/);
});

test("generateOtpCode: consecutive codes are not trivially identical", () => {
  const samples = new Set(Array.from({ length: 20 }, () => generateOtpCode()));
  assert.ok(samples.size > 1, "20 codes generated, expected more than one distinct value");
});

test("generateOtpCode: respects a custom length", () => {
  assert.equal(generateOtpCode(4).length, 4);
  assert.equal(generateOtpCode(10).length, 10);
});

test("hashOtpCode + verifyOtpCode: the correct code verifies successfully with the same context", async () => {
  const code = "482913";
  const hash = await hashOtpCode(contextA, code, secret);

  assert.equal(await verifyOtpCode(contextA, code, secret, hash), true);
});

test("verifyOtpCode: an incorrect code fails verification", async () => {
  const hash = await hashOtpCode(contextA, "482913", secret);

  assert.equal(await verifyOtpCode(contextA, "000000", secret, hash), false);
});

test("hashOtpCode: the same code hashes differently under a different server secret", async () => {
  const code = "482913";
  const hashUnderSecretA = await hashOtpCode(contextA, code, "secret-a");
  const hashUnderSecretB = await hashOtpCode(contextA, code, "secret-b");

  assert.notEqual(hashUnderSecretA, hashUnderSecretB);
});

test("hashOtpCode: the same code hashes differently for a different challengeId", async () => {
  const code = "482913";
  const hashForChallengeA = await hashOtpCode(contextA, code, secret);
  const hashForChallengeB = await hashOtpCode(contextB, code, secret);

  assert.notEqual(hashForChallengeA, hashForChallengeB);
});

test("hashOtpCode: the same code hashes differently for a different purpose", async () => {
  const code = "482913";
  const verificationContext: OtpHashContext = { ...contextA, purpose: "guest_email_verification" };
  const consentContext: OtpHashContext = { ...contextA, purpose: "consent_signature" };

  const hashForVerification = await hashOtpCode(verificationContext, code, secret);
  const hashForConsent = await hashOtpCode(consentContext, code, secret);

  assert.notEqual(hashForVerification, hashForConsent);
});

test("hashOtpCode: the same code hashes differently for a different subjectRef", async () => {
  const code = "482913";
  const contextForSubjectA: OtpHashContext = { ...contextA, subjectRef: "booking-request-1" };
  const contextForSubjectB: OtpHashContext = { ...contextA, subjectRef: "booking-request-2" };

  const hashForSubjectA = await hashOtpCode(contextForSubjectA, code, secret);
  const hashForSubjectB = await hashOtpCode(contextForSubjectB, code, secret);

  assert.notEqual(hashForSubjectA, hashForSubjectB);
});

test("verifyOtpCode: a correct code with the wrong context does not verify (hash from another challenge cannot be replayed)", async () => {
  const code = "482913";
  const hashFromChallengeA = await hashOtpCode(contextA, code, secret);

  assert.equal(await verifyOtpCode(contextB, code, secret, hashFromChallengeA), false);
});

test("constantTimeEqual: equal strings compare true", () => {
  assert.equal(constantTimeEqual("abcd1234", "abcd1234"), true);
});

test("constantTimeEqual: different strings of equal length compare false", () => {
  assert.equal(constantTimeEqual("abcd1234", "abcd9999"), false);
});

test("constantTimeEqual: different lengths compare false", () => {
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});
