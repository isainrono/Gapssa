import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePendingGuestIdentityPurgeTrigger, type BookingLock } from "./booking.ts";

const NOW = new Date("2026-08-05T12:00:00Z");
const RECOVERY_DEADLINE = new Date("2026-08-05T12:30:00Z");

test("decidePendingGuestIdentityPurgeTrigger: still verifying, no Meeting yet, within the recovery window -> keep the identity (null)", () => {
  const trigger = decidePendingGuestIdentityPurgeTrigger(
    { status: "verification_processing", resolution: null, meetingId: null },
    NOW,
    RECOVERY_DEADLINE,
  );

  assert.equal(trigger, null);
});

test("decidePendingGuestIdentityPurgeTrigger: pending_verification with no Meeting -> keep the identity (null)", () => {
  const trigger = decidePendingGuestIdentityPurgeTrigger(
    { status: "pending_verification", resolution: null, meetingId: null },
    NOW,
    RECOVERY_DEADLINE,
  );

  assert.equal(trigger, null);
});

test("decidePendingGuestIdentityPurgeTrigger: meetingId already written -> meeting_linked, regardless of overall status", () => {
  const trigger = decidePendingGuestIdentityPurgeTrigger(
    { status: "pending_approval", resolution: null, meetingId: "meeting-123" },
    NOW,
    RECOVERY_DEADLINE,
  );

  assert.equal(trigger, "meeting_linked");
});

test("decidePendingGuestIdentityPurgeTrigger: resolved as verification_expired -> verification_expired", () => {
  const trigger = decidePendingGuestIdentityPurgeTrigger(
    { status: "resolved", resolution: "verification_expired", meetingId: null },
    NOW,
    RECOVERY_DEADLINE,
  );

  assert.equal(trigger, "verification_expired");
});

test("decidePendingGuestIdentityPurgeTrigger: verification_processing past the recovery deadline -> recovery_window_exceeded", () => {
  const trigger = decidePendingGuestIdentityPurgeTrigger(
    { status: "verification_processing", resolution: null, meetingId: null },
    new Date("2026-08-05T13:00:00Z"), // después de RECOVERY_DEADLINE
    RECOVERY_DEADLINE,
  );

  assert.equal(trigger, "recovery_window_exceeded");
});

test("decidePendingGuestIdentityPurgeTrigger: meetingId takes precedence even past the recovery deadline", () => {
  // Si el Meeting ya se vinculó, da igual que el reloj haya superado la
  // ventana de recuperación: la identidad ya cumplió su propósito.
  const trigger = decidePendingGuestIdentityPurgeTrigger(
    { status: "pending_approval", resolution: null, meetingId: "meeting-123" },
    new Date("2026-08-05T13:00:00Z"),
    RECOVERY_DEADLINE,
  );

  assert.equal(trigger, "meeting_linked");
});

test("decidePendingGuestIdentityPurgeTrigger: resolved as contact_review_rejected -> review_rejected", () => {
  const trigger = decidePendingGuestIdentityPurgeTrigger(
    { status: "resolved", resolution: "contact_review_rejected", meetingId: null },
    NOW,
    RECOVERY_DEADLINE,
  );

  assert.equal(trigger, "review_rejected");
});

test("decidePendingGuestIdentityPurgeTrigger: resolved as contact_review_expired -> review_expired", () => {
  const trigger = decidePendingGuestIdentityPurgeTrigger(
    { status: "resolved", resolution: "contact_review_expired", meetingId: null },
    NOW,
    RECOVERY_DEADLINE,
  );

  assert.equal(trigger, "review_expired");
});

test("BookingLock: no longer carries GuestContactInfo (compile-time check)", () => {
  const lock: BookingLock = {
    requestId: "request-1",
    phase: "verification",
    treatmentId: "treatment-1",
    professionalId: "professional-1",
    zoneId: "zone-1",
    startAt: "2026-08-06T10:00:00Z",
    endAt: "2026-08-06T10:30:00Z",
    expiresAt: "2026-08-06T10:10:00Z",
    // @ts-expect-error BookingLock ya no admite `guest` (revisión 4): los datos del invitado viven en PendingGuestIdentity.
    guest: null,
  };

  assert.equal(lock.requestId, "request-1");
});
