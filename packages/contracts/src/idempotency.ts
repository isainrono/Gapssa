/**
 * Toda escritura que cruza sistemas (BFF -> EspoCRM, BFF -> n8n, futuros
 * webhooks) lleva una clave de idempotencia — regla obligatoria de
 * PROJECT_CONTEXT.md §14.
 *
 * La clave es un **UUID v4 generado por el cliente** que envía la
 * operación (apps/web u otro llamante del BFF), nunca un identificador
 * construido a partir de datos personales (sin correo, teléfono, nombre...).
 * Junto a la clave se guarda un hash canónico del payload:
 *
 * - Misma clave + mismo payload -> se trata como reintento: se devuelve el
 *   registro existente (resultado si ya completó, o el estado actual si
 *   sigue en curso), sin repetir la operación.
 * - Misma clave + payload distinto -> conflicto; se rechaza, no se ejecuta.
 * - Una operación nueva y legítima siempre usa una clave nueva
 *   (`generateIdempotencyKey`).
 * - Los reintentos internos del propio backend (p. ej. un job que reintenta
 *   tras un fallo de red) deben reutilizar la misma clave con la que se
 *   originó la operación, no generar una nueva.
 */
export type IdempotencyKey = string;

/** UUID v4. No incorporar correo, teléfono ni ningún otro dato personal. */
export function generateIdempotencyKey(): IdempotencyKey {
  return crypto.randomUUID();
}

export type IdempotencyStatus = "processing" | "completed" | "failed_retryable";

export interface IdempotencyRecord {
  key: IdempotencyKey;
  /** Hash canónico del payload de la operación — ver computePayloadHash. */
  payloadHash: string;
  status: IdempotencyStatus;
  /** Referencia al resultado (p. ej. id del Meeting/CancellationRequest). Null mientras status = "processing". */
  resultRef: string | null;
  createdAt: string;
  expiresAt: string;
}

export type IdempotencyCheckOutcome =
  | { kind: "new" }
  | { kind: "duplicate"; record: IdempotencyRecord }
  | { kind: "conflict" };

/**
 * El backend debe llamar a esto antes de ejecutar cualquier operación
 * idempotente, con el registro existente para esa clave (si lo hay) y el
 * hash del payload entrante.
 */
export function checkIdempotency(
  existingRecord: IdempotencyRecord | null,
  incomingPayloadHash: string,
): IdempotencyCheckOutcome {
  if (!existingRecord) return { kind: "new" };
  if (existingRecord.payloadHash !== incomingPayloadHash) return { kind: "conflict" };
  return { kind: "duplicate", record: existingRecord };
}

/**
 * Serializa un valor con las claves de cada objeto ordenadas de forma
 * determinista, para que el mismo payload lógico produzca siempre el mismo
 * hash sin importar el orden en que se construyó.
 */
export function canonicalizePayload(payload: unknown): string {
  return JSON.stringify(sortKeysDeep(payload));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/** Hash SHA-256 (hex) del payload canonicalizado. */
export async function computePayloadHash(payload: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalizePayload(payload));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
