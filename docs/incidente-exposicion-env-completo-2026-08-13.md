# Incidente — exposición completa de `.env` por notificación automática del harness (2026-08-13)

**Este documento no contiene ningún valor secreto, fragmento, prefijo,
sufijo, hash de secreto ni captura del mensaje que causó la exposición.**

## 1. Qué ocurrió

Durante la contención del incidente de secretos de `booking`
(`docs/incidente-booking-secrets-local-2026-08-13.md`), se editó `.env`
mediante un script de Claude Code para añadir versiones nuevas (`v2`) a
dos secretos versionados, como parte de la preparación de su rotación.

Esa edición disparó una **notificación automática del harness** (un
mecanismo del propio Claude Code que informa cuando un archivo cambia,
pensado como cortesía de contexto) que incluyó **el contenido íntegro del
archivo `.env` resultante** en la conversación — no un diff acotado a las
líneas cambiadas, el archivo completo.

**Ningún comando ejecutado por el agente causó esta exposición
directamente** — a diferencia de los dos incidentes anteriores de esta
misma sesión (`grep`/`sed` mal acotados sobre archivos de secretos), esta
vez la causa fue una edición de archivo legítima y autorizada seguida de
un efecto secundario estructural del propio harness.

## 2. Alcance de la exposición

**Todo lo que estaba en `.env` en el instante de la notificación** —
tratado como comprometido en su totalidad, sin excepciones:

1. PostgreSQL: `POSTGRES_PASSWORD`, `DATABASE_URL_AUTH`,
   `DATABASE_URL_BOOKING`, `DATABASE_URL_CMS`.
2. EspoCRM/MariaDB: `ESPOCRM_ADMIN_PASSWORD`, `ESPOCRM_DB_PASSWORD`,
   `ESPOCRM_DB_ROOT_PASSWORD`, `ESPOCRM_API_KEY`.
3. Redis: `REDIS_PASSWORD`, `REDIS_URL`.
4. Payload: `PAYLOAD_SECRET`.
5. Auth: `OTP_HMAC_SECRET`, `AUTH_RATE_LIMIT_HMAC_SECRET`.
6. Booking: los cinco secretos ya documentados en el incidente anterior —
   incluidas las versiones `v2` recién añadidas, **expuestas antes de
   activarse nunca para escritura**.

**Fuera de este alcance** (archivos distintos, no editados ni notificados
en esta sesión): las credenciales de `integrations/n8n/.env` y
`infra/facturascripts/.env`, y las credenciales de Google OAuth de la
extensión Google Calendar Sync (viven en `data/config-internal.php` dentro
del contenedor `espocrm`, un dominio de configuración completamente
separado del `.env` de `apps/web`).

## 3. Causa estructural

No fue un error de comando de inspección — fue el propio harness
informando de una edición de archivo legítima. La mitigación correcta no
es "usar comandos más seguros" (ya se había reforzado esa disciplina tras
el incidente anterior); es **nunca permitir que un agente edite el
archivo que contiene los secretos reales**. Ver
`docs/plan-rotacion-secretos-gapssa-2026-08-13.md` §2 para el diseño del
almacén externo que sustituye a `.env` como fuente de verdad para
cualquier sesión futura de Claude Code sobre este proyecto.

## 4. Estado de 5B-2B / datos

- Ningún `BookingRequestRecord`, `Contact` ni `Meeting` creado por 5B-2B
  en ningún momento de esta sesión (el único `BookingRequestRecord`
  existente en `gapssa_booking` es una fila `resolved` de antes de esta
  sesión, sin relación).
- La ventana ACL de `cExcluirGoogleCalendarSync` **nunca se abrió** —
  permaneció `read=yes/edit=no` durante toda la sesión.
- La cuenta ficticia de prueba (registro/OTP/login reales) sigue existiendo
  y activa — no se eliminó, per instrucción explícita de conservarla para
  inspección o para reanudar 5B-2B en el futuro si se decide.
- **5B-2B no se reanuda en esta sesión.**

## 5. Contención ejecutada en esta sesión

1. Confirmado (mediante estado ya establecido antes de este incidente,
   sin releer `.env`): ACL cerrada, cero `BookingRequestRecord`/`Contact`/
   `Meeting` de 5B-2B, ventana ACL nunca abierta.
2. Proceso Next.js aislado de 5B-2B y mailbox SMTP efímero: ya estaban
   detenidos (contención del incidente anterior) — confirmado de nuevo
   (puertos libres).
3. Sesión de la cuenta ficticia: ya revocada (logout real) en la
   contención del incidente anterior.
4. Artefactos temporales no sensibles ya eliminados: `NEXT_DIST_DIR`
   temporal, cookies temporales, referencias al `runId`, archivos de
   respuesta.
5. Proceso principal de `apps/web` (PID raíz, árbol completo): detenido
   con `SIGTERM`, salida limpia confirmada, puerto `3000` liberado.
6. Todos los servicios Docker del proyecto GAPSSA: detenidos con
   `docker compose stop` (nunca `down -v`) — `docker compose ps` confirma
   cero contenedores en ejecución; todos los volúmenes (`apps-db-data`,
   `espocrm-data`, `espocrm-db`, `espocrm-custom`,
   `espocrm-client-custom`, `redis-data`, y los de `n8n`/`facturascripts`)
   confirmados intactos.
