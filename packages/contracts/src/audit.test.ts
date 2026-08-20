import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AuditPolicyError,
  createEventAuditEntry,
  createRawAuditEntry,
  createRedactedAuditEntry,
  validateAuditEntry,
  isRawValueAuditable,
  isValidRawValue,
  type RedactedValue,
} from "./audit.ts";

const actor = { type: "system" as const, name: "bff" as const };
const baseFields = {
  entity: "Meeting",
  entityId: "meeting-1",
  actor,
  channel: "web" as const,
  occurredAt: "2026-08-05T10:00:00Z",
};

const validDigest = "a".repeat(64);
const validRedactedValue: RedactedValue = {
  algorithm: "sha256",
  digest: validDigest,
  changeKind: "signature_replaced",
};

test("isRawValueAuditable: true for allowlisted field, false otherwise", () => {
  assert.equal(isRawValueAuditable("Meeting", "cEstadoReserva"), true);
  assert.equal(isRawValueAuditable("Meeting", "description"), false);
});

test("isValidRawValue: accepts a real enum member of Meeting.cEstadoReserva", () => {
  assert.equal(isValidRawValue("Meeting", "cEstadoReserva", "Confirmed"), true);
});

test("isRawValueAuditable/isValidRawValue: BookingReviewRecord.status is allowlisted against BOOKING_REVIEW_STATUSES (nullable: a new review's previousValue is null)", () => {
  assert.equal(isRawValueAuditable("BookingReviewRecord", "status"), true);
  assert.equal(isValidRawValue("BookingReviewRecord", "status", null), true);
  assert.equal(isValidRawValue("BookingReviewRecord", "status", "pending"), true);
  assert.equal(isValidRawValue("BookingReviewRecord", "status", "resolved"), true);
  assert.equal(isValidRawValue("BookingReviewRecord", "status", "not-a-status"), false);
});

test("isValidRawValue: rejects a short-but-invalid value, even if plausible", () => {
  // "no" es corto, pero no pertenece a ESTADOS_RESERVA: debe rechazarse
  // igual que un secreto corto (contraseña, OTP, token) lo haría.
  assert.equal(isValidRawValue("Meeting", "cEstadoReserva", "no"), false);
});

test("createRawAuditEntry: succeeds for a real enum value on an allowlisted field", () => {
  const entry = createRawAuditEntry({
    ...baseFields,
    field: "cEstadoReserva",
    previousValue: "PendingCenterApproval",
    newValue: "Confirmed",
    reasonCode: "ApprovedByStaff",
  });

  assert.equal(entry.valueRepresentation, "raw");
  assert.equal(entry.newValue, "Confirmed");
});

test("createRawAuditEntry: rejects a field outside the allowlist", () => {
  assert.throws(
    () =>
      createRawAuditEntry({
        ...baseFields,
        field: "description",
        previousValue: "a",
        newValue: "b",
      }),
    AuditPolicyError,
  );
});

test("createRawAuditEntry: rejects a value that does not belong to the field's domain, however short", () => {
  assert.throws(
    () =>
      createRawAuditEntry({
        ...baseFields,
        field: "cEstadoReserva",
        previousValue: "Confirmed",
        newValue: "hunter2", // corto, no es un miembro de ESTADOS_RESERVA
      }),
    AuditPolicyError,
  );
});

test("createRawAuditEntry: rejects a value that looks like dumped content, on an allowlisted field", () => {
  assert.throws(
    () =>
      createRawAuditEntry({
        ...baseFields,
        field: "cEstadoReserva",
        previousValue: "Confirmed",
        newValue: "respuesta completa del cuestionario ".repeat(10),
      }),
    AuditPolicyError,
  );
});

test("createRedactedAuditEntry: succeeds with a well-formed structured value", () => {
  const entry = createRedactedAuditEntry({
    ...baseFields,
    field: "signatureFileRef",
    redactedValue: validRedactedValue,
  });

  assert.equal(entry.valueRepresentation, "redacted");
});

test("createRedactedAuditEntry: rejects a plain string instead of a structured RedactedValue", () => {
  assert.throws(
    () =>
      createRedactedAuditEntry({
        ...baseFields,
        // @ts-expect-error redactedValue ya no admite texto libre — se prueba en runtime a propósito
        redactedValue: "sha256:abcd1234",
      }),
    AuditPolicyError,
  );
});

test("createRedactedAuditEntry: rejects an arbitrary short string smuggled as a digest", () => {
  assert.throws(
    () =>
      createRedactedAuditEntry({
        ...baseFields,
        redactedValue: { algorithm: "sha256", digest: "not-a-real-digest", changeKind: "signature_replaced" },
      }),
    AuditPolicyError,
  );
});

