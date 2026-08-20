# Puerta 5 — v1: propuesta operativa (Puerta 5A, directa contra EspoCRM real)

> **SUPERADO por `docs/fase4b-puerta5-propuesta-v2.md`.** V1 contenía un
> error de conteo de idempotencia (afirmaba 5 filas; el análisis línea a
> línea de `PutDecide.php` da 3), una suposición incorrecta sobre el
> formato de `idempotency_key_reused` (JSON; es texto plano), una línea
> base desactualizada de `maintenanceMode` (`false`; el cierre real de la
> Puerta 4 lo deja en `NULL`), y proponía crear los fixtures desde la UI
> (no reproducible, sin payload exacto). No usar este documento como
> referencia operativa — queda solo como historial de la primera
> iteración. Ver v2 para la propuesta vigente.

**Nada de esto está ejecutado.** Este documento es exclusivamente la
propuesta pedida — no se ha tocado EspoCRM, `data/config.php`, ningún
`Meeting`, la tabla `gapssa_meeting_decision_operation`, ni
`ESPO_BOOKING_ADAPTER` en ningún entorno. Sin commits.

## 0. Alcance de este documento y nota de estado de partida

La Puerta 4 queda aceptada como completada por instrucción explícita.
Este documento la toma como hecho consumado, pero necesita señalar una
discrepancia documental: el último registro escrito
(`docs/fase4b-puerta4-propuesta-v4.md`, cierre) deja la Puerta 4
**"a la espera de... una nueva autorización explícita, por separado, para
la primera fase real de la Puerta 4"** — es decir, el propio repositorio
no contiene, a fecha de este documento, la evidencia escrita de que el
campo `cMotivoResolucionReserva`, la tabla `install.sql`, el código
servidor, `routes.json`, el ACL de campo y las dos listas blancas de
autorización llegaron a desplegarse contra `gapssa-espocrm-1` real.

**No se resuelve aquí adivinando** — se resuelve convirtiendo esa
verificación en el primer paso, de solo lectura, de la Puerta 5 (§1.1).
Si algo de lo que la Puerta 4 debía dejar en la instancia real no está
donde se espera, esa es, por definición, una condición de parada (§11) y
la Puerta 5 no continúa hasta aclararlo contigo.

Este documento cubre **exclusivamente la Puerta 5A** (inspección visual +
primera prueba directa de `PutDecide` contra EspoCRM real, vía
`portal-gapssa-api`). La Puerta 5B (BFF → `HttpEspoBookingAdapter` →
EspoCRM real, con `ESPO_BOOKING_ADAPTER=http`) se diseña en §10 como
subpuerta separada, con su propia propuesta y aprobación — no se ejecuta,
ni se detalla operativamente, en este documento.

---

## 1. Precondiciones

### 1.1 Verificación de línea base (solo lectura, antes de cualquier otra cosa)

| # | Comprobación | Método | Resultado esperado |
|---|---|---|---|
| 1 | `app-check` | `docker compose exec espocrm bin/command app-check` | Verde, sin errores |
| 2 | `maintenanceMode` | Lectura de `data/config.php` (`docker compose exec -T espocrm sh -lc 'grep -A1 maintenanceMode data/config.php'`) | `false` |
| 3 | `gapssaBookingDecisionEnabled` | Misma lectura | **`false`** (booleano, no ausente — v4 §5: la Puerta 4 lo deja escrito explícitamente) |
| 4 | `ESPO_BOOKING_ADAPTER` (todos los entornos de `apps/web` que puedan tocar la instancia real) | Lectura de `.env`/`.env.local`/secretos de despliegue | `simulated` en todos |
| 5 | `gapssa_meeting_decision_operation` | `SELECT COUNT(*) FROM gapssa_meeting_decision_operation;` | `0` |
| 6 | `Meeting` totales (línea base declarada) | `SELECT COUNT(*) FROM meeting WHERE deleted = 0;` | **10** (valor que aportas — se reconfirma aquí, no se asume) |
| 7 | `cMotivoResolucionReserva` de los 10 | `SELECT COUNT(*) FROM meeting WHERE deleted = 0 AND c_motivo_resolucion_reserva IS NOT NULL;` | `0` (los 10 con el campo `NULL`) |
| 8 | `gcs_event_link` totales | `SELECT COUNT(*) FROM gcs_event_link;` | **4** (valor que aportas — se reconfirma) |
| 9 | Hashes de los 6 archivos de metadata (Puerta 4, v3 §6) | `sha256sum` sobre los archivos vivos del contenedor | Coinciden con el manifiesto v2/v3/v4 (código ya desplegado, sin desviación) |
| 10 | ACL de campo `cMotivoResolucionReserva` sobre `Profesional Gapssa` / `Portal GAPSSA API` | `SELECT field_data FROM role WHERE id IN (...)` (mismo query que v3 §3) | `Profesional Gapssa` → `no/no`; `Portal GAPSSA API` → `yes/yes` |
| 11 | `gapssaBookingDecisionAuthorizedApiUserIds` | Lectura de `data/config.php` | Contiene únicamente el id real de `portal-gapssa-api` (`6a7b345b2624dbb56` según v4 §... — **a confirmar, no asumir el valor por el nombre**) |
| 12 | `gapssaBookingDecisionAuthorizedUserIds` | Lectura de `data/config.php` | Vacía (V1, sin profesionales humanos autorizados) — a confirmar |
| 13 | `routes.json` publica `PUT /api/v1/GapssaMeetingDecision/{id}` | `curl` sin credenciales válidas contra la ruta (espera 401, no 404) | 401, nunca 404 (404 indicaría que la ruta no está publicada, contradiciendo "Puerta 4 completada") |

