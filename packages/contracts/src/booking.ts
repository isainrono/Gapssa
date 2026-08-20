import type { IdempotencyKey } from "./idempotency.ts";

/**
 * Tiempos exactos fijados en PLAN_DESARROLLO_WEB_PORTAL.md §7. No
 * redefinir estos valores en otro sitio del código: importar de aquí.
 */
export const GUEST_VERIFICATION_HOLD_MINUTES = 10;
export const APPROVAL_HOLD_HOURS = 5;
export const MAX_PENDING_REQUESTS_PER_CLIENT = 2;
export const MIN_LEAD_TIME_HOURS = 2;
export const MAX_LEAD_TIME_DAYS = 60;
export const FREE_CANCELLATION_WINDOW_HOURS = 24;
export const WAITLIST_OFFER_MINUTES = 30;

/**
 * Ventana máxima, tras entrar en "verification_processing", para terminar
 * de crear/vincular el Meeting en EspoCRM mediante reintentos (revisión
 * 4). Superada sin éxito: se resuelve "verification_expired" con
 * `reasonCode = "RecoveryWindowExceeded"` y se purga `PendingGuestIdentity`.
 * Valor técnico sugerido, a confirmar en Fase 1 — no es una regla de
 * negocio de PROJECT_CONTEXT.md/PLAN_DESARROLLO_WEB_PORTAL.md.
 */
export const VERIFICATION_RECOVERY_WINDOW_MINUTES = 30;

/**
 * Revisión 2 de Fase 4B, punto 3/6: plazo máximo que un `BookingReviewRecord`
 * puede permanecer `pending` antes de que el barrido de conciliación lo
 * caduque (`resolution = "contact_review_expired"`) — sin esto,
 * `contact_review_pending` sería, de nuevo, un estado sin caducidad propia
 * si ningún operador actúa nunca.
 *
 * Revisión 3 de Fase 4B, punto 7: las 72h originales NO estaban aprobadas
 * como decisión de negocio — bloqueaban el horario del profesional/zona
 * (`listUnresolvedOverlapping`, apps/web/src/server/booking/repository.ts)
 * tres días completos por una sola solicitud en revisión manual. Alineado
 * provisionalmente con `APPROVAL_HOLD_HOURS` (misma naturaleza de espera
 * "post-verificación, pre-decisión-final"): 5h, no 72h. Configurable sin
 * desplegar código nuevo (`BOOKING_CONTACT_REVIEW_HOLD_HOURS`,
 * apps/web/src/server/env.ts), con un tope explícito en ese mismo esquema
 * que impide superar `APPROVAL_HOLD_HOURS` por accidente. Si existe un
 * motivo técnico real para una ventana más larga, es una decisión de
 * negocio TODAVÍA pendiente de confirmar — no se ha impuesto por cuenta
 * propia; V1 usa 5h.
 */
export const CONTACT_REVIEW_HOLD_HOURS = APPROVAL_HOLD_HOURS;

/**
 * Cierre del hueco 3 de "Fase 4B — flujo de decisión final": ni
 * `HttpEspoBookingAdapter` ni `deriveResolutionFromDecidedMeeting` pueden
 * distinguir de forma durable un rechazo manual de una caducidad de sistema
 * mirando `decidedBy`/`modifiedById` — en EspoCRM real ese campo identifica
 * al usuario/proceso TÉCNICO que ejecutó la escritura (el API User
 * `portal-gapssa-api` en ambos casos), no el motivo de negocio, y puede
 * cambiar por cualquier edición posterior ajena a la decisión. Este campo
 * NUEVO en `Meeting` (custom, prefijo `c` por la misma convención ya
 * establecida que `CONTACT_GAPSSA_ACCOUNT_ID_FIELD`/
 * `MEETING_BOOKING_REQUEST_FIELD`) es la representación durable y cerrada
 * del motivo — sobrevive a reinicios, se lee directamente del propio
 * Meeting, nunca se infiere.
 *
 * **No creado en la instancia real de EspoCRM** — vive únicamente en
 * `extensions/espocrm/custom/.../entityDefs/Meeting.json` (export local,
 * sin conexión con el contenedor real, mismo estado que
 * `cBookingRequestId` hoy). Requiere una autorización de escritura de
 * esquema aparte, anterior a la puerta 4 — ver
 * `docs/fase4b-decision-flow-final.md` §6.
 */
export const MEETING_RESOLUTION_REASON_FIELD = "cMotivoResolucionReserva" as const;

/**
 * Mismo concepto de dominio visto desde dos lados: el campo real de
 * EspoCRM (arriba) y el `reasonCode` que `BookingRequestRecord` termina
 * guardando en Postgres cuando adopta esa misma decisión
 * (`applyOrAdoptBookingDecision`). `BOOKING_REASON_CODES`, más abajo,
 * reutiliza este array (spread) en vez de repetir los tres literales — no
 * añadir un valor aquí sin comprobar que sigue siendo válido también como
 * `BookingReasonCode`.
 */
export const MEETING_RESOLUTION_REASONS = ["Approved", "RejectedByStaff", "ApprovalExpired"] as const;
export type MeetingResolutionReason = (typeof MEETING_RESOLUTION_REASONS)[number];

/**
 * Mapeo obligatorio `cEstadoReserva` (destino) -> motivos compatibles.
 * "Confirmed" solo admite "Approved"; "Canceled" admite "RejectedByStaff"
 * (rechazo humano) o "ApprovalExpired" (caducidad de sistema) — nunca
 * ambos a la vez, nunca uno inventado. Cualquier otro `cEstadoReserva` no
 * admite ningún motivo de esta lista (el campo debe quedar `null`) — copia
 * exacta de la que implementa `MeetingResolutionPolicy.php` en EspoCRM; no
 * cambiar un lado sin el otro.
 */
export const MEETING_RESOLUTION_COMPATIBLE_REASONS: Readonly<
  Record<"Confirmed" | "Canceled", readonly MeetingResolutionReason[]>
> = {
  Confirmed: ["Approved"],
  Canceled: ["RejectedByStaff", "ApprovalExpired"],
};

export function isMeetingResolutionReasonCompatible(
  cEstadoReserva: string,
  reason: MeetingResolutionReason,
): boolean {
  const allowed = MEETING_RESOLUTION_COMPATIBLE_REASONS[cEstadoReserva as "Confirmed" | "Canceled"];
  return allowed !== undefined && allowed.includes(reason);
}

