-- El DEFAULT 'v1' es exclusivamente para el backfill de filas YA
-- existentes en el instante de esta migración — se retira en la
-- sentencia siguiente, así que ningún INSERT posterior puede heredarlo
-- por accidente; el código de aplicación (guestFlow.ts) debe suministrar
-- emailLookupHmacKeyVersion explícitamente siempre.
ALTER TABLE "pending_guest_identities" ADD COLUMN "email_lookup_hmac_key_version" text NOT NULL DEFAULT 'v1';--> statement-breakpoint
ALTER TABLE "pending_guest_identities" ALTER COLUMN "email_lookup_hmac_key_version" DROP DEFAULT;--> statement-breakpoint

-- Nullable a propósito: NULL para el flujo autenticado (la sesión ya
-- prueba identidad, nunca se emite/persiste token de acceso — ver
-- accessToken.ts). No lleva DEFAULT: las filas de invitado, tanto nuevas
-- como históricas, reciben su valor explícitamente (aquí abajo para las
-- históricas; en el INSERT de repository.ts para las nuevas).
ALTER TABLE "booking_request_records" ADD COLUMN "access_token_key_version" text;--> statement-breakpoint

-- Backfill de solicitudes de INVITADO históricas (client_account_id IS
-- NULL) que ya existían antes de que esta columna existiera: todo token
-- de acceso emitido para una de ellas se firmó bajo el ÚNICO secreto
-- BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET pre-versionado que existía en
-- ese momento — equivalente, por construcción, a la versión 'v1' del
-- mapa BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS ya migrado (ver
-- docs/incidente-booking-secrets-local-2026-08-13.md). Sin este backfill,
-- verifyBookingRequestAccessToken (accessToken.ts) trataría
-- indistinguiblemente estas filas de invitado como si fueran del flujo
-- autenticado (accessTokenKeyVersion IS NULL ⇒ rechazo inmediato),
-- invalidando permanentemente cualquier token de invitado emitido antes
-- de esta migración. Las filas del flujo autenticado (client_account_id
-- IS NOT NULL) quedan intencionalmente excluidas por el WHERE — nunca
-- emiten token, deben conservar NULL. Idempotente: una segunda ejecución
-- no encuentra ninguna fila que siga cumpliendo
-- "access_token_key_version IS NULL", así que no reescribe nada. Sobre
-- una base vacía, el UPDATE afecta a 0 filas.
UPDATE "booking_request_records"
SET "access_token_key_version" = 'v1'
WHERE "client_account_id" IS NULL
  AND "access_token_key_version" IS NULL;--> statement-breakpoint

-- Restricción CHECK deliberadamente OMITIDA en esta migración, no por
-- ambigüedad del invariante en sí (auditado: booking_request_records solo
-- tiene dos caminos de INSERT — createGuestBookingRequest,
-- repository.ts:347, siempre escribe accessTokenKeyVersion;
-- createAuthenticatedBookingRequest, repository.ts:471, nunca lo escribe
-- — y ninguna llamada UPDATE en todo el árbol de código toca esta columna
-- después del INSERT; tras el backfill de arriba, "client_account_id IS
-- NULL" y "access_token_key_version IS NOT NULL" coinciden exactamente
-- para el 100% de las filas), sino porque un CHECK añadido aquí a mano no
-- tendría contrapartida en `schema.ts` dentro del alcance exacto de este
-- bloque (2 migraciones: enums GCS + versionado HMAC) — drizzle-kit no lo
-- vería reflejado en ningún snapshot, quedando invisible para su propio
-- diffing y convirtiéndose él mismo en el tipo de deriva no documentada
-- que este bloque de migraciones busca eliminar (punto 8 del informe
-- original). Recomendado como migración FUTURA, separada y explícitamente
-- autorizada: declarar `check(...)` en schema.ts y dejar que
-- `drizzle-kit generate` produzca su propia migración dedicada para
-- ella, con snapshot/journal coherentes.