**Si cualquiera de 1–13 no coincide con lo esperado: parar aquí.** No se
avanza a §2 sin que estos 13 puntos estén verificados y, si hay
discrepancias, resueltas contigo explícitamente.

### 1.2 Precondiciones organizativas (no técnicas)

- Ventana de trabajo con baja actividad real del centro (para minimizar
  la probabilidad, ya de por sí acotada por scope, de que un `Meeting`
  real entre en `PendingCenterApproval` durante la prueba).
- Acceso confirmado a: sesión administrativa EspoCRM ya existente (para
  §2), credencial de `portal-gapssa-api` (para §5/§6, nunca su contraseña
  ni ninguna credencial nueva), acceso de solo lectura a MariaDB.
- Este documento, revisado y aprobado explícitamente, **antes** de tocar
  nada de §4 en adelante.

---

## 2. Inspección visual segura (flag en `false` durante toda esta fase)

- **La realizas tú**, con tu sesión administrativa ya existente en
  EspoCRM. No se te pedirá, mostrará ni cambiará ninguna contraseña en
  ningún momento de la Puerta 5.
- Objetivo: confirmar visualmente, contra la instancia real, que la
  Puerta 4 dejó lo que dice haber dejado — sin ejercitar ningún efecto.
- Qué revisar, sin pulsar nada que decida:
  1. Abrir un `Meeting` real cualquiera en `PendingCenterApproval` (si
     existe alguno entre los 10 de línea base) o, si no hay ninguno, un
     `Meeting` en cualquier estado — el objetivo es la UI, no un caso de
     negocio concreto todavía.
  2. Verificar que los botones "Aprobar reserva"/"Rechazar reserva" (o el
     nombre exacto que tenga la acción cliente añadida por
     `clientDefs/Meeting.json`) **existen y son visibles** para tu rol.
  3. Verificar que el modal de decisión se abre correctamente: campos
     esperados (motivo/nota), textos, validación visual de campos
     obligatorios (p. ej. nota obligatoria en rechazo) — sin enviarlo.
  4. Abrir la consola del navegador (DevTools) y confirmar: sin errores
     de JavaScript al cargar la vista de `Meeting`, sin errores al abrir
     el modal, sin peticiones de red inesperadas disparadas solo por
     abrir el modal (ninguna petición `PUT` debería salir hasta pulsar
     confirmar).
  5. Cerrar el modal sin confirmar. **No pulsar Aprobar ni Rechazar en
     ningún momento de esta fase.**
- El flag permanece en `false` durante toda esta fase — aunque pulsaras
  un botón por error, `PutDecide` respondería `503
  meeting_decision_disabled` sin tocar nada (verificado empíricamente en
  la Puerta 4, v4 §3.3/§3.4) — pero el procedimiento pide explícitamente
  no pulsar, no depender de esa red de seguridad para validar la UI.
- Qué reporto yo, a partir de lo que tú observes y me describas (yo no
  tengo ni pediré acceso a tu sesión): confirmación punto por punto de 1–5
  o la discrepancia exacta encontrada.

**Salida de esta fase**: confirmación tuya, explícita, de que los 5
puntos anteriores están correctos. Sin esa confirmación, no se pasa a §3.

---

## 3. Fixtures de prueba

### 3.1 Decisión: dos Meetings separados