/**
 * Copia exacta de `MeetingResolutionPolicy::isNoteAcceptable()` (PHP) — no
 * cambiar un lado sin el otro. `RejectedByStaff` exige una nota humana no
 * vacía y no compuesta únicamente por espacios; `ApprovalExpired` admite
 * únicamente ausencia de nota o la nota técnica fija
 * (`APPROVAL_EXPIRED_TECHNICAL_NOTE`, definida más abajo en este archivo);
 * `Approved` no impone ninguna restricción propia.
 */
export function isMeetingResolutionNoteAcceptable(
  reason: MeetingResolutionReason,
  note: string | null | undefined,
): boolean {
  const normalizedNote = note ?? null;
  if (reason === "RejectedByStaff") {
    return typeof normalizedNote === "string" && normalizedNote.trim() !== "";
  }
  if (reason === "ApprovalExpired") {
    return normalizedNote === null || normalizedNote === APPROVAL_EXPIRED_TECHNICAL_NOTE;
  }
  return true;
}

/**
 * Nota técnica fija y única que puede acompañar una caducidad de sistema
 * (`ApprovalExpired`) — nunca texto libre. Requisito del encargo: "aceptar
 * únicamente la nota técnica prevista o ninguna". Justificación: si se
 * permitiera texto libre en una caducidad, el barrido automático podría
 * "inventar" un motivo operativo que nadie escribió — mantiene la
 * distinción de que solo un rechazo MANUAL lleva una nota humana real.
 * Copia exacta en `MeetingResolutionReason::EXPIRY_TECHNICAL_NOTE` (PHP) —
 * no cambiar un lado sin el otro.
 */
export const APPROVAL_EXPIRED_TECHNICAL_NOTE =
  "Caducado automáticamente: el plazo de aprobación del centro venció sin respuesta." as const;

/**
 * Clave de idempotencia DETERMINISTA para la caducidad automática de un
 * Meeting concreto — "Fase 4B — flujo de decisión final", punto 3 del
 * encargo: "caducidad: clave determinista y versionada derivada del
 * bookingRequestId". El barrido de conciliación (`sweepExpiredApprovals`)
 * puede reintentar la MISMA solicitud en varias pasadas sin generar una
 * UUID nueva cada vez — dos pasadas para el mismo `bookingRequestId`
 * producen SIEMPRE la misma clave, así que un reintento tras un timeout se
 * repite (`PutDecide` responde con el mismo resultado ya confirmado) en vez
 * de arriesgar dos escrituras. Prefijo `expiry-v1-` (versionado): si el
 * criterio de expiración cambiara de forma incompatible en el futuro, una
 * nueva versión (`expiry-v2-...`) no colisiona con operaciones antiguas ya
 * registradas bajo `expiry-v1-...`. `bookingRequestId` es un UUID opaco,
 * nunca PII. Solo caracteres `[A-Za-z0-9_-]` (mismo patrón que valida
 * `PutDecide.php::parseAndValidateBody` para `operationKey`).
 */
export function buildApprovalExpiryOperationKey(bookingRequestId: string): string {
  return `expiry-v1-${bookingRequestId}`;
}

/**
 * Motivos técnicos (no decisiones humanas) por los que un
 * BookingRequestRecord termina su ciclo. Revisión 4: sustituye el antiguo
 * campo `reason: string` libre — ver el razonamiento en audit.ts (§reason
 * vs. reasonCode) aplicado también aquí. Un rechazo humano de Gapssa no
 * añade texto libre en este registro: la nota, si existe, vive en EspoCRM
 * (p. ej. la que Gapssa deja al rechazar desde su propia interfaz); este
 * registro solo necesita saber que fue "RejectedByStaff".
 */
export const BOOKING_REASON_CODES = [
  ...MEETING_RESOLUTION_REASONS,
  "VerificationExpired",
  "RecoveryWindowExceeded",
  /** Ver BOOKING_REQUEST_RESOLUTIONS: "contact_review_rejected"/"contact_review_expired". */
  "ContactReviewRejectedByStaff",
  "ContactReviewExpired",
] as const;
export type BookingReasonCode = (typeof BOOKING_REASON_CODES)[number];

/** Alias retenido por claridad semántica en el resto del archivo. */
export const APPROVAL_EXPIRED_REASON: BookingReasonCode = "ApprovalExpired";