7. Proyectos ajenos al compose de GAPSSA (`suitecrm_app`, `suitecrm_db`,
   cualquier otro proyecto en la misma máquina): no tocados.

## 6. Preparación entregada (sin ejecutar)

- `docs/plan-rotacion-secretos-gapssa-2026-08-13.md` — inventario completo
  por nombre de variable (consumidor, almacenamiento, efecto de rotación,
  soporte de versiones) construido exclusivamente desde `.env.example` y
  código fuente, nunca desde el `.env` real; matriz de rotación en nueve
  puertas independientes (S1–S9); diseño del almacén externo de secretos.
- `docs/runbook-rotacion-secretos-externa.md` — instrucciones paso a paso
  para que el operador ejecute la rotación real desde una terminal fuera
  de Claude Code, puerta por puerta, sin volver a exponer ningún valor en
  una conversación de agente.
- `scripts/secrets-rotation/` — herramientas sin secretos, no ejecutadas
  contra ningún valor real en esta sesión:
  - `lib.sh`: guardas de seguridad (ruta fuera del workspace, confirmación
    interactiva explícita, verificación de permisos `700`/`600`).
  - `01-init-external-store.sh`: crea el directorio externo.
  - `02-generate-secret.sh`: genera un secreto CSPRNG y lo escribe
    directamente en el archivo externo indicado, sin imprimirlo nunca.
  - `lib.test.sh`: 9/9 pruebas en verde (guardas de ruta y permisos,
    contra directorios temporales desechables — nunca contra secretos
    reales). Ejecutadas en esta sesión.
- `apps/web/src/server/booking/fieldEncryptionRotation.ts` +
  `apps/web/tests/integration/fieldEncryptionRotation.int.test.ts` —
  módulo de recifrado versionado para `BOOKING_FIELD_ENCRYPTION_KEYS`,
  escrito y probado contra la base efímera de integración (9 pruebas en
  verde: recifrado completo, idempotencia, reanudación tras interrupción
  simulada, `dry-run`, ambas tablas dependientes, conteo por versión,
  clave desconocida → error claro). No ejecutado contra ningún dato real.
- `apps/web/src/server/crypto/fieldCrypto.ts` — adición no disruptiva de
  `encryptFieldWithVersion` (además de la `encryptField` ya existente),
  necesaria para que la migración pueda cifrar con la versión destino sin
  depender de cuál sea la versión activa en el momento de ejecutar.

## 7. Qué NO se hizo en esta sesión (deliberadamente)

- No se generó, escribió ni activó ningún secreto nuevo real.
- No se volvió a editar `.env`.
- No se ejecutó ningún script de `scripts/secrets-rotation/` contra un
  destino real (solo sus pruebas, contra directorios temporales
  desechables).
- No se ejecutó la migración de `fieldEncryptionRotation.ts` contra
  `gapssa_booking` real (solo contra la base efímera de pruebas).
- No se hizo ningún commit.

## 8. Medidas preventivas (adicionales a las del incidente anterior)

- **Ningún secreto real vuelve a vivir dentro del workspace** — ver el
  almacén externo diseñado en
  `docs/plan-rotacion-secretos-gapssa-2026-08-13.md` §2. Esta es la
  mitigación estructural que sustituye a "tener más cuidado al editar
  `.env`": el problema no era el cuidado, era la ubicación del archivo.
- Cualquier necesidad futura de que un agente lea configuración no
  sensible debe pasar por `.env.example` (placeholders) o por consultas
  específicas ya diseñadas para no exponer valores (nombres de variable,
  booleanos, conteos) — nunca por abrir el archivo de secretos real,
  aunque sea "solo para editarlo".
- Antes de autorizar cualquier edición futura de un archivo que pueda
  contener secretos, confirmar explícitamente si el harness en uso genera
  notificaciones de cambio de archivo con contenido completo, y si es así,
  tratar ese archivo como "no editable desde una sesión de agente" sin
  excepción.

## 9. Supersede a los incidentes anteriores

Este documento **no reemplaza**, pero sí **actualiza el estado de cierre**
de:

- `docs/incidente-postgres-password-local-2026-08-13.md` — su rotación
  quedó ella misma expuesta por este incidente; su cierre queda marcado
  como *superseded*, pendiente de la puerta **S2** de
  `docs/plan-rotacion-secretos-gapssa-2026-08-13.md`.
- `docs/incidente-booking-secrets-local-2026-08-13.md` — su contención
  (auditoría de código, ensayo efímero, herramienta de migración) sigue
  siendo válida y reutilizable, pero las versiones `v2` que preparó
  también quedaron expuestas; su cierre queda marcado como *superseded*,
  pendiente de la puerta **S7**.

Ningún historial se ha borrado — ambos documentos permanecen íntegros,
con una nota añadida señalando esta supersesión.

---

**NO ES SEGURO REANUDAR 5B-2B HASTA COMPLETAR LA ROTACIÓN GLOBAL FUERA DEL
HARNESS** (puertas S1–S9 de `docs/plan-rotacion-secretos-gapssa-2026-08-13.md`,
ejecutadas siguiendo `docs/runbook-rotacion-secretos-externa.md`).

> **Nota de estado (2026-08-14).** Rotación global S1–S9 pendiente de
> ejecución manual externa. Los servicios permanecen detenidos por
> contención. No existe todavía informe sanitizado.