Se adopta la recomendación: **un `Meeting [PRUEBA]` para el escenario de
aprobación y otro distinto para el de rechazo**. Motivo: cada escenario
debe partir de un estado limpio (`PendingCenterApproval`,
`cMotivoResolucionReserva=NULL`) y terminar en un estado final distinto
(`Confirmed`/`Approved` vs. `Canceled`/`RejectedByStaff`); reutilizar el
mismo `Meeting` para ambos exigiría revertir su estado entre pruebas —
una escritura extra, evitable, y un riesgo de que un revert manual quede
mal hecho.

### 3.2 Nombres e identificación

| Fixture | `name` propuesto | Uso |
|---|---|---|
| A | `[PRUEBA PUERTA5] Aprobación — no contactar` | Escenario de aprobación (§5) |
| B | `[PRUEBA PUERTA5] Rechazo — no contactar` | Escenario de rechazo (§6) |

Prefijo `[PRUEBA PUERTA5]` (distinto del `[PRUEBA]` genérico usado en
ensayos desechables anteriores) para que cualquier búsqueda/filtro futuro
identifique exactamente qué puerta los creó, sin ambigüedad con otros
ensayos.

### 3.3 Sin PII real

- **Contacto**: ninguno de los dos `Meeting` de prueba se vincula a un
  `Contact` real. Si `Meeting` exige un contacto para guardarse, se crea
  un `Contact` de prueba dedicado (`[PRUEBA PUERTA5] Contacto ficticio`,
  sin email/teléfono real — usar un dominio no resoluble tipo
  `prueba.invalido` si el campo es obligatorio) — **nunca reutilizar un
  contacto real existente**, ni siquiera uno inactivo.
- **Tratamiento (`cTratamiento`) / Zona (`cZonaAtencion`)**: usar valores
  ya existentes en el catálogo que sean genéricamente inocuos (p. ej. el
  tratamiento/zona de menor impacto operativo, a decidir contigo en el
  momento — no se inventa un tratamiento nuevo solo para la prueba, eso
  sería una escritura de catálogo adicional innecesaria).
- **Profesional/`assignedUser`**: punto sensible por la interacción con
  Google Calendar Sync (§3.4) — ver ahí la recomendación concreta.
- **Horario**: en el pasado inmediato o en un hueco claramente fuera de
  horario de apertura real, para que estos dos `Meeting` de prueba nunca
  compitan por disponibilidad con una reserva real ni aparezcan como
  "próxima cita" en ninguna vista operativa.

### 3.4 Interacción esperada con Google Calendar Sync

Google Calendar Sync sincroniza `Meeting` reales contra el calendario de
Google del usuario asignado (`assignedUser`) cuando ese usuario tiene una
cuenta `gcs_account` activa y sincronización habilitada. Si los dos
`Meeting` de prueba se asignan a un profesional real con sync activo,
**cada creación y cada actualización de `cEstadoReserva` generará tráfico
real hacia Google Calendar** (evento nuevo, luego evento actualizado)
contra una cuenta de Google real — efecto que excede el alcance mínimo de
esta puerta.

**Recomendación**: asignar ambos `Meeting` de prueba al propio usuario
`admin` (o a un usuario técnico sin `gcs_account` configurada) — sin
sincronización activa, `gcs_event_link` permanece en el valor de línea
base (**4**, sin cambios) durante toda la Puerta 5A. Esto es
deliberadamente conservador: no se ejercita la interacción real con
Google Calendar en esta primera puerta. Si más adelante se quiere validar
esa interacción específica, debe ser un escenario aparte, explícitamente
autorizado, con un profesional de prueba dedicado (no uno real) y
contigo al tanto de que aparecerá un evento real en un calendario de
Google.

Si decides lo contrario (asignar a un profesional real para probar la
interacción), esa es tu decisión a tomar explícitamente antes de §4 — no
se asume aquí.

### 3.5 Estado inicial exacto

Ambos `Meeting` de prueba, inmediatamente tras crearse:

| Campo | Valor |
|---|---|
| `cEstadoReserva` | `PendingCenterApproval` |
| `status` (nativo) | El valor que `SyncEstadoReservaToStatus` mapea para `PendingCenterApproval` (`EstadoReservaStatusMap.php` — a confirmar el valor exacto en el momento, sin asumirlo aquí) |
| `cMotivoResolucionReserva` | `NULL` |
| `cBookingRequestId` | `NULL` (no vienen de una solicitud real del portal) |

### 3.6 Quién los crea y con qué mecanismo