export interface GuestContactInfo {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

/**
 * Petición inicial de reserva como invitado. Da origen a un
 * BookingRequestRecord (Postgres) + un PendingGuestIdentity (Postgres,
 * cifrado) + un BookingLock (Redis); todavía no escribe nada en EspoCRM.
 */
export interface GuestBookingRequest {
  idempotencyKey: IdempotencyKey;
  treatmentId: string;
  professionalId: string;
  zoneId: string;
  /** ISO 8601 en UTC. */
  startAt: string;
  guest: GuestContactInfo;
}

// ---------------------------------------------------------------------------
// Persistencia del ciclo de reserva — tres piezas, no dos (revisión 4
// corrige la revisión 3: BookingLock en Redis era el único lugar donde
// vivía GuestContactInfo; si Redis fallaba o perdía la clave entre
// consumir el OTP y crear el Contact/Meeting, el reintento no tenía forma
// de reconstruir con quién era la reserva, aunque BookingRequestRecord
// hubiera sobrevivido en Postgres).
//
// A. BookingRequestRecord (Postgres, duradero): fuente de verdad del
//    ESTADO DE LA SOLICITUD y de su historial. No contiene datos
//    personales del invitado.
//
// B. PendingGuestIdentity (Postgres, duradero, cifrado): los datos de
//    contacto del invitado, cifrados en la aplicación, mientras no existe
//    todavía un Contact/Meeting en EspoCRM que sea su fuente de verdad
//    definitiva. Es lo que permite reanudar "verification_processing" tras
//    perder Redis. Ver detalle más abajo.
//
// C. BookingLock (Redis, TTL): exclusión mutua para impedir dobles
//    reservas. Ya NO lleva GuestContactInfo — solo datos de bloqueo
//    (horario, fase, expiración). Reconstruible desde A; nunca la única
//    señal para decidir una transición de negocio.
//
// Fuentes de verdad por tipo de dato:
//   - Estado de la solicitud: BookingRequestRecord.status/resolution (Postgres).
//   - Identidad del invitado antes de que exista Meeting:
//     PendingGuestIdentity (Postgres, cifrado) — nunca Redis, nunca en
//     claro.
//   - Estado del Meeting (una vez creado): EspoCRM, cEstadoReserva/status.
//     Desde ese momento, el Contact de EspoCRM es la fuente de verdad del
//     contacto (PROJECT_CONTEXT.md §11) y PendingGuestIdentity se purga.
//   - Ocupación temporal del horario: mientras no existe Meeting, el
//     BookingLock de Redis es la única protección real contra una doble
//     reserva concurrente. Desde que existe Meeting, la disponibilidad la
//     protege EspoCRM; el BookingLock en fase "approval" es una capa
//     adicional, no la fuente de verdad.
//   - Historial y auditoría: BookingRequestRecord (createdAt/resolvedAt/
//     resolution/reasonCode) + log nativo de EspoCRM sobre
//     cEstadoReserva/status + AuditEntry del BFF (audit.ts). Ninguno de
//     los tres contiene PII del invitado ni de PendingGuestIdentity.
// ---------------------------------------------------------------------------

export const BOOKING_REQUEST_STATUSES = [
  "pending_verification",
  "verification_processing",
  "contact_review_pending",
  "pending_approval",
  "resolved",
] as const;
export type BookingRequestStatus = (typeof BOOKING_REQUEST_STATUSES)[number];

/**
 * `contact_review_pending` (Fase 4B): entra desde `verification_processing`
 * cuando el matching de Contact contra EspoCRM real (paso 6) devuelve
 * `manual_review` — varias coincidencias o señales contradictorias, nunca
 * se fusiona ni se elige arbitrariamente. El Meeting NUNCA se crea desde
 * este estado. Es retryable: una nueva pasada de `completeBookingToMeeting`
 * repite el matching (p. ej. tras `/internal/sweep`, si Gapssa depuró el
 * duplicado en EspoCRM) — mismo espíritu que el reintento tras un fallo de
 * EspoCRM. No es motivo de purga de `PendingGuestIdentity`
 * (`decidePendingGuestIdentityPurgeTrigger` no lo trata como tal, igual que
 * un fallo transitorio de EspoCRM).
 */

export const BOOKING_REQUEST_RESOLUTIONS = [
  "confirmed",
  "rejected",
  "verification_expired",
  "approval_expired",
  /**
   * Revisión 2 de Fase 4B, punto 3/6: `contact_review_pending` YA NO es un
   * estado sin salida — un operador autorizado puede rechazar la revisión
   * (el conflicto no se resuelve nunca, p. ej. Gapssa determina que son
   * personas distintas) o esta puede caducar sin decisión. Ambos casos
   * terminan el ciclo de la solicitud igual que cualquier otra resolución
   * — nunca queda un `BookingRequestRecord` en un estado del que ningún
   * mecanismo (manual o de barrido) pueda sacarlo.
   */
  "contact_review_rejected",
  "contact_review_expired",
] as const;
export type BookingRequestResolution = (typeof BOOKING_REQUEST_RESOLUTIONS)[number];

/**
 * Registro duradero en Postgres. Fuente de verdad del estado de la
 * solicitud. Sin datos personales del invitado — ver PendingGuestIdentity.
 */
export interface BookingRequestRecord {
  id: string;
  /** Null hasta que se completa la verificación y se crea el Meeting. */
  meetingId: string | null;
  treatmentId: string;
  professionalId: string;
  zoneId: string;
  /** ISO 8601 UTC. */
  startAt: string;
  /** ISO 8601 UTC. startAt + duración del tratamiento en el momento de la solicitud. */
  endAt: string;
  status: BookingRequestStatus;
  /** Válido mientras status = "pending_verification" | "verification_processing". */
  verificationExpiresAt: string;
  /** Se rellena al crear el Meeting (status -> "pending_approval"); null antes. */
  approvalExpiresAt: string | null;
  createdAt: string;
  /** Null mientras status != "resolved". */
  resolvedAt: string | null;
  resolution: BookingRequestResolution | null;
  /**
   * Motivo técnico estructurado (revisión 4: ya no es texto libre — ver
   * BOOKING_REASON_CODES). Cualquier nota humana asociada a un rechazo
   * vive en EspoCRM, no aquí (ver audit.ts §reasonCode vs. nota humana).
   */
  reasonCode: BookingReasonCode | null;
  idempotencyKey: IdempotencyKey;
}

// ---------------------------------------------------------------------------
// PendingGuestIdentity — almacenamiento temporal duradero y cifrado
// (revisión 4). Diseño de contrato; el cifrado en sí (AES-256-GCM) es
// implementación de Fase 4, no de esta revisión.
// ---------------------------------------------------------------------------

/**
 * Envoltura de cifrado autenticado para un campo de texto. Nunca se
 * guarda el valor en claro. AES-256-GCM (o equivalente con autenticación
 * integrada): `nonce` debe ser único por cifrado, `ciphertext` incluye el
 * tag de autenticación. `keyVersion` identifica qué versión del secreto de
 * servidor (gestionado fuera del repositorio, p. ej. variable de entorno o
 * gestor de secretos — a definir en Fase 1) cifró el valor, para poder
 * rotar la clave sin invalidar de golpe los datos ya guardados.
 */
export interface EncryptedField {
  keyVersion: string;
  /** Base64. Único por cifrado — nunca reutilizar un nonce con la misma clave. */
  nonce: string;
  /** Base64. Incluye el tag de autenticación de GCM. */
  ciphertext: string;
}

export const PENDING_GUEST_IDENTITY_STATUSES = ["active", "consumed", "discarded"] as const;
export type PendingGuestIdentityStatus = (typeof PENDING_GUEST_IDENTITY_STATUSES)[number];

/**
 * Datos de contacto del invitado mientras no existe todavía un
 * Contact/Meeting en EspoCRM. Relacionado 1:1 con BookingRequestRecord por
 * `bookingRequestId`. Es lo único que permite reanudar
 * "verification_processing" si Redis falla o pierde la clave antes de
 * terminar de crear el Meeting — sin esto, un BookingRequestRecord
 * recuperado de Postgres no tendría con quién completar la reserva.
 *
 * - `firstName`/`lastName`/`email`/`phone`: cifrados en la aplicación
 *   (EncryptedField), nunca en texto plano.
 * - `emailLookupHmac`: HMAC-SHA-256 del correo normalizado (minúsculas,
 *   sin espacios) con un secreto de servidor — **no** el correo en claro.
 *   Único uso previsto: contar solicitudes pendientes por correo para
 *   aplicar MAX_PENDING_REQUESTS_PER_CLIENT sin poder invertir el hash. No
 *   es un índice de búsqueda general ni sustituye al cifrado del campo
 *   `email`.
 * - Nunca aparece en índices legibles más allá de `id`/`bookingRequestId`/
 *   `emailLookupHmac`, en claves Redis, en `idempotencyKey` ni en
 *   `AuditEntry` (ver audit.ts): el actor de auditoría de un invitado usa
 *   `guestId` opaco (= `bookingRequestId`), nunca estos campos.
 */
export interface PendingGuestIdentity {
  id: string;
  bookingRequestId: string;
  firstName: EncryptedField;
  lastName: EncryptedField;
  email: EncryptedField;
  phone: EncryptedField;
  emailLookupHmac: string;
  status: PendingGuestIdentityStatus;
  createdAt: string;
  /** Igual a BookingRequestRecord.verificationExpiresAt en el momento de crearla. */
  expiresAt: string;
}

/**
 * Debe purgarse (DELETE físico, no solo `status = "discarded"` indefinido
 * en el tiempo — el job de limpieza de §cleanup la elimina poco después de
 * marcarla) en estos casos, y solo en estos:
 *
 * 1. Se crea y vincula correctamente el Contact/Meeting (status ->
 *    "consumed"; el Contact de EspoCRM ya es la fuente de verdad).
 * 2. Expira la verificación sin completarse (resolution =
 *    "verification_expired", reasonCode = "VerificationExpired").
 * 3. Se cancela la solicitud antes de completarse (cualquier resolución
 *    que termine el ciclo antes de vincular Meeting).
 * 4. El proceso queda abandonado más allá de
 *    VERIFICATION_RECOVERY_WINDOW_MINUTES (resolution =
 *    "verification_expired", reasonCode = "RecoveryWindowExceeded").
 *
 * En ningún otro momento se borra: en particular, un fallo de EspoCRM
 * durante la creación del Meeting **no** es motivo de borrado — ver
 * §Flujo recuperable, paso 8.
 */
export const PENDING_GUEST_IDENTITY_PURGE_TRIGGERS = [
  "meeting_linked",
  "verification_expired",
  "request_canceled",
  "recovery_window_exceeded",
  /**
   * Revisión 2 de Fase 4B, punto 3: la identidad (invitado o cliente
   * autenticado — ver PendingAuthenticatedContactDetails) debe conservarse
   * MIENTRAS `contact_review_pending` sigue abierto (nunca se purga solo
   * por entrar en ese estado), y purgarse en cuanto la revisión se cierra
   * sin vincular Meeting: rechazada por un operador, o caducada sin
   * decisión.
   */
  "review_rejected",
  "review_expired",
] as const;
export type PendingGuestIdentityPurgeTrigger =
  (typeof PENDING_GUEST_IDENTITY_PURGE_TRIGGERS)[number];

/**
 * Parte pura y comprobable de la decisión de purgar (o no)
 * PendingGuestIdentity: dados el estado actual del BookingRequestRecord y
 * la hora, decide qué disparador aplica — sin tocar Postgres/Redis/
 * EspoCRM, que es responsabilidad del BFF (Fase 4). Cubre 3 de los 4
 * disparadores de PENDING_GUEST_IDENTITY_PURGE_TRIGGERS: "meeting_linked"
 * (en cuanto `meetingId` queda escrito, sin esperar a la resolución
 * final: la identidad ya no hace falta porque el Contact de EspoCRM pasa
 * a ser la fuente de verdad), "verification_expired" y
 * "recovery_window_exceeded". `request_canceled` requiere una acción
 * explícita del cliente que todavía no tiene endpoint diseñado; no es
 * derivable solo de estos datos, así que esta función nunca lo devuelve.
 * Devuelve `null` si la solicitud sigue activa y la identidad debe
 * conservarse.
 */
export function decidePendingGuestIdentityPurgeTrigger(
  record: Pick<BookingRequestRecord, "status" | "resolution" | "meetingId">,
  now: Date,
  recoveryDeadline: Date,
): PendingGuestIdentityPurgeTrigger | null {
  if (record.meetingId !== null) {
    return "meeting_linked";
  }

  if (record.status === "resolved" && record.resolution === "verification_expired") {
    return "verification_expired";
  }

  if (record.status === "resolved" && record.resolution === "contact_review_rejected") {
    return "review_rejected";
  }

  if (record.status === "resolved" && record.resolution === "contact_review_expired") {
    return "review_expired";
  }

  if (record.status === "verification_processing" && now.getTime() >= recoveryDeadline.getTime()) {
    return "recovery_window_exceeded";
  }

  return null;
}

/** Alias — el mismo catálogo de disparadores se reutiliza para PendingAuthenticatedContactDetails (ver más abajo), no es exclusivo del invitado. */
export type PendingContactDetailsPurgeTrigger = PendingGuestIdentityPurgeTrigger;

// ---------------------------------------------------------------------------
// PendingAuthenticatedContactDetails — revisión 2 de Fase 4B, punto 3.
// Contraparte de PendingGuestIdentity para el flujo de CLIENTE AUTENTICADO:
// `authenticatedFlow.ts` solo recibía `firstName`/`lastName`/`phone` en el
// cuerpo de la petición (el correo y `gapssaAccountId` siempre se derivan
// de `ClientAccount`, nunca se reintroducen) y los perdía en cuanto
// terminaba la petición — si `completeBookingToMeeting` entraba en
// `contact_review_pending`, un reintento posterior no tenía con quién
// reanudar. Mismo cifrado (EncryptedField), mismos disparadores de purga
// que PendingGuestIdentity, en la MISMA base (`gapssa_booking`) — NUNCA en
// `gapssa_auth` (`docs/fase3-autenticacion.md` §1: `ClientAccount` no
// duplica la ficha operativa completa; este registro es temporal y
// vinculado a UNA solicitud, no un duplicado permanente del perfil).
// ---------------------------------------------------------------------------

/**
 * Datos de contacto de un cliente autenticado mientras una solicitud suya
 * sigue sin Meeting (incluida `contact_review_pending`). Relacionado 1:1
 * con BookingRequestRecord por `bookingRequestId`. `email`/`gapssaAccountId`
 * NUNCA se guardan aquí — se derivan siempre de `clientAccountId` en el
 * momento de reanudar, nunca de una copia que pudiera desincronizarse.
 * Purga: mismos disparadores que PendingGuestIdentity
 * (PendingContactDetailsPurgeTrigger) — en particular, "meeting_linked" en
 * cuanto se escribe `meetingId`, y "review_rejected"/"review_expired" si
 * `contact_review_pending` se cierra sin vincular Meeting. Nunca se
 * conserva indefinidamente.
 */
export interface PendingAuthenticatedContactDetails {
  id: string;
  bookingRequestId: string;
  firstName: EncryptedField;
  lastName: EncryptedField;
  phone: EncryptedField;
  status: PendingGuestIdentityStatus;
  createdAt: string;
  /** TTL propio, independiente del de PendingGuestIdentity — igual de corto: no hay motivo de negocio para retenerlo más que el ciclo de la propia solicitud. */
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// BookingReviewRecord — revisión 2 de Fase 4B, punto 3/6. Registro duradero
// y mínimo de resolución manual para `contact_review_pending`: sin esto,
// ese estado no tenía ningún camino de salida salvo un reintento
// automático que repitiera EXACTAMENTE el mismo matching ambiguo (nunca
// converge por sí solo). Vive en `gapssa_booking`
// (`booking_review_records`), nunca contiene PII — nombre/correo/teléfono
// de nadie. `candidateContactIds`/`candidateMeetingIds` son identificadores
// OPACOS de EspoCRM (UUIDs), nunca datos personales; se conservan solo
// para que un operador autorizado, ya dentro de EspoCRM, pueda localizar
// los registros en conflicto — la API pública (`app/api/booking/v1/**`,
// nunca `internal/**`) no los expone jamás.
// ---------------------------------------------------------------------------

/** Catálogo cerrado de tipos de conflicto — cualquier motivo nuevo se añade aquí explícitamente, nunca como texto libre. */
export const BOOKING_REVIEW_CONFLICT_TYPES = [
  /** findOrCreateContact: correo y/o cuenta Gapssa devuelven más de un Contact candidato. */
  "contact_multiple_matches",
  /** findOrCreateContact: correo y teléfono apuntan a Contacts DISTINTOS. */
  "contact_conflicting_signals",
  /** findMeetingByBookingRequestId: más de un Meeting comparte el mismo cBookingRequestId. */
  "meeting_duplicate",
  /** Meeting encontrado, compatible en tratamiento/profesional/zona/horario, pero sin ningún Contact relacionado. */
  "meeting_contact_missing",
  /** Meeting encontrado con exactamente un Contact relacionado, pero distinto del Contact esperado para esta solicitud. */
  "meeting_contact_mismatch",
  /** Meeting encontrado con más de un Contact relacionado. */
  "meeting_multiple_contacts",
  /**
   * Revisión 3 de Fase 4B, punto 2: el Meeting encontrado por
   * `cBookingRequestId` durante una REANUDACIÓN (`resolveBookingReview`) ya
   * no coincide en horario/tratamiento/profesional/zona con la solicitud
   * (`IncompatibleMeetingError`) — a diferencia de la primera apertura
   * (donde esto se trata como incidente operativo que detiene el flujo, ver
   * `verificationSteps.ts`), durante una reanudación la revisión NUNCA se
   * cierra sin salida: se reemplaza por una revisión de este tipo, para que
   * quede como conflicto abierto y trazable en vez de un error que un
   * operador no puede resolver desde aquí.
   */
  "meeting_incompatible",
  /**
   * Puerta 5B-2A — mecanismo TEMPORAL de pruebas controladas, no una
   * regla de negocio normal: el Meeting encontrado por
   * `cBookingRequestId` en una recuperación idempotente (reintento tras
   * timeout) es compatible en tratamiento/profesional/zona/horario/Contact,
   * pero su `cExcluirGoogleCalendarSync` real no coincide con el valor
   * esperado por la ejecución de prueba en curso
   * (`server/booking/controlledTestMode.ts`). Nunca se muta el Meeting
   * para "corregir" el campo — se abre revisión manual, igual que
   * cualquier otra incompatibilidad de adopción. Solo alcanzable cuando
   * `ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS=true`; inalcanzable en operación
   * normal.
   */
  "meeting_gcs_exclusion_mismatch",
] as const;
export type BookingReviewConflictType = (typeof BOOKING_REVIEW_CONFLICT_TYPES)[number];

/**
 * Revisión 3 de Fase 4B, punto 2: workflow durable con lease —
 * `"processing"` es el estado durante el cual una revisión está reclamada
 * (`claimToken`/`claimedAt`/`leaseExpiresAt`, solo en el esquema físico,
 * mismo patrón que `booking_outbox_jobs` — nunca expuesto en
 * `BookingReviewRecord`) por una reanudación en curso — solo el poseedor
 * del claim vigente puede cerrarla. `"replaced"` es el estado terminal de
 * una revisión superada por una NUEVA revisión abierta durante su propia
 * reanudación (otro conflicto, o `meeting_incompatible`) — nunca se
 * reabre, la nueva revisión es la única activa a partir de ahí.
 */
export const BOOKING_REVIEW_STATUSES = ["pending", "processing", "resolved", "rejected", "expired", "replaced"] as const;
export type BookingReviewStatus = (typeof BOOKING_REVIEW_STATUSES)[number];

/**
 * Registro duradero y mínimo — nunca la fuente de verdad del propio
 * conflicto (eso sigue viviendo en EspoCRM: los Contacts/Meetings
 * candidatos reales), solo el hecho auditable de que existe un conflicto
 * de este tipo cerrado, para este `bookingRequestId`, y cómo se resolvió.
 */
export interface BookingReviewRecord {
  id: string;
  bookingRequestId: string;
  conflictType: BookingReviewConflictType;
  /** IDs opacos de EspoCRM (Contact) — nunca PII, nunca expuestos por la API pública. Null si el tipo de conflicto no aplica (p. ej. meeting_duplicate). */
  candidateContactIds: string[] | null;
  /** IDs opacos de EspoCRM (Meeting) — mismo alcance que candidateContactIds. */
  candidateMeetingIds: string[] | null;
  status: BookingReviewStatus;
  createdAt: string;
  resolvedAt: string | null;
  /** Identificador del operador autorizado que resolvió/rechazó — nunca un actor de sistema (una expiración por barrido sí usa el actor "system", ver audit.ts). */
  resolvedBy: string | null;
  /** Contact elegido por el operador al resolver — null si `status` no es "resolved". Nunca se infiere automáticamente de candidateContactIds[0]. */
  resolutionContactId: string | null;
  /** Caducidad propia — una revisión abierta indefinidamente es, en sí misma, el mismo problema que un `PendingGuestIdentity` sin caducidad. */
  expiresAt: string;
}

export const BOOKING_LOCK_PHASES = ["verification", "approval"] as const;
export type BookingLockPhase = (typeof BOOKING_LOCK_PHASES)[number];

/**
 * Bloqueo en Redis, exclusivamente para exclusión mutua. `requestId`
 * referencia siempre un BookingRequestRecord existente: el lock nunca es
 * la única copia de la verdad, y **ya no lleva datos personales del
 * invitado** (corrección de la revisión 4 — antes incluía
 * `GuestContactInfo`; ahora vive, cifrado, en PendingGuestIdentity). TTL
 * real: GUEST_VERIFICATION_HOLD_MINUTES en fase "verification",
 * APPROVAL_HOLD_HOURS en fase "approval".
 */
export interface BookingLock {
  requestId: string;
  phase: BookingLockPhase;
  treatmentId: string;
  professionalId: string;
  zoneId: string;
  startAt: string;
  endAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Flujo recuperable de verificación (revisión 4 — orden exacto). No es una
// transacción distribuida: es una secuencia de pasos idempotentes, cada
// uno reanudable si el anterior no se completó o su resultado se perdió.
// Ningún paso deja el OTP consumido sin que la identidad necesaria para
// terminar la reserva siga existiendo en algún punto recuperable.
//
//   1. El invitado introduce el código. otp.ts valida el OTP contra el
//      OtpChallenge (contexto: challengeId+purpose+subjectRef+code, ver
//      otp.ts) SIN permitir reutilización: si ya estaba `consumedAt` o
//      `lockedAt`, se rechaza aquí y no se avanza ningún paso más.
//   2. Se marca el reto, de forma ATÓMICA (compare-and-swap sobre
//      `consumedAt`/`attemptsUsed` en Redis), como consumido —o bloqueado,
//      si se superó `maxAttempts`—. A partir de aquí el código ya no sirve
//      para un segundo intento, se complete o no el resto del flujo.
//   3. BookingRequestRecord -> "verification_processing" (compare-and-swap:
//      solo si `status` seguía en "pending_verification"; si ya no lo
//      está, es un reintento -> ir al paso 7).
//   4. Se recupera PendingGuestIdentity por `bookingRequestId` (Postgres,
//      cifrado). Si no existe y el registro tampoco tiene `meetingId`
//      todavía, es un estado inconsistente que solo puede venir de una
//      purga prematura -> lo trata la conciliación (nunca se inventa un
//      Contact con datos vacíos).
//   5. Búsqueda idempotente en EspoCRM de un Meeting ya creado para este
//      `requestId` (campo previsto `cBookingRequestId`, mismo patrón que
//      `GcsEventLink`/`espoMeetingId` de Google Calendar Sync). Si existe,
//      se adopta.
//   6. Si no existe, se descifra PendingGuestIdentity, se busca o crea el
//      Contact en EspoCRM (idempotente: por teléfono/correo, con las
//      mismas reglas de coincidencia dudosa de PROJECT_CONTEXT.md §7.1 —
//      diseño de Fase 4) y se crea el Meeting con
//      `cEstadoReserva="PendingCenterApproval"` y
//      `cBookingRequestId=requestId`.
//   7. Se escribe `meetingId` en BookingRequestRecord y se transiciona a
//      "pending_approval" (idempotente: si `meetingId` ya estaba puesto,
//      no-op).
//   8. **Solo después** de confirmar que `meetingId` quedó escrito en
//      Postgres (resultado duradero confirmado), se purga
//      PendingGuestIdentity (`meeting_linked`). Si EspoCRM falla en el
//      paso 6, o la escritura del paso 7 falla, PendingGuestIdentity **se
//      conserva** para el próximo reintento — nunca se borra por un fallo
//      de EspoCRM.
//   9. Si se supera VERIFICATION_RECOVERY_WINDOW_MINUTES sin llegar al
//      paso 8, la conciliación resuelve el BookingRequestRecord como
//      "verification_expired" (`reasonCode = "RecoveryWindowExceeded"`) y
//      purga PendingGuestIdentity (`recovery_window_exceeded`).
//   10. Se activa/renueva el BookingLock en fase "approval". Si falla
//       (p. ej. Redis caído), no es crítico: `approvalExpiresAt` ya quedó
//       en Postgres, que es lo que consulta el barrido — Redis se
//       reconstruye desde ahí.
//
// Casos cubiertos explícitamente:
//   - OTP verificado y consumido, pero Redis falla antes de crear
//     Contact/Meeting: PendingGuestIdentity sigue en Postgres (paso 4);
//     el reintento retoma desde ahí sin depender de Redis en absoluto.
//   - EspoCRM crea el Meeting pero falla la escritura en Postgres/Redis:
//     el Meeting queda con `cBookingRequestId` propio; el siguiente
//     reintento (paso 5) lo adopta. No se duplica.
//   - Se transiciona a "verification_processing" pero falla la creación
//     en EspoCRM: el reintento repite los pasos 5-6. No se duplica.
//   - El cliente reintenta la verificación: el OTP ya está consumido
//     (paso 1 lo rechaza como reutilización) y, si `meetingId` ya existe,
//     el backend devuelve el resultado existente sin repetir nada.
// ---------------------------------------------------------------------------

/**
 * Campo previsto en Meeting para Fase 4 (no desplegado en esta revisión):
 * enlaza el Meeting con el BookingRequestRecord que lo originó, para poder
 * buscarlo de forma idempotente si se pierde la respuesta de creación.
 */
export const MEETING_BOOKING_REQUEST_FIELD = "cBookingRequestId" as const;

/**
 * Revisión 2 de Fase 4B, punto 4: nombre API real (no inventado) del campo
 * custom que enlaza `Contact` con `gapssa_auth.client_accounts.id`. El
 * campo **no existe todavía** en la instancia real (confirmado en la
 * auditoría de solo lectura de `docs/fase4b-integracion-http.md` §1/§2) —
 * no hay ningún valor que "descubrir" inspeccionando Studio, así que esto
 * es una decisión de nomenclatura, no un hallazgo. Se fija en
 * `cGapssaAccountId`, no `gapssaAccountId`, por consistencia con el ÚNICO
 * patrón real observado en esta misma instancia para campos custom creados
 * por Studio: `Meeting.cEstadoReserva`, `Meeting.cTratamiento`,
 * `Meeting.cZonaAtencion` y el propio `MEETING_BOOKING_REQUEST_FIELD`
 * (`cBookingRequestId`, también pendiente de crear) — confirmado
 * leyendo `extensions/espocrm/custom/Espo/Custom/Resources/metadata/entityDefs/Meeting.json`
 * (export real del contenedor, nunca inventado), que muestra los tres
 * campos custom reales de `Meeting` con el mismo prefijo `c`/`C`. EspoCRM
 * Studio en sí NO impone este prefijo (es libre para un campo simple como
 * un `varchar`) — es una convención ya establecida en ESTA instancia por
 * quien creó los campos anteriores, y se sigue aquí para no introducir una
 * excepción sin motivo el día que se cree el campo de verdad.
 *
 * Nombre CONCEPTUAL (`gapssaAccountId`, usado en `SimContact`,
 * `FindOrCreateContactInput`, `sim_espo_contacts.gapssa_account_id`, etc.)
 * y nombre REAL en EspoCRM (`CONTACT_GAPSSA_ACCOUNT_ID_FIELD`) se
 * mantienen deliberadamente separados: el primero es el atributo del
 * dominio del portal; el segundo es el nombre de cable exacto que
 * `HttpEspoBookingAdapter` debe usar en `select`/`where`/payload contra la
 * API real — nunca al revés, y nunca se asume que coinciden por
 * casualidad. Toda referencia al nombre real DEBE pasar por esta
 * constante — no repetir el literal en otro sitio.
 */
export const CONTACT_GAPSSA_ACCOUNT_ID_FIELD = "cGapssaAccountId" as const;

export interface BookingMeetingCreated {
  requestId: string;
  meetingId: string;
  meetingState: "PendingCenterApproval";
  /** = createdAt del Meeting + APPROVAL_HOLD_HOURS. */
  approvalExpiresAt: string;
}

/**
 * Decisión humana de Gapssa sobre un Meeting en PendingCenterApproval,
 * tomada desde EspoCRM. Al aprobar: cEstadoReserva -> Confirmed. Al
 * rechazar: cEstadoReserva -> Canceled (nunca se borra el Meeting ni la
 * solicitud). Cualquier nota que Gapssa deje al rechazar vive en EspoCRM
 * (p. ej. en el propio Meeting); el BFF la relaya para notificar al
 * cliente pero **nunca** la copia en `AuditEntry.reason` — ahí solo va un
 * `reasonCode` (ver audit.ts).
 */
export type BookingApprovalDecision =
  | {
      decision: "approved";
      meetingId: string;
      requestId: string;
      decidedBy: string;
      decidedAt: string;
      resultingState: "Confirmed";
    }
  | {
      decision: "rejected";
      meetingId: string;
      requestId: string;
      decidedBy: string;
      decidedAt: string;
      /** Nota operativa observada en EspoCRM, no generada ni duplicada por el BFF. */
      note?: string;
      resultingState: "Canceled";
    };

/**
 * Transición de sistema (no una decisión humana): el barrido de
 * reconciliación consulta BookingRequestRecord.approvalExpiresAt (nunca
 * solo el TTL de Redis) y detecta un Meeting en PendingCenterApproval cuyo
 * plazo venció sin decisión. El Meeting pasa a Canceled con
 * reasonCode = "ApprovalExpired"; no se borra ni se reescribe como si
 * nunca hubiera existido.
 */
export interface BookingApprovalExpired {
  meetingId: string;
  requestId: string;
  expiredAt: string;
  resultingState: "Canceled";
  reasonCode: "ApprovalExpired";
}

/**
 * Contadores del disparador durable del outbox de envío de OTP de invitado
 * (revisión 3 de Fase 4A, punto 4) — un lote limitado de
 * `booking_outbox_jobs` elegibles (`pending`, `failed_retryable` vencido,
 * `processing` con lease vencido) procesado en cada pasada del barrido, sin
 * que el cliente tenga que repetir `POST /requests` para que un job
 * atascado avance. Los contadores NO son particiones mutuamente
 * excluyentes: `abandonedRecovered` es una señal adicional sobre cuántos de
 * los `sent`/`retryable` de esta misma pasada partían de un job
 * `processing` abandonado (lease vencido) — nunca un total aparte que haya
 * que sumar a los otros tres para obtener el total de candidatos.
 */
export interface BookingOutboxSweepReport {
  /** Jobs para los que esta pasada envió el correo con éxito. */
  sent: number;
  /** Jobs que quedaron `failed_retryable` (Redis/SMTP caído, rate limit) — se reintentarán en una pasada posterior. */
  retryable: number;
  /** Jobs cerrados sin enviar porque la solicitud ya no era un objetivo válido (caducada o resuelta) — ver punto 5. */
  notProcessable: number;
  /** De los `sent`/`retryable` de arriba, cuántos partían de un job `processing` abandonado (lease vencido) recuperado en esta misma pasada. */
  abandonedRecovered: number;
}

/**
 * Resultado del barrido de conciliación (BFF, Fase 1+). No sustituye la
 * conciliación diaria general de contratos-portal-v1.md §8.3: la
 * complementa con los contadores específicos de este flujo.
 */
export interface BookingReconciliationReport {
  ranAt: string;
  /** BookingLock recreados en Redis a partir de BookingRequestRecord activos. */
  reconstructedLocks: number;
  /** BookingRequestRecord en pending_approval resueltos como approval_expired. */
  expiredApprovals: number;
  /** BookingRequestRecord resueltos como verification_expired (TTL normal o ventana de recuperación superada). */
  expiredVerifications: number;
  /** PendingGuestIdentity purgadas en esta pasada, por disparador (ver PENDING_GUEST_IDENTITY_PURGE_TRIGGERS). */
  purgedGuestIdentities: Record<PendingGuestIdentityPurgeTrigger, number>;
  /** Meetings con cEstadoReserva y status nativo inconsistentes según ESTADO_RESERVA_A_MEETING_STATUS. */
  inconsistentMeetings: number;
  /** Disparador durable del outbox de OTP de invitado — revisión 3, punto 4. */
  outboxJobs: BookingOutboxSweepReport;
  /** Revisión 2 de Fase 4B, punto 3/6: BookingReviewRecord `pending` cuyo plazo venció, caducados en esta pasada (`resolution = "contact_review_expired"`). */
  expiredReviews: number;
  /** Revisión 3 de Fase 4B, punto 9: BookingReviewRecord `processing` cuyo lease venció (reanudación abandonada) — devueltas a `pending`, vuelven a ser reclamables. */
  recoveredStaleReviewClaims: number;
  /**
   * Revisión 3 de Fase 4B, punto 9: estados parciales detectados que el
   * barrido NUNCA decide por sí solo (no se inventa qué Contact es
   * correcto) — solo cuenta para que queden marcados para revisión manual:
   * `contact_review_pending` sin revisión activa, revisión activa con la
   * solicitud ya fuera de `contact_review_pending`, y grupos de más de una
   * revisión activa heredada para el mismo `bookingRequestId`.
   */
  reviewInconsistencies: number;
  /**
   * Revisión 4 de Fase 4B, punto 2: BookingReviewRecord activa
   * (`pending`/`processing`) cuya BookingRequestRecord ya demuestra un
   * resultado durable de éxito (`meetingId` escrito + `pending_approval`, o
   * resuelta por una decisión posterior) — cerrada como `resolved` en esta
   * pasada porque ese resultado durable ya demuestra que el flujo terminó
   * (nunca se vuelve a elegir Contact ni se crea un Meeting). Una revisión
   * `processing` con lease todavía vigente de un worker activo nunca se
   * cuenta aquí — se deja para una pasada posterior.
   */
  reconciledCompletedReviews: number;
  /**
   * Revisión 4 de Fase 4B, punto 4: BookingRequestRecord ya resuelto (o con
   * `meetingId` ya vinculado) cuya PendingGuestIdentity/
   * PendingAuthenticatedContactDetails seguía `active` — la ventana real
   * entre un resultado durable y su propia purga (p. ej. una caída del
   * proceso entre ambos pasos). Purgada de forma segura en esta pasada
   * (contabilizada también en `purgedGuestIdentities`) cuando el estado real
   * permite decidir un disparador seguro; si no, cuenta aquí para revisión
   * manual — nunca se purga a ciegas.
   */
  orphanedPiiInconsistencies: number;
}

// ---------------------------------------------------------------------------
// Cancelación: PLAN_DESARROLLO_WEB_PORTAL.md §7.6. CancellationRequest
// representa la entidad custom de EspoCRM `CSolicitudCancelacion` (diseño
// completo en contratos-portal-v1.md §4 — no implementada todavía).
// ---------------------------------------------------------------------------

export const CANCELLATION_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "canceled",
] as const;
export type CancellationRequestStatus = (typeof CANCELLATION_REQUEST_STATUSES)[number];

/**
 * `reason` aquí es la nota operativa que vive en EspoCRM (campo `motivo`
 * de `CSolicitudCancelacion`) — no una copia dentro de un `AuditEntry`. Es
 * el DTO de lectura/escritura del BFF sobre esa entidad, no un registro de
 * auditoría.
 */
export interface CancellationRequest {
  id: string;
  meetingId: string;
  status: CancellationRequestStatus;
  requestedBy: "client" | "staff";
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  idempotencyKey: IdempotencyKey;
}

/**
 * Resultado de aplicar la regla de §7.6 al momento de la solicitud:
 * - `immediate: true` (>=24h de antelación): el Meeting pasa a Canceled en
 *   el mismo request, sin crear una CancellationRequest.
 * - `immediate: false` (<24h): se crea una CancellationRequest en estado
 *   "pending"; el Meeting permanece Confirmed hasta que Gapssa decida — el
 *   tipo deliberadamente no expone ningún estado de Meeting aquí, para no
 *   sugerir que cambia.
 */
export type CancellationOutcome =
  | { immediate: true; meetingId: string; meetingState: "Canceled" }
  | { immediate: false; meetingId: string; cancellationRequestId: string };

/**
 * Decisión de Gapssa sobre una CancellationRequest pendiente. Aprobar:
 * Meeting -> Canceled (y status nativo -> Not Held, ver
 * estado-reserva.ts). Rechazar: el Meeting permanece Confirmed sin más
 * cambios. Ambos casos generan un AuditEntry con reasonCode, nunca con el
 * texto de `reason` copiado dentro.
 */
export interface CancellationDecision {
  cancellationRequestId: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  decidedAt: string;
  /** Se escribe en CSolicitudCancelacion.motivo (EspoCRM), no en un AuditEntry. */
  reason?: string;
}

export interface RescheduleRequest {
  idempotencyKey: IdempotencyKey;
  meetingId: string;
  newStartAt: string;
  requestedAt: string;
}

/**
 * La cita original permanece Confirmed mientras se revisa el cambio; el
 * nuevo horario se protege con un BookingRequestRecord + PendingGuestIdentity
 * (si aplica) + BookingLock aparte (fase "approval", máx.
 * APPROVAL_HOLD_HOURS). Si se aprueba, el reemplazo es transaccional; si
 * se rechaza o caduca, se libera el nuevo lock y la cita original no se
 * toca.
 */
export interface RescheduleOutcome {
  originalMeetingId: string;
  newRequestId: string;
  originalMeetingState: "Confirmed";
}
