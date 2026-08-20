# Incidente — exposición de cinco secretos de `booking` (entorno local, 2026-08-13)

**Fecha**: 2026-08-13, misma sesión que el incidente de
`POSTGRES_PASSWORD` (`docs/incidente-postgres-password-local-2026-08-13.md`),
inmediatamente posterior.
**Clasificación**: credenciales de entorno de desarrollo local, nunca
publicadas, nunca de producción.

> **ACTUALIZACIÓN (2026-08-13, más tarde la misma sesión) — CIERRE
> SUPERSEDED.** Las versiones `v2` preparadas en este incidente (§4)
> quedaron ellas mismas expuestas por una notificación automática del
> harness al editar `.env` — ver
> `docs/incidente-exposicion-env-completo-2026-08-13.md`. La auditoría de
> código, el inventario de datos y la herramienta de migración descritos
> aquí (§3, §5) siguen siendo correctos, válidos y reutilizables tal cual
> — nada de eso depende del valor concreto de ningún secreto. Lo que
> **no** es válido como cierre son las versiones `v2` en sí: deben
> descartarse sin activarse nunca, y la rotación real debe generar
> versiones `v3` siguiendo la puerta **S7** de
> `docs/plan-rotacion-secretos-gapssa-2026-08-13.md`, ejecutada fuera del
> harness. Este historial no se modifica ni se borra.

## 1. Qué ocurrió

Durante la reanudación de la Puerta 5B-2B (tras cerrar el incidente de
`POSTGRES_PASSWORD`), al investigar por qué el endpoint de disponibilidad
del proceso aislado devolvía cero huecos, se ejecutó:

```
grep "^BOOKING_" .env
```

para revisar los valores de configuración de horario de negocio
(`BOOKING_BUSINESS_DAYS`, `BOOKING_OPEN_TIME`, `BOOKING_CLOSE_TIME`). El
prefijo `BOOKING_` también coincide con cinco variables que son secretos
criptográficos, no configuración de negocio — el comando las imprimió
todas en la conversación:

1. `BOOKING_FIELD_ENCRYPTION_KEYS` — clave(s) AES-256-GCM que cifran PII
   de identidad (`pending_guest_identities`/`pending_authenticated_contact_details`).
2. `BOOKING_EMAIL_LOOKUP_HMAC_SECRET` — HMAC del correo normalizado del
   invitado, usado solo para contar solicitudes pendientes por correo.
3. `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS` — HMAC versionado de
   identidad/contacto usado en el payload canónico de idempotencia.
4. `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET` — HMAC estateless que
   protege el acceso de invitado a su propia solicitud pendiente.
5. `BOOKING_INTERNAL_API_SECRET` — secreto compartido de los endpoints
   internos de reservas (barrido de conciliación, decisión simulada).

Esta es, en gravedad, una categoría distinta de la de `POSTGRES_PASSWORD`:
`BOOKING_FIELD_ENCRYPTION_KEYS` protege PII cifrada en reposo, no solo
acceso a una base de datos local.

## 2. Contención inmediata

1. ACL de `cExcluirGoogleCalendarSync` confirmada sin cambio
   (`read=yes/edit=no`) — nunca se había abierto.
2. Confirmado cero `Contact`/`Meeting`/`BookingRequestRecord` nuevos.
3. Sesión de la cuenta ficticia de prueba: cerrada mediante `POST
   /api/auth/logout` real (el mecanismo normal del sistema, no una
   eliminación de fila) — confirmado `unauthenticated` en la siguiente
   consulta de sesión.
4. Proceso Next.js aislado de 5B-2B y mailbox SMTP efímero: detenidos con
   `SIGTERM`, puertos confirmados libres.
5. `NEXT_DIST_DIR` temporal (`.next-puerta5b2b`) y artefactos temporales
   (cookies, contraseña temporal de la cuenta ficticia, respuesta del
   correo OTP, metadatos del proceso aislado) eliminados.
6. Cuenta ficticia en sí: **no eliminada**, por instrucción explícita
   (conservarla para inspección o para una futura reanudación de 5B-2B).
7. `localhost:3000` confirmado sano y en `ESPO_BOOKING_ADAPTER=simulated`
   antes de continuar con la auditoría.

## 3. Auditoría segura de consumidores (por código, sin valores)