- **Los crea el admin real**, desde la interfaz nativa de EspoCRM (misma
  sesión de §2) o vía la API estándar de EspoCRM autenticada con la API
  Key de `portal-gapssa-api` — a decidir contigo cuál de las dos prefieres
  (la UI dnativa es más lenta pero más verificable visualmente en el
  momento; la API es más rápida y deja un payload exacto para el
  manifiesto). **Recomiendo la UI nativa** para este primer par de
  fixtures — es la misma vía por la que se creará cualquier `Meeting`
  real, y permite verificar visualmente el estado inicial antes de seguir.
- Ninguno de los dos `Meeting` se crea con un estado distinto de
  `PendingCenterApproval` en ningún momento intermedio — si la UI de
  EspoCRM no permite crear directamente en ese estado, se crea en el
  estado por defecto y se transiciona con un `PUT` genérico ANTES de que
  `gapssaBookingDecisionEnabled` pase a `true` (para que ese `PUT` no
  compita con `PutDecide` bajo ninguna circunstancia).

### 3.7 Registro de IDs

Al terminar §3, se registran aquí (en la entrega final, no en este
borrador) únicamente: `Meeting.id` de A y B, y el `Contact.id` de prueba
si se creó uno — ningún otro dato de los fixtures se expone en el
documento de cierre.

---

## 4. Activación controlada del flag

Mismo mecanismo que la Puerta 4 (v3 §4, `ConfigWriter` nativo) — pero
**mucho más simple**: un único valor booleano, sin metadata, sin ACL, sin
`rebuild`, sin `maintenanceMode` (el motivo de `maintenanceMode` en la
Puerta 4 era cerrar el acceso general durante una ventana con metadata/ACL
en un estado intermedio potencialmente inconsistente — aquí no existe esa
ventana: `ConfigWriter::save()` sobre un único valor es una operación
atómica de fichero, no hay estado intermedio que proteger).

### 4.1 Procedimiento

1. **Backup de `data/config.php`**: copia del archivo vivo del
   contenedor (`docker compose exec -T espocrm sh -lc 'cp data/config.php data/config.php.bak-puerta5-<timestamp>'`) — mismo patrón que v3 §6, nunca una reconstrucción.
2. Registrar hash SHA-256 y tamaño del `config.php` actual (antes de
   tocar nada) como línea base.
3. `ConfigWriter->set('gapssaBookingDecisionEnabled', true)->save()` —
   único campo tocado.
4. `php -l data/config.php` inmediatamente después — sin errores de
   sintaxis.
5. `diff` estructural contra el backup del paso 1: **debe mostrar
   exactamente una línea cambiada** (`gapssaBookingDecisionEnabled`,
   `false` → `true`) — cualquier otra diferencia es una condición de
   parada (§11).
6. Registrar la hora exacta (UTC) de apertura.
7. Confirmar por lectura directa (`grep gapssaBookingDecisionEnabled data/config.php`, no confiar en la respuesta cacheada de ningún proceso) que el valor en disco es `true`.

### 4.2 Ventana temporal

- Ventana mínima: desde el paso 4.1.7 hasta el cierre (§4.3), el tiempo
  estrictamente necesario para ejecutar §5, §6 y §7 en secuencia — sin
  pausas para revisión intermedia con el flag abierto. Cualquier pausa
  necesaria (p. ej. para que revises un resultado) ocurre con el flag ya
  vuelto a `false` (ver §4.3 "en éxito").
- Estimación operativa: los 3 bloques de pruebas (§5/§6/§7) están
  diseñados para ejecutarse en una sola sesión continua, sin intervención
  manual entre llamadas — minutos, no horas.

### 4.3 Cierre garantizado del flag — éxito y error

- **En éxito** (§5, §6 y §7 completados según lo esperado): paso 8 del
  procedimiento, ejecutado como parte del mismo guion, sin esperar a
  ninguna revisión adicional:
  1. `ConfigWriter->set('gapssaBookingDecisionEnabled', false)->save()`.
  2. `php -l` + lectura directa del valor en disco: `false`.
  3. Registrar hora exacta de cierre.
- **En error** (cualquier condición de parada de §11 activada durante
  §5/§6/§7): el mismo procedimiento de cierre se ejecuta **inmediatamente**,
  antes de investigar la causa del error — nunca se deja el flag en
  `true` "para depurar con calma". Si el propio cierre fallara (caso
  límite, no se espera), el procedimiento de emergencia es restaurar el
  backup exacto del paso 4.1.1 (`cp data/config.php.bak-puerta5-<ts>
  data/config.php`), con la misma verificación de `php -l` + lectura
  directa.