test("createRedactedAuditEntry: rejects an unknown changeKind", () => {
  assert.throws(
    () =>
      createRedactedAuditEntry({
        ...baseFields,
        // @ts-expect-error changeKind ajeno al enum cerrado — se prueba en runtime a propósito
        redactedValue: { algorithm: "sha256", digest: validDigest, changeKind: "password_leaked" },
      }),
    AuditPolicyError,
  );
});

test("createRawAuditEntry: accepts a valid reasonCode", () => {
  const entry = createRawAuditEntry({
    ...baseFields,
    field: "cEstadoReserva",
    previousValue: "PendingCenterApproval",
    newValue: "Canceled",
    reasonCode: "RejectedByStaff",
  });

  assert.equal(entry.reasonCode, "RejectedByStaff");
});

test("createEventAuditEntry: succeeds with entity/actor/channel/occurredAt + a valid reasonCode, and carries no raw or redacted value", () => {
  const entry = createEventAuditEntry({
    entity: "ClientAccount",
    entityId: "account-1",
    actor: { type: "user", id: "account-1" },
    channel: "web",
    occurredAt: "2026-08-06T10:00:00Z",
    reasonCode: "LoginSucceeded",
  });

  assert.equal(entry.valueRepresentation, "event");
  assert.equal(entry.reasonCode, "LoginSucceeded");
  assert.equal("previousValue" in entry, false);
  assert.equal("redactedValue" in entry, false);
});

test("createEventAuditEntry: rejects an invalid reasonCode even though TypeScript would normally catch this at compile time", () => {
  assert.throws(
    () =>
      createEventAuditEntry({
        entity: "ClientAccount",
        entityId: "account-1",
        actor: { type: "system", name: "bff" },
        channel: "web",
        occurredAt: "2026-08-06T10:00:00Z",
        // @ts-expect-error reasonCode fuera del enum cerrado — se prueba en runtime a propósito
        reasonCode: "NotARealReasonCode",
      }),
    AuditPolicyError,
  );
});

test("createEventAuditEntry: rejects an invalid channel", () => {
  assert.throws(
    () =>
      createEventAuditEntry({
        entity: "ClientAccount",
        entityId: "account-1",
        actor: { type: "system", name: "bff" },
        // @ts-expect-error channel fuera del enum cerrado — se prueba en runtime a propósito
        channel: "carrier-pigeon",
        occurredAt: "2026-08-06T10:00:00Z",
        reasonCode: "LoginSucceeded",
      }),
    AuditPolicyError,
  );
});

test("validateAuditEntry: accepts a well-formed event entry", () => {
  const entry = validateAuditEntry({
    ...baseFields,
    entity: "ClientAccount",
    valueRepresentation: "event",
    reasonCode: "LogoutRequested",
  });

  assert.equal(entry.valueRepresentation, "event");
});

test("validateAuditEntry: rejects an event entry missing reasonCode", () => {
  assert.throws(
    () =>
      validateAuditEntry({
        ...baseFields,
        entity: "ClientAccount",
        valueRepresentation: "event",
      }),
    AuditPolicyError,
  );
});

test("validateAuditEntry: accepts a well-formed raw entry", () => {
  const entry = validateAuditEntry({
    ...baseFields,
    valueRepresentation: "raw",
    field: "status",
    previousValue: "Planned",
    newValue: "Not Held",
  });

  assert.equal(entry.valueRepresentation, "raw");
});

test("validateAuditEntry: rejects a raw entry hand-built for a disallowed field", () => {
  assert.throws(
    () =>
      validateAuditEntry({
        ...baseFields,
        valueRepresentation: "raw",
        field: "description",
        previousValue: "a",
        newValue: "b",
      }),
    AuditPolicyError,
  );
});

test("validateAuditEntry: rejects a redacted entry with a free-text redactedValue", () => {
  assert.throws(
    () =>
      validateAuditEntry({
        ...baseFields,
        valueRepresentation: "redacted",
        redactedValue: "just a string",
      }),
    AuditPolicyError,
  );
});

test("validateAuditEntry: rejects an invalid reasonCode", () => {
  assert.throws(
    () =>
      validateAuditEntry({
        ...baseFields,
        valueRepresentation: "redacted",
        redactedValue: validRedactedValue,
        reasonCode: "because I said so",
      }),
    AuditPolicyError,
  );
});

test("validateAuditEntry: rejects an actor with an unknown shape", () => {
  assert.throws(
    () =>
      validateAuditEntry({
        ...baseFields,
        actor: { type: "guest", email: "someone@example.com" },
        valueRepresentation: "redacted",
        redactedValue: validRedactedValue,
      }),
    AuditPolicyError,
  );
});
