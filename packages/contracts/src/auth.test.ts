import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideAccountAgeCategory,
  normalizeEmail,
  isSessionIdleExpired,
  isSessionAbsoluteExpired,
  isSessionUsable,
  canAddGuardianLink,
  isEligibleForIndependenceRequest,
  isValidDateOfBirth,
  parseStrictIsoDate,
  SESSION_IDLE_TIMEOUT_MINUTES,
  MAX_GUARDIANS_PER_MINOR,
} from "./auth.ts";
import { isRawValueAuditable, isValidRawValue, AUDIT_REASON_CODES } from "./audit.ts";

// ---------------------------------------------------------------------------
// parseStrictIsoDate / isValidDateOfBirth — revisión 2 de Fase 3: la
// combinación anterior (regex "YYYY-MM-DD" + new Date()) aceptaba fechas
// normalizadas como "2026-02-31" porque new Date() reajusta el día en vez
// de rechazarlo.
// ---------------------------------------------------------------------------

test("parseStrictIsoDate: Feb 29 on a leap year is valid", () => {
  assert.deepEqual(parseStrictIsoDate("2008-02-29"), { year: 2008, month: 2, day: 29 });
});

test("parseStrictIsoDate: Feb 29 on a non-leap year is rejected", () => {
  assert.equal(parseStrictIsoDate("2007-02-29"), null);
  assert.equal(parseStrictIsoDate("1900-02-29"), null); // divisible by 100 but not 400
});

test("parseStrictIsoDate: Feb 29 on a century leap year (divisible by 400) is valid", () => {
  assert.deepEqual(parseStrictIsoDate("2000-02-29"), { year: 2000, month: 2, day: 29 });
});

test("parseStrictIsoDate: Apr 31 does not exist", () => {
  assert.equal(parseStrictIsoDate("2026-04-31"), null);
});

test("parseStrictIsoDate: month 13 is rejected", () => {
  assert.equal(parseStrictIsoDate("2026-13-01"), null);
});

test("parseStrictIsoDate: day 00 is rejected", () => {
  assert.equal(parseStrictIsoDate("2026-01-00"), null);
});

test("parseStrictIsoDate: month 00 is rejected", () => {
  assert.equal(parseStrictIsoDate("2026-00-15"), null);
});

test("parseStrictIsoDate: malformed strings are rejected, never thrown", () => {
  for (const value of ["2026-2-31", "26-02-31", "2026/02/31", "not-a-date", ""]) {
    assert.equal(parseStrictIsoDate(value), null);
  }
});

test("isValidDateOfBirth: rejects a future date", () => {
  assert.equal(isValidDateOfBirth("2026-08-07", new Date("2026-08-06T00:00:00Z")), false);
});

test("isValidDateOfBirth: accepts today", () => {
  assert.equal(isValidDateOfBirth("2026-08-06", new Date("2026-08-06T00:00:00Z")), true);
});

test("isValidDateOfBirth: accepts a real past date", () => {
  assert.equal(isValidDateOfBirth("1990-01-01", new Date("2026-08-06T00:00:00Z")), true);
});

test("isValidDateOfBirth: rejects an impossible calendar date even if it is 'in the past' after normalization", () => {
  // new Date("2026-02-31") silently becomes 2026-03-03, which IS in the
  // past relative to "now" below — the old (regex + new Date) validation
  // would have accepted it. The point of this test is that it must not.
  assert.equal(isValidDateOfBirth("2026-02-31", new Date("2026-08-06T00:00:00Z")), false);
});

test("isValidDateOfBirth: timezone-safe — a UTC 'now' just after local midnight does not reject a same-day birth date", () => {
  const now = new Date("2026-08-06T00:05:00Z");
  assert.equal(isValidDateOfBirth("2026-08-06", now), true);
});

// ---------------------------------------------------------------------------
// decideAccountAgeCategory
// ---------------------------------------------------------------------------

test("decideAccountAgeCategory: exactly 18 today -> adult", () => {
  const category = decideAccountAgeCategory("2008-08-06", new Date("2026-08-06T00:00:00Z"));
  assert.equal(category, "adult");
});

test("decideAccountAgeCategory: turns 18 tomorrow -> still minor", () => {
  const category = decideAccountAgeCategory("2008-08-07", new Date("2026-08-06T00:00:00Z"));
  assert.equal(category, "minor");
});