- **Regla explícita, sin excepción**: `gapssaBookingDecisionEnabled` nunca
  queda en `true` mientras se espera una nueva aprobación tuya o una
  intervención manual — si algo se detiene a mitad de camino, se detiene
  con el flag ya en `false`.

---

## 5. Prueba de aprobación (Meeting A)

- **Vía exclusiva**: llamada HTTP directa a EspoCRM real autenticada con
  la API Key de `portal-gapssa-api` (`X-Api-Key`, la credencial ya
  existente — nunca una nueva, nunca mostrada en este documento ni en la
  entrega). No se usa el BFF en esta subpuerta (§10).

### 5.1 `operationKey`

Formato propuesto: `puerta5-approval-<YYYYMMDD>-<sufijo aleatorio corto>`
— alfanumérico, sin PII, cumple el patrón exigido por `PutDecide`
(`^[A-Za-z0-9_-]+$`, ≤128 caracteres). Nueva, nunca usada antes (línea
base §1.1.5 confirma la tabla en `0` filas).

### 5.2 Payload exacto (redactado)

```
PUT /api/v1/GapssaMeetingDecision/{meetingId=<id real de A>}
X-Api-Key: <redactado>
Content-Type: application/json

{
  "decision": "Confirmed",
  "resultReason": "Approved",
  "operationKey": "puerta5-approval-<YYYYMMDD>-<sufijo>"
}
```

Sin `note` — `Approved` no la exige (`MeetingResolutionPolicy::isNoteAcceptable`, `default => true`, sin restricción propia).

### 5.3 Resultado esperado

- HTTP `200`.
- Cuerpo: `{"status":"confirmed","meetingId":"<id A>","cEstadoReserva":"Confirmed","cMotivoResolucionReserva":"Approved","meetingStatus":"<mapeo nativo de Confirmed>","modifiedById":"<id de portal-gapssa-api>","modifiedAt":"<timestamp>"}`.

### 5.4 Verificación

| Comprobación | Método |
|---|---|
| `cEstadoReserva` | Releer el `Meeting` vía `GET /api/v1/Meeting/{id}` (o UI) — debe ser `Confirmed` |
| `status` nativo | Igual, coincide con el mapeo de `EstadoReservaStatusMap` |
| `cMotivoResolucionReserva` | `Approved` |
| `modifiedById` | El id real de `portal-gapssa-api`, no `admin` |
| Auditoría | `Meeting.modifiedAt` avanzó; si EspoCRM tiene stream/log de auditoría de campo habilitado sobre `Meeting`, confirmar entrada nueva coherente |
| Idempotencia | `SELECT * FROM gapssa_meeting_decision_operation WHERE operation_key = '<key>';` — **exactamente 1 fila**, `result_status='confirmed'`, `result_http_status=200` |

### 5.5 Replay (misma `operationKey`, mismo payload)

- Repetir exactamente la misma llamada (5.2) una segunda vez.
- Esperado: HTTP `200`, **cuerpo idéntico byte a byte** al de 5.3
  (incluido el mismo `modifiedAt` — no se re-ejecuta nada, se devuelve el
  resultado ya confirmado, código en `PutDecide::replayResponse`).
- Verificación: `gapssa_meeting_decision_operation` **sigue en 1 fila**
  para esa clave (sin duplicado); `Meeting.modifiedAt` **sin cambios**
  respecto a 5.4 (confirma que el replay no volvió a escribir).

---

## 6. Prueba de rechazo (Meeting B — distinto del A)

### 6.1 `operationKey`

`puerta5-rejection-<YYYYMMDD>-<sufijo aleatorio corto>` — nueva, distinta
de la de §5.

### 6.2 Nota/motivo de prueba

Nota humana no vacía, sin PII, motivo operativo genérico y plausible —
propuesta: `"Prueba operativa Puerta 5 — sin relación con un caso real."`
(cumple `trim(note) !== ''`, exigido por `RejectedByStaff`).

### 6.3 Payload exacto (redactado)

```
PUT /api/v1/GapssaMeetingDecision/{meetingId=<id real de B>}
X-Api-Key: <redactado>
Content-Type: application/json

{
  "decision": "Canceled",
  "resultReason": "RejectedByStaff",
  "note": "Prueba operativa Puerta 5 — sin relación con un caso real.",
  "operationKey": "puerta5-rejection-<YYYYMMDD>-<sufijo>"
}
```

### 6.4 Resultado esperado

- HTTP `200`.
- `cEstadoReserva=Canceled`, `cMotivoResolucionReserva=RejectedByStaff`,
  `description` (nota) con el texto exacto de 6.2.

### 6.5 Verificación