| Secreto | Función | Datos dependientes | ¿Admite versiones? | Estrategia de rotación | Criterio para retirar valor anterior |
|---|---|---|---|---|---|
| `BOOKING_FIELD_ENCRYPTION_KEYS` | `server/crypto/fieldCrypto.ts` — AES-256-GCM de campos de identidad | `pending_guest_identities`, `pending_authenticated_contact_details` (columnas `*Ciphertext`/`*Nonce`/`*KeyVersion` por campo) | **Sí, por diseño** — mapa `{keyVersion: claveBase64}`; `decryptField` acepta cualquier versión presente, `encryptField` usa solo la activa | Añadir versión nueva, marcarla activa, recifrar fila a fila (transaccional, con `SELECT ... FOR UPDATE`), retirar la anterior solo cuando `countRowsStillOnVersion` sea `0` | Cero filas con esa versión en cualquiera de las dos tablas |
| `BOOKING_EMAIL_LOOKUP_HMAC_SECRET` | `server/booking/guestFlow.ts` — HMAC del correo normalizado, columna indexada `email_lookup_hmac` | `pending_guest_identities.email_lookup_hmac` — **único uso: contar solicitudes pendientes por correo** (`MAX_PENDING_REQUESTS_PER_CLIENT`), nunca un índice de identidad permanente | No — secreto único, sin versión | Con cero filas activas (caso real, ver §4), sustitución directa es segura; con filas activas, requeriría recalculado transaccional o ventana dual | N/A en este incidente (cero filas dependientes) |
| `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS` | `server/booking/identityFingerprint.ts` — HMAC de identidad para el payload canónico de idempotencia | `booking_request_records.identity_fingerprint_key_version` (cada fila guarda con qué versión se calculó su huella) | **Sí, por diseño** — mismo patrón que el AES; recalcular usa siempre la versión guardada de la fila, nunca la activa actual | Añadir versión nueva, marcarla activa para huellas nuevas, conservar la anterior mientras exista algún `BookingRequestRecord` sin resolver que la referencie (cota superior: `APPROVAL_HOLD_HOURS` tras dejar de ser activa) | Cero `BookingRequestRecord` sin resolver referenciando esa versión |
| `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET` | `server/booking/accessToken.ts` — `HMAC-SHA256(bookingRequestId, secreto)`, estateless | Ninguna columna propia — se recalcula bajo demanda; "tokens vivos" = cualquier `BookingRequestRecord` no resuelto cuyo enlace de acceso un invitado pueda seguir usando | No — secreto único; rotar invalida TODOS los tokens ya emitidos de golpe (determinista, sin almacenamiento) | Determinar primero si hay `BookingRequestRecord` activos (no resueltos); si no hay ninguno, rotación directa | N/A si cero registros activos |
| `BOOKING_INTERNAL_API_SECRET` | `server/booking/internalAuth.ts` — comparación en tiempo constante (`timingSafeEqual`), cabecera `X-Internal-Api-Secret` | Ninguna — protege únicamente el barrido de conciliación y la decisión simulada, ambos de invocación manual hoy (sin scheduler real desplegado) | No | Sustitución directa; actualizar el único consumidor real (proceso principal) | N/A — sin dependencia de datos |

## 4. Inventario de datos dependientes (conteos, sin PII)

Consultado el 2026-08-13 vía conexión de solo lectura (contenedor efímero
en la red Docker, nunca el archivo `.env`):

| Tabla | Total filas | Detalle |
|---|---|---|
| `booking_request_records` | 1 | `status=resolved` (terminal, preexistente a esta sesión), `identity_fingerprint_key_version=v1` |
| `pending_guest_identities` | 0 | — |
| `pending_authenticated_contact_details` | 0 | — |
| `booking_review_records` | 0 | — |
| `booking_outbox_jobs` | 0 | — |

**Conclusión de gravedad**: no hay PII real cifrada con la clave expuesta
en este momento — las dos tablas que la usarían están vacías. El único
registro existente ya está en estado terminal (`resolved`), sin tokens de
acceso de invitado que deban conservarse vivos. Esto reduce
significativamente la urgencia operativa de una migración de datos (no
hay nada que recifrar hoy), pero **no elimina la obligación de rotar** —
los secretos siguen expuestos en el transcript independientemente de
cuántos datos dependan de ellos hoy.

## 5. Herramienta de rotación — escrita y probada (ensayo efímero)

- `apps/web/src/server/crypto/fieldCrypto.ts` — añadido
  `encryptFieldWithVersion(plaintext, keyVersion)` (no disruptivo;
  `encryptField` pasa a ser el caso especial "usar la versión activa").
- `apps/web/src/server/booking/fieldEncryptionRotation.ts` — nuevo:
  `rotatePendingGuestIdentities`, `rotatePendingAuthenticatedContactDetails`,
  `countRowsStillOnVersion`. Recifrado fila a fila, campo a campo,
  transaccional (`SELECT ... FOR UPDATE`), idempotente y reanudable (un
  campo ya migrado a la versión destino se deja intacto en una
  re-ejecución), `dry-run` sin persistir cambios, sin registrar PII ni
  ciphertext.
- `apps/web/tests/integration/fieldEncryptionRotation.int.test.ts` — 9
  pruebas contra la base efímera de integración (`gapssa_booking_test_*`,
  nunca la real): recifrado completo con verificación de plaintext
  idéntico, idempotencia, reanudación tras una interrupción simulada a
  mitad de fila, `dry-run`, ambas tablas dependientes, `countRowsStillOnVersion`,
  fila ya en la versión destino, y rechazo con `FieldCryptoError` (nunca
  éxito silencioso) ante una versión de clave desconocida. **9/9 en
  verde.**

Esta herramienta **no se ejecutó contra ningún dato real** en esta sesión
— la base real tiene cero filas dependientes hoy, así que ejecutarla ahí
sería un no-op seguro, pero esa ejecución queda para la puerta S7 del plan
de rotación, fuera del harness.

## 6. Por qué este documento se considera *superseded* y no *cerrado*

Mientras se preparaba la rotación (añadir versiones `v2` a
`BOOKING_FIELD_ENCRYPTION_KEYS` y `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS`
en `.env`, paso previo necesario para poder probar la migración con datos
sintéticos), la edición del archivo disparó el incidente descrito en
`docs/incidente-exposicion-env-completo-2026-08-13.md` — las propias `v2`
quedaron expuestas antes de activarse nunca. Por eso este documento no se
da por cerrado: la auditoría y la herramienta (§3, §5) son reutilizables
tal cual, pero la rotación real queda pendiente de ejecutarse fuera del
harness con versiones `v3`, nunca las `v2` de esta sesión.

## 7. Estado de 5B-2B

No reanudada. Cuenta ficticia conservada (activa, sesión revocada). ACL
nunca abierta. Cero `Contact`/`Meeting` creados.