test("decideAccountAgeCategory: turned 18 yesterday -> adult", () => {
  const category = decideAccountAgeCategory("2008-08-05", new Date("2026-08-06T00:00:00Z"));
  assert.equal(category, "adult");
});

test("decideAccountAgeCategory: well under 18 -> minor", () => {
  const category = decideAccountAgeCategory("2015-01-01", new Date("2026-08-06T00:00:00Z"));
  assert.equal(category, "minor");
});

test("decideAccountAgeCategory: throws on an invalid dateOfBirth instead of silently normalizing it", () => {
  assert.throws(() => decideAccountAgeCategory("2026-02-31", new Date("2026-08-06T00:00:00Z")));
});

test("decideAccountAgeCategory: leap-day birthday, non-leap current year, before Mar 1 -> still the earlier age", () => {
  // Nacido el 29 feb 2008 (año bisiesto); en un año no bisiesto,
  // getUTCDate()/getUTCMonth() de "now" antes del 1 de marzo debe seguir
  // contando como que el cumpleaños de ese año aún no llegó.
  const category = decideAccountAgeCategory("2008-02-29", new Date("2026-02-28T00:00:00Z"));
  assert.equal(category, "minor");
});

// ---------------------------------------------------------------------------
// normalizeEmail
// ---------------------------------------------------------------------------

test("normalizeEmail: trims and lowercases", () => {
  assert.equal(normalizeEmail("  Cliente@Example.COM  "), "cliente@example.com");
});

// ---------------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------------

test("isSessionIdleExpired: false right at creation", () => {
  const now = new Date("2026-08-06T10:00:00Z");
  assert.equal(isSessionIdleExpired(now.toISOString(), now), false);
});

test(`isSessionIdleExpired: true after ${SESSION_IDLE_TIMEOUT_MINUTES} minutes of inactivity`, () => {
  const lastSeen = new Date("2026-08-06T10:00:00Z");
  const now = new Date(lastSeen.getTime() + SESSION_IDLE_TIMEOUT_MINUTES * 60_000);
  assert.equal(isSessionIdleExpired(lastSeen.toISOString(), now), true);
});

test("isSessionIdleExpired: false one minute before the idle timeout", () => {
  const lastSeen = new Date("2026-08-06T10:00:00Z");
  const now = new Date(lastSeen.getTime() + (SESSION_IDLE_TIMEOUT_MINUTES - 1) * 60_000);
  assert.equal(isSessionIdleExpired(lastSeen.toISOString(), now), false);
});

test("isSessionAbsoluteExpired: true once now >= expiresAt", () => {
  const expiresAt = new Date("2026-08-06T10:00:00Z");
  assert.equal(isSessionAbsoluteExpired(expiresAt.toISOString(), expiresAt), true);
});

test("isSessionUsable: false if revoked, even when otherwise fresh", () => {
  const now = new Date("2026-08-06T10:00:00Z");
  const usable = isSessionUsable(
    {
      revokedAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    },
    now,
  );
  assert.equal(usable, false);
});

test("isSessionUsable: false once absolute TTL is reached", () => {
  const expiresAt = new Date("2026-08-06T10:00:00Z");
  const usable = isSessionUsable(
    { revokedAt: null, lastSeenAt: expiresAt.toISOString(), expiresAt: expiresAt.toISOString() },
    expiresAt,
  );
  assert.equal(usable, false);
});

test("isSessionUsable: false once idle timeout is reached, even before absolute TTL", () => {
  const lastSeen = new Date("2026-08-06T10:00:00Z");
  const now = new Date(lastSeen.getTime() + SESSION_IDLE_TIMEOUT_MINUTES * 60_000);
  const usable = isSessionUsable(
    { revokedAt: null, lastSeenAt: lastSeen.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString() },
    now,
  );
  assert.equal(usable, false);
});

test("isSessionUsable: true when not revoked and within both windows", () => {
  const now = new Date("2026-08-06T10:00:00Z");
  const usable = isSessionUsable(
    {
      revokedAt: null,
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    },
    now,
  );
  assert.equal(usable, true);
});

// ---------------------------------------------------------------------------
// Tutores — máximo dos por menor
// ---------------------------------------------------------------------------

test(`canAddGuardianLink: allows up to ${MAX_GUARDIANS_PER_MINOR} links`, () => {
  assert.equal(canAddGuardianLink(0), true);
  assert.equal(canAddGuardianLink(MAX_GUARDIANS_PER_MINOR - 1), true);
});