Misma tabla que §5.4, adaptada: `cEstadoReserva=Canceled`,
`cMotivoResolucionReserva=RejectedByStaff`, nota persistida y releída
independientemente (no solo confiando en la respuesta del `PUT`),
`modifiedById` = `portal-gapssa-api`, 1 fila de idempotencia para esta
clave.

### 6.6 Replay idempotente

Igual que §5.5: misma clave, mismo payload, segunda llamada → mismo
cuerpo exacto, sin fila nueva, sin cambio en `Meeting`.

---

## 7. Pruebas negativas mínimas

**Sin pruebas destructivas ni carreras masivas contra la instancia real**
— los dos casos siguientes son deterministas, de una sola llamada cada
uno, sin concurrencia genuina (la concurrencia real contra EspoCRM ya se
probó exhaustivamente en la Puerta 4, v4 §3.6 y `fase4b-decision-flow-final.md` §9 escenario 7, contra una instancia desechable — no hace falta repetirla contra la real).

### 7.1 `operationKey` repetida con payload incompatible → 409

- Reutilizar la clave de §5 (`puerta5-approval-...`), ya usada para el
  Meeting A con `Confirmed`/`Approved`.
- Nueva llamada, misma clave, payload distinto (p. ej. mismo `meetingId`
  A, pero `decision=Canceled`, `resultReason=RejectedByStaff`, con nota).
- Esperado: HTTP `409`, `{"reason":"idempotency_key_reused", ...}` (código
  contractual `idempotency_key_reused` de `PutDecide::runWithinTransaction`, línea del `Conflict::createWithBody`).
- Verificación: `Meeting A` **sin cambios** respecto a §5.4 (sigue
  `Confirmed`/`Approved`); `gapssa_meeting_decision_operation` **sin fila
  nueva** para esta clave (el 409 se lanza antes de cualquier
  `persistIdempotentResult` — ver código, línea 323-329).

### 7.2 Decidir de nuevo un Meeting ya resuelto → 409 compatible con el contrato

- Nueva `operationKey` (nunca usada), mismo `meetingId` A (ya
  `Confirmed`), payload cualquiera válido en forma (p. ej.
  `decision=Canceled`, `resultReason=RejectedByStaff`, nota).
- Esperado: HTTP `409`, `{"status":"conflict","reason":"meeting_decision_conflict","meetingId":"<A>","existingCEstadoReserva":"Confirmed"}` (`PutDecide::recordAndRespondConflict`).
- Verificación: `Meeting A` sin cambios; **esta vez sí se espera 1 fila
  nueva** en `gapssa_meeting_decision_operation` para esta segunda clave
  (con `result_status='conflict'`, `result_http_status=409`) — a
  diferencia de 7.1, aquí el código sí registra el conflicto antes de
  responder (`recordAndRespondConflict` llama a `persistIdempotentResult`).

---

## 8. Cierre obligatorio

Orden estricto, cada paso depende del anterior:

1. `gapssaBookingDecisionEnabled=false` — ya ejecutado como parte de §4.3
   "en éxito" (o "en error"), **antes** de cualquier paso de este bloque.
2. Confirmar por lectura directa que está estrictamente en `false` (no
   ausente, no `"false"` string — el booleano exacto).
3. `app-check` — verde.
4. Confirmar que ningún `Meeting` real (de los 10 de línea base, ninguno
   con prefijo `[PRUEBA PUERTA5]`) fue afectado:
   `SELECT id, c_estado_reserva, c_motivo_resolucion_reserva, modified_at FROM meeting WHERE deleted = 0 AND name NOT LIKE '[PRUEBA PUERTA5]%';`
   — comparar contra la línea base de §1.1.6/§1.1.7, fila por fila.
5. Conteo esperado de `gapssa_meeting_decision_operation`: **5 filas**
   exactamente (§5.4 aprobación + §6.5 rechazo + §7.2 conflicto de
   re-decisión; §5.5/§6.6 son replays, no añaden filas; §7.1 tampoco
   añade fila — ver su verificación). Si el conteo difiere, condición de
   parada.
6. Compatibilidad GCS, comprobación no destructiva:
   `SELECT COUNT(*) FROM gcs_event_link;` — debe seguir en **4** (si se
   siguió la recomendación de §3.4 de asignar los fixtures a un usuario
   sin `gcs_account`). Si decidiste la alternativa de §3.4 (profesional
   real), el conteo esperado se ajusta antes de ejecutar — no se define
   aquí un número que no corresponda a la decisión tomada.
7. `Meeting` totales tras la Puerta 5A: **12** (10 reales + A + B),
   `cMotivoResolucionReserva IS NOT NULL` en exactamente 2 (A y B) —
   los 10 reales siguen en `NULL`.

---

## 9. Política de limpieza (propuesta, no autorizada para ejecutar aquí)

- **Recomendación: soft-delete** de los `Meeting` A y B (`deleted=1` vía
  el mecanismo nativo de EspoCRM), no borrado físico. Motivo: EspoCRM
  soft-delete es reversible y ya excluido por defecto de la mayoría de
  listados/consultas de negocio (`deleted=0` es el filtro estándar, como
  en las queries de §1/§8 de este documento) — un `Meeting [PRUEBA]`
  soft-deleted no vuelve a aparecer en la operativa normal sin dejar de
  existir como evidencia.
- **Conservar** las filas de `gapssa_meeting_decision_operation` y
  cualquier entrada de auditoría/stream generada — son la evidencia de
  que la prueba ocurrió exactamente como se documenta aquí. No se
  proponen para borrado en ningún horizonte de esta puerta.
- **Efecto sobre conteos**: tras el soft-delete, `Meeting` totales activos
  (`deleted=0`) vuelve a **10** (igual que la línea base de §1.1.6);
  `Meeting` totales incluyendo eliminados pasa a 12, permanentemente (el
  soft-delete no revierte el conteo histórico). `gapssa_meeting_decision_operation` sigue en 5 filas, sin relación con el estado `deleted` del `Meeting` (tabla independiente, sin `ON DELETE CASCADE` ni limpieza automática).