test(`canAddGuardianLink: rejects at and beyond ${MAX_GUARDIANS_PER_MINOR} links`, () => {
  assert.equal(canAddGuardianLink(MAX_GUARDIANS_PER_MINOR), false);
  assert.equal(canAddGuardianLink(MAX_GUARDIANS_PER_MINOR + 1), false);
});

// ---------------------------------------------------------------------------
// Independencia al alcanzar la mayoría de edad
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-06T00:00:00Z");

test("isEligibleForIndependenceRequest: false while still a minor", () => {
  const eligible = isEligibleForIndependenceRequest(
    { dateOfBirth: "2015-01-01", hasAnyGuardianLink: true, independenceStatus: "not_applicable" },
    NOW,
  );
  assert.equal(eligible, false);
});

test("isEligibleForIndependenceRequest: false without any guardian link at all", () => {
  const eligible = isEligibleForIndependenceRequest(
    { dateOfBirth: "2000-01-01", hasAnyGuardianLink: false, independenceStatus: "not_applicable" },
    NOW,
  );
  assert.equal(eligible, false);
});

test("isEligibleForIndependenceRequest: false if independence was already granted", () => {
  const eligible = isEligibleForIndependenceRequest(
    { dateOfBirth: "2000-01-01", hasAnyGuardianLink: true, independenceStatus: "granted" },
    NOW,
  );
  assert.equal(eligible, false);
});

test("isEligibleForIndependenceRequest: true for an adult with a guardian link and independence still pending/not_applicable", () => {
  const eligiblePending = isEligibleForIndependenceRequest(
    { dateOfBirth: "2000-01-01", hasAnyGuardianLink: true, independenceStatus: "pending" },
    NOW,
  );
  const eligibleNotApplicable = isEligibleForIndependenceRequest(
    { dateOfBirth: "2000-01-01", hasAnyGuardianLink: true, independenceStatus: "not_applicable" },
    NOW,
  );
  assert.equal(eligiblePending, true);
  assert.equal(eligibleNotApplicable, true);
});

test("isEligibleForIndependenceRequest: true even after a previously rejected request (does not permanently close the door)", () => {
  const eligible = isEligibleForIndependenceRequest(
    { dateOfBirth: "2000-01-01", hasAnyGuardianLink: true, independenceStatus: "not_applicable" },
    NOW,
  );
  assert.equal(eligible, true);
});

// ---------------------------------------------------------------------------
// Integración con la política de auditoría (audit.ts) — los enums de
// auth.ts deben quedar registrados como auditables en crudo, con el mismo
// mecanismo que Meeting/BookingRequestRecord.
// ---------------------------------------------------------------------------

test("audit.ts: ClientAccount.status is raw-auditable and validates its domain", () => {
  assert.equal(isRawValueAuditable("ClientAccount", "status"), true);
  assert.equal(isValidRawValue("ClientAccount", "status", "active"), true);
  assert.equal(isValidRawValue("ClientAccount", "status", "not_a_real_status"), false);
});

test("audit.ts: Session.revokedReason accepts null and known reasons, rejects free text", () => {
  assert.equal(isValidRawValue("Session", "revokedReason", null), true);
  assert.equal(isValidRawValue("Session", "revokedReason", "user_logout"), true);
  assert.equal(isValidRawValue("Session", "revokedReason", "because I said so"), false);
});

test("audit.ts: GuardianLink.status and IndependenceRequest.status are raw-auditable", () => {
  assert.equal(isValidRawValue("GuardianLink", "status", "active"), true);
  assert.equal(isValidRawValue("IndependenceRequest", "status", "confirmed"), true);
  assert.equal(isValidRawValue("IndependenceRequest", "status", "granted"), false); // that's ClientAccount.independenceStatus, not this enum
});

test("audit.ts: new Fase 3 reason codes are present in the closed enum", () => {
  for (const code of [
    "AccountRegistered",
    "LoginFailedInvalidCredentials",
    "SessionRevokedByPasswordChange",
    "GuardianLinkConfirmed",
    "IndependenceGranted",
    "EspoLinkProposed",
  ]) {
    assert.ok((AUDIT_REASON_CODES as readonly string[]).includes(code), `missing reason code: ${code}`);
  }
});