- **No se ejecuta ninguna limpieza sin que la autorización que la cubra
  lo incluya expresamente** — ni como parte automática del cierre de §8,
  ni por iniciativa propia después. Si apruebas la Puerta 5A tal como
  aquí se describe, esa aprobación cubre §1–§8; la limpieza de §9 exige
  una frase explícita aparte en tu aprobación (p. ej. "limpia los
  fixtures A y B con soft-delete al terminar").

---

## 10. Separación de alcance — Puerta 5A vs. Puerta 5B

- **Esta propuesta (5A) valida EspoCRM + `PutDecide` directamente**, vía
  `portal-gapssa-api` llamando a EspoCRM sin pasar por `apps/web`.
- `ESPO_BOOKING_ADAPTER` permanece en `simulated` en **todos** los
  entornos durante toda la Puerta 5A — no se cambia a `http` en ningún
  punto de este documento ni de su ejecución.
- **Puerta 5B** (próxima subpuerta, propuesta aparte, no incluida aquí):
  `apps/web` con `ESPO_BOOKING_ADAPTER=http`, `ESPOCRM_API_BASE_URL` y
  `ESPOCRM_API_KEY` apuntando a la instancia real, ejercitando
  `HttpEspoBookingAdapter` (y, según se decida, el endpoint interno
  `/api/booking/v1/internal/decisions`, protegido por
  `X-Internal-Api-Secret` — ver cabecera de `route.ts`) contra un
  `BookingRequestRecord`/`Meeting` real de extremo a extremo.
- **No se mezclan** ambas subpuertas en una misma ejecución: si algo
  falla durante 5A, la causa solo puede estar en EspoCRM/`PutDecide`
  (nunca en el BFF, que no participa). Mezclar dificultaría atribuir un
  fallo a la capa correcta y complicaría el rollback (dos superficies
  cambiando a la vez: el flag de EspoCRM y el adaptador del BFF).
- La Puerta 5B solo se diseña **después** de que la 5A esté cerrada,
  revisada y aprobada como completada — mismo patrón que Puerta 4 → 5.

---

## 11. Condiciones de parada

Cualquiera de las siguientes detiene la ejecución inmediatamente y
dispara el cierre de §4.3 ("en error") si el flag ya estaba en `true`:

- Cualquier divergencia entre la línea base verificada en §1.1 y lo
  encontrado (incluidos los puntos 9–13, sobre Puerta 4).
- La inspección visual de §2 revela cualquier error (botón ausente, modal
  roto, error de consola, textos incorrectos).
- El flag no puede verificarse tras escribirlo (lectura directa no
  coincide con lo escrito) o no puede revertirse a `false` de forma
  confirmada.
- Cualquier cambio detectado en un `Meeting` **no** marcado
  `[PRUEBA PUERTA5]` durante o después de §4–§8.
- Cualquier discrepancia entre `cEstadoReserva`/`status`/
  `cMotivoResolucionReserva` y lo esperado en §5.3/§6.4.
- `modifiedById` distinto del esperado (`portal-gapssa-api`) en cualquiera
  de las escrituras de §5–§7.
- Cualquier fila de idempotencia inesperada (de más, de menos, o con
  contenido distinto del descrito en §5.4/§6.5/§7.1/§7.2).
- Cualquier efecto inesperado de Google Calendar Sync (evento creado
  cuando no se esperaba ninguno, `gcs_event_link` con un conteo distinto
  del previsto en §8.6).

---

## 12. Entrega — resumen ejecutivo

### Plan paso a paso (orden de ejecución si se aprueba)

1. §1.1 — 13 verificaciones de solo lectura (línea base).
2. §2 — inspección visual, flag en `false`.
3. §3 — creación de los 2 fixtures (`PendingCenterApproval`, sin PII).
4. §4.1 — activación del flag (backup, `ConfigWriter`, `php -l`, diff).
5. §5 — aprobación de A + replay.
6. §6 — rechazo de B + replay.
7. §7 — dos pruebas negativas (409 × 2).
8. §4.3 — cierre del flag (éxito).
9. §8 — verificación de cierre (6 comprobaciones).
10. Entrega de resultados — pendiente tu decisión sobre §9 (limpieza).

### Número exacto de escrituras previstas contra EspoCRM real

| Escritura | Cantidad |
|---|---|
| `data/config.php` (`gapssaBookingDecisionEnabled`) | 2 (abrir `true`, cerrar `false`) |
| `Meeting` creados (fixtures A, B) | 2 |
| `Meeting` actualizados vía `PutDecide` (efecto real) | 2 (A→Confirmed, B→Canceled) |
| Filas nuevas en `gapssa_meeting_decision_operation` | 5 (aprobación, rechazo, conflicto de re-decisión de §7.2 — los 2 replays y el 409 de clave reutilizada de §7.1 no añaden fila) |
| Google Calendar (`gcs_event_link`, eventos reales) | **0 previstas** si se sigue la recomendación de §3.4 (fixtures sin `gcs_account`) |

**Total de escrituras de negocio/config directamente iniciadas por esta
puerta: 9** (2 config + 2 creación + 2 decisión + 5 idempotencia − 2
duplicados ya contados como "decisión" es incorrecto, recuento limpio:
2 config + 2 creación de Meeting + 5 filas de idempotencia = **9**; las 2
actualizaciones de `Meeting` vía `PutDecide` están incluidas como parte
del mismo evento que genera cada fila de idempotencia de aprobación/
rechazo, no se cuentan aparte).

### Efectos persistentes esperados al terminar (antes de cualquier limpieza)

- 2 `Meeting [PRUEBA PUERTA5]` reales, activos (`deleted=0`), en
  `Confirmed`/`Approved` y `Canceled`/`RejectedByStaff` respectivamente.
- 5 filas en `gapssa_meeting_decision_operation`.
- `gapssaBookingDecisionEnabled=false` (mismo valor que al empezar).
- `ESPO_BOOKING_ADAPTER=simulated` en todos los entornos (sin cambios).
- Ningún `Meeting` real (de los 10 de línea base) modificado.
- Ningún evento nuevo en Google Calendar (si se siguió §3.4).

### Rollback

- Del flag: cubierto íntegramente por §4.3 (éxito y error), con backup de
  `data/config.php` como última red.
- De los `Meeting` de prueba: no hay "rollback" de una decisión ya
  confirmada por diseño (`PutDecide` no expone una reversión — es
  intencional, una decisión de reserva no se deshace silenciosamente).
  Si algo saliera mal, la corrección es el soft-delete de §9 (marca los
  fixtures como no vigentes) — nunca un intento de "deshacer" el estado
  vía un `PUT` genérico, que además el guard de transición bloquearía.
- De la tabla de idempotencia: no se propone ningún rollback — sus filas
  son evidencia, no estado operativo a revertir.

### Política de limpieza

Ver §9 — recomendación de soft-delete, sin ejecutar sin autorización
aparte y explícita.

### Separación 5A / 5B

Ver §10 — esta propuesta es exclusivamente 5A; 5B queda como subpuerta
futura, sin diseño operativo detallado todavía.

---

**Queda a la espera de tu revisión y de una aprobación explícita, punto
por punto, antes de ejecutar cualquier parte de §1 en adelante.** No se
ha ejecutado nada para producir este documento salvo lectura del
repositorio (código PHP/TS existente, documentos previos de la Puerta 4)
— cero operaciones contra `gapssa-espocrm-1` real, cero cambios en
`apps/web`, cero commits.
