# Puerta 6 — Exclusión explícita por `Meeting` para Google Calendar Sync (`cExcluirGoogleCalendarSync`)

**Alcance de esta sesión: solo repositorio + ensayo desechable.** Nada de lo
descrito aquí se ha desplegado contra `gapssa-espocrm-1` real. No se ha hecho
`docker cp` hacia el contenedor real, no se ha ejecutado `rebuild` ni SQL
contra la base real, no se ha cambiado ningún ACL real, no se ha creado
ningún `Meeting` real, no se ha activado `gapssaBookingDecisionEnabled`, no
se ha cambiado `ESPO_BOOKING_ADAPTER`. Sin commits.

> **Revisión — Parte B, 2026-08-12.** La Parte A (diseño §1–§10, incluida
> la implementación, las pruebas puras y el ensayo desechable con teardown
> completo) queda **aceptada como completada** — sin cambios de fondo en
> esta revisión. Esta revisión actualiza la propuesta de la **Parte B**
> (§11, despliegue real) y añade una subpuerta nueva, separada y todavía
> no autorizada, para la futura Puerta 5A (§12.1), con los ajustes de
> seguridad y operación exigidos: ACL permanente sin `edit:yes` para el
> API User (§11.4), backup real byte a byte en vez de depender solo del
> ZIP `1.1.1` (§11.1), manifiesto cerrado por archivo con SHA-256 (§11.2),
> orden seguro con `maintenanceMode`/`ConfigWriter` (§11.3), dos clases de
> rollback (§11.5) y condiciones de parada ampliadas (§11.7). También
> precisa el alcance exacto de la garantía de `pushMeeting()` (§4.1) y la
> semántica completa del `DELETE` de limpieza (§5), tal como exigió la
> autorización.

> **Actualización — Parte B ejecutada, 2026-08-13.** La Parte B (§11) se
> ejecutó contra `gapssa-espocrm-1` real el 2026-08-12T14:24:34Z. Aceptada
> como completada por autorización explícita. Los hechos de ejecución
> quedan registrados en el nuevo §11.8, **re-verificados de forma
> independiente en esta sesión** (2026-08-13) contra el contenedor real y
> la base de datos real — no solo trasladados del informe de la sesión
> anterior: extensión instalada `6a7c85ea33e2f13b5`/`1.2.0`, columna
> `c_excluir_google_calendar_sync` `tinyint(1) NOT NULL DEFAULT 0`, ACL
> final de ambos roles, configuración efectiva vía
> `Espo\Core\Utils\Config`, conteos de `Meeting`/`gcs_event_link`, y
> SHA-256 de los 7 archivos vivos comparados byte a byte contra el árbol
> de trabajo del repositorio y contra el manifiesto de §11.2 — los 7
> coinciden exactamente. La Puerta 5A permanece bloqueada: la subpuerta
> §12.1 (5A-1-apertura) sigue sin autorizar y sin ejecutar (confirmado:
> `cExcluirGoogleCalendarSync=1` en cero `Meeting`s reales). Sin
> `PutDecide`, sin `gapssaBookingDecisionEnabled`, sin cambios en
> `ESPO_BOOKING_ADAPTER`, sin tocar OAuth, sin commits.

## 0. Por qué existe esta puerta

El incidente de la Puerta 5A (`docs/fase4b-puerta5-propuesta-v3.md`,
sección "Incidente") dejó bloqueada la reanudación de esa puerta: el token
OAuth de la cuenta Business está caducado/revocado, y aunque eso impidió por
casualidad una escritura real en Google, **no debe usarse como mecanismo de
aislamiento** — así lo exigió tu autorización. Esta puerta construye el
mecanismo real: un campo booleano por `Meeting` que, cuando es `true`, hace
que GCS ignore esa cita por completo, en **todas** sus rutas, con
independencia del estado del token OAuth.

## 1. Nombre del campo

`cExcluirGoogleCalendarSync` — el nombre recomendado en tu encargo. No se
encontró ninguna razón técnica para proponer otro.

## 2. Diseño del campo

Definido en la propia extensión GCS (no en el módulo custom de Gapssa — ver
§2.1), junto al link `gcsEventLinks` que ya aporta esa extensión a `Meeting`:

```json
// extensions/espocrm-google-calendar-sync/files/.../Resources/metadata/entityDefs/Meeting.json
"cExcluirGoogleCalendarSync": {
    "type": "bool",
    "default": false,
    "required": false,
    "isCustom": false
}
```

Verificado contra un EspoCRM 10.0.3 real (ensayo desechable, §9): la columna
resultante es `tinyint(1) NOT NULL DEFAULT 0` (`DESCRIBE meeting` — ver
§9.2). Esto satisface punto por punto el requisito 1 del encargo:

- **`default=false`** ✅ (columna con `DEFAULT 0`).
- **`nullable=false`** ✅ (`NOT NULL`, no `NULL` en `DESCRIBE`).
- **Meetings existentes se comportan como `false`** ✅ — no por lógica
  especial en el código, sino porque el propio esquema no permite otro
  valor al añadir la columna: cualquier fila preexistente se rellena con el
  `DEFAULT 0` en el mismo `ALTER TABLE`. Confirmado en el ensayo (escenario
  11, §9.3): una fila creada sin especificar el campo nace en `false`.
- **`false` = sincronización normal, `true` = GCS ignora la cita** ✅
  (semántica implementada en `SyncService::isExcludedFromSync()`, §3).

### 2.1 Por qué en la extensión GCS y no en el módulo Gapssa

Es un mecanismo genérico de la extensión (excluir un `Meeting` cualquiera de
GCS), no una regla de negocio de Gapssa — reutilizable en cualquier
instalación de Google Calendar Sync. `DECISIONS.md` de la extensión
(entrada v1.2.0, punto 29) registra esta decisión.

## 3. Auditoría de puntos de entrada GCS — tabla exigida por el encargo

Auditoría completa de la extensión (`extensions/espocrm-google-calendar-sync/files/.../{Hooks,Classes,Jobs,Api,Controllers,EntryPoints}`).
Los `Api`/`Controllers`/`EntryPoints` (`GetAuthUrl`, `PostDisconnect`,
`PostRefreshCalendars`, `GcsAccount`, `GcsCallback`) gestionan la cuenta
Business/OAuth — ninguno sincroniza un `Meeting`, así que no aparecen en la
tabla.

| Punto de entrada | Comportamiento actual (antes de esta puerta) | Comportamiento con `cExcluirGoogleCalendarSync=true` |
|---|---|---|
| `GcsPush::afterSave()` (creación) | Encola `UPSERT` si no es `silent`/`gcsSync` y el flag global está activo | **Cero jobs desde el origen** — el hook comprueba el campo antes de encolar nada |
| `GcsPush::afterSave()` (edición, cambio relevante) | Encola `UPSERT` si cambió `name`/`description`/fechas/`status`/`assignedUserId` | **Cero jobs** — si la cita ya estaba excluida y el campo no cambia, ningún otro cambio dispara nada |
| `GcsPush::afterSave()` (cambia `cExcluirGoogleCalendarSync`) | *(no existía)* | `false→true`: encola **1 `DELETE`** (limpia cualquier vínculo heredado; no-op si nunca hubo uno). `true→false`: encola **1 `UPSERT`** inmediato e idempotente |
| `GcsPush::afterRemove()` (soft-delete) | Encola `DELETE` siempre que el flag global esté activo | **Sin cambio** — se deja pasar a propósito: es la ruta que limpia un evento ya sincronizado antes de excluir la cita. `SyncService` decide si hay algo real que borrar (§4) |
| `GcsPush::afterRelate()`/`afterUnrelate()` (contactos) | Encola `UPSERT` al vincular/desvincular un contacto | **Cero jobs** — el hook comprueba el campo antes de encolar |
| `GcsContactRename::afterSave()` (Contact) | Encola `UPSERT` para cada `Meeting` relacionado (hasta 200) cuyo nombre cambió | Las citas excluidas se **excluyen del bucle** (`select` amplía a `cExcluirGoogleCalendarSync`); el aviso de "tope alcanzado" se basa en lo leído, no en lo encolado |
| `GcsPushSweep`/`SyncService::sweep()` (barrido cada 5 min) | Reintenta `UPSERT`/`DELETE` pendientes para citas modificadas en los últimos 14 días | Cita excluida **sin** vínculo: se omite sin más. Cita excluida **con** vínculo heredado (p. ej. el `DELETE` de limpieza falló la primera vez): se reintenta como `DELETE` — red de seguridad para que la limpieza converja aunque el primer intento fallase |
| `SyncService::pushMeeting()` (funnel único, ver §4) | Llama a `processPush()` sin condición adicional | **Único punto de aplicación real**: `isExcludedFromSync()` corta antes de `processPush()`/`createCalendarService()` para cualquier acción que no sea `DELETE` ni una cita cancelada |
| Cualquier ruta manual o futura | No existía protección central | Cualquier código que termine llamando a `pushMeeting()` (reconstrucción de jobs, un futuro endpoint administrativo, etc.) hereda la protección automáticamente — no requiere que el autor de esa ruta recuerde comprobar el campo |

## 4. Por qué un único punto de aplicación real (y no un guardia por hook)

`SyncService::pushMeeting()` es el único método al que terminan llamando
*todos* los caminos de la tabla anterior. Comprobar la exclusión ahí, con el
estado **vivo** de la cita (nunca un valor capturado al encolar el job), es
lo único que garantiza que ninguna ruta —existente o futura— que termine
llamando a `pushMeeting()` pueda saltarse la exclusión (alcance exacto de
esta garantía en §4.1):

```php
private function isExcludedFromSync(?Entity $meeting, string $action): bool
{
    if ($action === self::ACTION_DELETE) return false;   // limpieza: nunca se bloquea
    if (!$meeting) return false;                          // ya no existe: rama de borrado
    if ($this->eventMapper->isCanceled($meeting)) return false; // cancelar también limpia
    return (bool) $meeting->get('cExcluirGoogleCalendarSync');
}
```

Los hooks **además** evitan encolar el job desde el origen cuando pueden
(más limpio, menos ruido en la tabla `job`), pero esa optimización nunca es
la única barrera — confirmado en el ensayo forzando `pushMeeting()`
directamente sin pasar por ningún hook (escenario 2c, §9.3).

### 4.1 Alcance exacto de esta garantía

No es "cubre todos los caminos futuros" sin matices — es más precisa, y
por eso más verificable:

- Cubre **todos los caminos actuales** auditados en la tabla de §3 (todos
  los `Hooks`/`Jobs`/`SyncService` reales de la extensión hoy).
- Cubre **cualquier camino futuro** —un hook nuevo, un endpoint
  administrativo nuevo, una reconstrucción manual de jobs, lo que sea—
  que termine invocando `SyncService::pushMeeting()`, sin que su autor
  necesite recordar comprobar el campo.
- **No** cubre, y no puede cubrir por construcción, una futura integración
  que construya su propio cliente de Google (nueva instancia de
  `GoogleClientFactory`/`google/apiclient`) y llame directamente a la API
  de Calendar sin pasar por `pushMeeting()`. Esa ruta hipotética, si
  llega a existir, deberá auditarse por separado — esta puerta no la
  protege de forma automática.

## 5. Semántica de transición — atomicidad, fallos parciales, idempotencia

**Precisión sobre el `DELETE` de limpieza** — no es "cero efectos" sin
matices; la semántica real depende de si la cita ya tenía un vínculo:

- Una cita excluida que **nunca tuvo** `GcsEventLink` produce, ante ese
  `DELETE` de limpieza, **cero llamadas externas reales** —
  `deleteByLinks()` itera cero filas por diseño ya existente en la
  extensión, no por lógica nueva de esta puerta.
- Una cita excluida **con un vínculo heredado** (creada como `false`,
  sincronizada, y solo después pasada a `true`) sí permite un `DELETE`
  real y **deliberado** — es la limpieza que evita dejar un evento
  huérfano en Google para siempre; no es un efecto colateral indeseado.
- Por eso `false→true` **puede** generar una eliminación real en Google si
  ya existía un vínculo — no es un no-op universal, depende del historial
  de esa cita concreta.
- Una cita creada **ya con `true`** desde el origen —el caso de los
  Fixtures A/B de la Puerta 5A— nunca llega a tener vínculo, así que
  produce **cero jobs y cero tráfico** durante toda su vida: el caso que
  importa para poder crear Fixtures sin efecto en Google (§12.1).
- En resumen: la exclusión bloquea **exportaciones** (crear/actualizar en
  Google), no la limpieza necesaria de eventos ya existentes — bloquear
  también esa limpieza sería el bug, no la corrección.

| Transición | Política | Justificación |
|---|---|---|
| `false→true`, sin `GcsEventLink` | `DELETE` encolado, resulta en 0 llamadas reales (`deleteByLinks()` itera 0 filas) | No-op seguro por diseño existente de `deleteByLinks()` — no hace falta comprobar antes si hay vínculo |
| `false→true`, con `GcsEventLink` | `DELETE` encolado, limpia el evento real y borra el vínculo | Evita dejar un evento huérfano en Google para siempre |
| `false→true`, el `DELETE` de limpieza falla | Sin reintento automático del job (mismo `attempts=0` que cualquier job de esta cola — confirmado en el incidente de la Puerta 5A) | Cerrado por `sweep()`: en el siguiente barrido (máx. 5 min), si el vínculo sigue existiendo, se reintenta como `DELETE` — mecanismo nuevo de esta puerta (§3, fila de `sweep`), sin él la limpieza fallida quedaría huérfana para siempre |
| `true→false` | `UPSERT` inmediato, no diferido | Idempotente por diseño existente: `processPush()` busca por `espoMeetingId` antes de insertar — un `UPSERT` de más nunca duplica |
| Concurrencia (varias transiciones en peticiones HTTP separadas) | Cada petición es un proceso PHP nuevo con su propia instancia del hook — cada transición encola su propio job | Confirmado en el ensayo (escenario 14, §9.4): 5 transiciones vía `PUT` reales → 5 jobs, secuencia exacta `upsert,delete,upsert,delete,upsert,delete` (el primero es el de la creación) |
| Concurrencia dentro de **un mismo** proceso/petición | La deduplicación por instancia (`$scheduled[meetingId:action]`, ya existente desde v1.1.1) puede fusionar dos transiciones iguales encoladas en la misma petición | Comportamiento heredado y correcto (evita encolar de más cuando una sola petición relaciona varios contactos) — nunca aplica entre peticiones HTTP separadas, que es la unidad real de concurrencia |

## 6. Seguridad y ACL

- **El cliente web nunca puede elegir este campo.** `apps/web` no se ha
  tocado en esta puerta — `HttpEspoBookingAdapter.createMeeting()`
  (`apps/web/src/server/booking/httpEspoAdapter.ts:590`, `PORTAL_MEETING_NAME`)
  sigue sin incluir `cExcluirGoogleCalendarSync` en ningún payload, y
  ninguna ruta pública de `apps/web` lo acepta — confirmado por `git status`
  (cero cambios en `apps/web/`, §16). El adaptador productivo lo omite
  siempre (equivale a `false` por el `default` del esquema).
- **Solo un modo interno de fixture/test puede establecer `true`.** No se
  construyó una nueva superficie en `apps/web` para esto (no era necesaria:
  los Fixtures de la Puerta 5A se crean vía `POST /api/v1/Meeting` directo
  con la API Key de `portal-gapssa-api`, nunca a través de `apps/web`). El
  control real es el ACL de campo, no un flag de aplicación.
- **ACL verificado en el ensayo** (`AclManager::checkField`, escenario 12,
  §9.4, y HTTP real, escenario 13):
  - Rol con `edit:yes` en el campo → puede fijar `true` vía API real (uso
    previsto para crear Fixtures).
  - Rol con `edit:no`/`read:no` → `AclManager` deniega ambos, y un intento
    HTTP real de fijar `true` **nunca** se persiste (queda en `false`).
  - Anónimo (sin credenciales) → `401`, cero acceso, confirmado por HTTP
    real.
  - Admin → acceso completo, estructural (`isAdmin()` sortea el ACL de
    campo, no requiere configuración).
- **Política ACL permanente recomendada para los roles reales de Gapssa**
  (§11.4 — NO aplicada a `gapssa-espocrm-1`, parte de la Parte B;
  **corregida en esta revisión**: la versión anterior de esta tabla dejaba
  `edit: yes` permanente para `Portal GAPSSA API`; queda retirado —
  justificación completa en §11.4):

  | Rol real | `cExcluirGoogleCalendarSync` (permanente, tras la Parte B) |
  |---|---|
  | Admin | Acceso completo (estructural, sin cambio de ACL) |
  | `Portal GAPSSA API` (`6a7b345b239b2ed26`) | `{read: yes, edit: NO}` |
  | `Profesional Gapssa` (`6a7361290526f104b`) | `{read: no, edit: no}` |
  | Anónimo | Sin acceso (sin credenciales → `401`, sin cambio) |

  `read:yes` para `Portal GAPSSA API` (en vez de `read:no`, como `name`)
  sigue siendo deliberado: no es un campo con PII ni motivo de negocio
  para ocultarlo, y permite verificar el propio Fixture recién creado por
  la misma vía API que lo creó. **`edit:yes` no queda permanente** —
  `edit` solo se abre durante la ventana exacta de creación de los
  Fixtures A/B de la Puerta 5A, mediante la subpuerta separada §12.1, y se
  cierra antes de la pausa humana de esa puerta.
- **No se muestra en ningún layout.** No se añadió a
  `layouts/Meeting/detail.json` ni a ningún otro layout del módulo Gapssa
  — solo accesible por API/ORM, tal como pide el encargo ("no mostrarlo en
  layouts normales").
- **Nunca se decide por `name`, prefijos, `assignedUserId`, estado, fechas,
  `Contact` ni ausencia de `GcsAccount`.** `isExcludedFromSync()` (§4) solo
  lee el campo mismo (y, para las rutas de limpieza, el `status` nativo vía
  `EventMapper::isCanceled()`, el mismo mecanismo que ya usaba
  `processPush()` antes de esta puerta).

## 7. Compatibilidad — nada roto

- `false` sigue comportándose exactamente igual que antes de esta puerta —
  confirmado en el ensayo (escenario 1 y 10, §9.3): una cita normal se
  sincroniza con el mismo patrón `GET` anti-duplicados + `POST` insert.
- `status` nativo y `cEstadoReserva` — no se tocan en ningún punto de esta
  puerta.
- `PutDecide` — no se ha modificado ni un carácter del motor de decisión de
  Gapssa. Los escenarios 4/5 del ensayo (§9.3) simulan el efecto exacto de
  una aprobación/rechazo sobre los campos que sí le importan a GCS
  (`cEstadoReserva` nunca dispara nada; `status→Not Held` si el rechazo
  cambia el status nativo), sin desplegar el motor completo de `PutDecide`,
  que ya se probó por separado (`docs/fase4b-decision-flow-final.md`).
- Credenciales/cuenta Business — no se han tocado, ni real ni en el ensayo
  más allá de una cuenta ficticia con token igualmente ficticio.
- `ESPO_BOOKING_ADAPTER` — sin cambios, sigue `simulated` en todos los
  entornos reales.

## 8. Implementación — archivos tocados (solo repositorio)

| Archivo | Cambio |
|---|---|
| `extensions/espocrm-google-calendar-sync/files/.../Resources/metadata/entityDefs/Meeting.json` | Nuevo campo `cExcluirGoogleCalendarSync` |
| `.../Resources/i18n/{en_US,es_ES}/Meeting.json` | Nuevos (etiqueta del campo) |
| `.../Classes/SyncService.php` | `isExcludedFromSync()` en `pushMeeting()`; `sweep()` consciente de exclusión (limpieza de vínculos heredados) |
| `.../Hooks/Meeting/GcsPush.php` | `afterSave()`: creación excluida = cero jobs; transición `false↔true`; `afterRelate`/`afterUnrelate` respetan la exclusión |
| `.../Hooks/Contact/GcsContactRename.php` | `scheduleRelatedMeetings()` omite citas excluidas; aviso de tope basado en lo leído |
| `.../Classes/GoogleClientFactory.php` | `setHttpClientOverride()` — transporte HTTP inyectable, **solo ensayos**, `null` por defecto, nunca invocado en producción |
| `.../manifest.json` | `1.1.1` → `1.2.0` |
| `.../docs/DECISIONS.md` | Entrada v1.2.0 (puntos 29–35) |
| `.../build.sh` | Añadidos `exclusion_hook_test.php` y `exclusion_sync_service_test.php` a la batería |
| `.../tests/exclusion_hook_test.php` | Nuevo — 17 aserciones puras sobre `GcsPush` |
| `.../tests/exclusion_sync_service_test.php` | Nuevo — 18 aserciones puras sobre `SyncService` (dobles completos, cero red) |
| `.../tests/contact_hook_test.php` | Extendido — `FakeMeeting` soporta exclusión; 2 casos nuevos; corregida una aserción de `select` desactualizada |

Ningún archivo de `apps/web/`, ningún archivo del módulo custom de Gapssa
(`extensions/espocrm/custom/...`), ningún ACL real, ninguna credencial.

## 9. Ensayo desechable — ejecutado, con autorización explícita para él

### 9.1 Topología (mismo patrón que las Puertas 3D/5)

| | Real (`gapssa`) | Desechable (este ensayo) |
|---|---|---|
| Proyecto Compose | `gapssa` | `gapssa-puerta6-rehearsal` |
| Contenedores | `gapssa-espocrm-1`, `gapssa-espocrm-db-1` | `gapssa-puerta6-rehearsal-espocrm-1`, `...-espocrm-db-1` (sin daemon/websocket — el barrido y los `push` se invocan directamente desde el guion, no por el daemon; ver §9.5) |
| Red | `gapssa_public`/`gapssa_private` | `gapssa-puerta6-rehearsal_net` (única) |
| Volúmenes | `gapssa_espocrm-*` | 4 volúmenes propios (`db`, `data`, `custom`, `client-custom`) |
| Puerto HTTP | `8081` (`0.0.0.0`) | `18086`, atado solo a `127.0.0.1` |
| Credenciales | reales, `.env` (nunca leído) | generadas con `openssl rand -hex 12`, exclusivas, nunca mostradas, eliminadas del scratchpad al terminar |
| Imágenes | — | `espocrm/espocrm:10.0.3-apache-trixie` + `mariadb:11.4`, idénticas a la real |

Extensión GCS (con los cambios de esta puerta) copiada vía `docker cp` al
contenedor desechable; `bin/command rebuild` ejecutado ahí — nunca contra
`gapssa-espocrm-1`.

### 9.2 Transporte controlado — cero red hacia Google real

En vez de un servidor HTTP separado, se usó `GoogleClientFactory::setHttpClientOverride()`
(§8) con un `GuzzleHttp\Handler\MockHandler` real: intercepta al nivel del
handler de Guzzle, antes de cualquier E/S de red — cero sockets abiertos,
en cualquier escenario, incluida la renovación OAuth (mismo cliente HTTP
subyacente que usa `TokenService::getAccessToken()`). `Middleware::history()`
registra cada petición (método, URI, cuerpo) para verificar exactamente qué
se habría enviado a Google.

Cuenta `GcsAccount` de prueba: `type=Business`, `status=Active`,
`accessToken`/`refreshToken` cifrados con la utilidad `Crypt` real pero con
valores ficticios (`fake-access-token-never-real`), `tokenExpiresAt` a un
año vista — así el estado estacionario (token válido) no necesita simular
la respuesta del endpoint OAuth en la mayoría de los escenarios.

Confirmado por `DESCRIBE meeting` contra la instancia desechable:
`c_excluir_google_calendar_sync` `tinyint(1) NOT NULL DEFAULT 0` (§2).

### 9.3 Fase A — matriz principal (33 aserciones, todas en verde)

Ejecutada con el código real desplegado (`SyncService`, `GcsPush`,
`EventMapper`...) y el cliente real de `google/apiclient`, contra la
instancia EspoCRM real (no dobles PHP — esos ya se cubrieron en `make
gcs-test`, §8).

| # | Escenario exigido por el encargo | Resultado |
|---|---|---|
| 1 | Creación con `false` → comportamiento normal | ✅ 1 job `UPSERT`; al procesarlo, `GET` anti-duplicados + `POST` insert (2 llamadas reales); 1 `GcsEventLink` creado |
| 2 | Creación con `true` → 0 jobs, 0 links, 0 llamadas | ✅ 0 jobs; forzando `pushMeeting()` igualmente, 0 llamadas al transporte |
| 3 | Actualización relevante (`name`, fecha) con `true` → 0 efectos | ✅ 0 jobs, 0 llamadas, 0 `GcsEventLink` |
| 4 | "Aprobación" (`cEstadoReserva`, sin cambio de `status`) con `true` → 0 efectos | ✅ 0 jobs (`cEstadoReserva` no está entre los atributos relevantes de GCS) |
| 5 | "Rechazo" (`status→Not Held`) con `true` → 0 efectos | ✅ 0 jobs desde el hook; `SyncService` también bloquea si se fuerza; 0 `GcsEventLink` (nunca hubo nada que borrar) |
| 6 | Soft-delete con `true` → 0 efectos | ✅ Sí encola 1 `DELETE` (limpieza, por diseño — §4); al procesarlo, 0 llamadas `events.delete` (nada que borrar) |
| 7 | Sweep/reintentos con `true` → 0 efectos | ✅ La cita excluida nunca aparece en ninguna petición del barrido (verificado por URI/cuerpo, no por conteo global — el barrido sí sincroniza otras citas no excluidas de la misma base compartida); 0 `GcsEventLink` |
| 8 | `false→true` sin vínculo | ✅ Encola 1 `DELETE`; al procesarlo, 0 llamadas `events.delete` |
| 9 | `false→true` **con** vínculo | ✅ Encola 1 `DELETE`; al procesarlo, **sí** llama a `events.delete` (limpieza real); el vínculo local se elimina; un push posterior no vuelve a llamar a Google |
| 10 | `true→false` | ✅ Encola 1 `UPSERT`; se exporta (mismo patrón `GET`+`POST`); reintentarlo no duplica el vínculo (idempotencia) |
| 11 | Valores `null`/ausentes/heredados = `false` | ✅ Confirmado por esquema (`DEFAULT 0`, `NOT NULL`) y por comportamiento (se sincroniza como cualquier cita normal) |

### 9.4 Fase B — ACL, imposibilidad de control público, concurrencia (17 aserciones, todas en verde)

| # | Escenario | Resultado |
|---|---|---|
| 12 | ACL por rol vía `AclManager` | ✅ API (edit:yes) puede; Profesional (edit:no/read:no) no puede ninguna de las dos; Admin acceso completo |
| 13 | API pública/cliente no puede controlar el campo | ✅ Actor con `edit:yes` sí puede fijar `true` por HTTP real (uso previsto); actor sin permiso **nunca** logra persistir `true`; anónimo → `401` |
| 14 | Concurrencia e idempotencia | ✅ 5 transiciones vía `PUT` HTTP reales (peticiones separadas) → 6 jobs totales (1 de la creación + 5 de las transiciones), secuencia exacta `upsert,delete,upsert,delete,upsert,delete`; valor final del campo correcto; 0 `GcsEventLink` (nunca llegó a exportarse) |

### 9.5 Nota metodológica — por qué se invocó `SyncService` directamente

El daemon (`espocrm-daemon`) no se desplegó en el ensayo (mismo patrón
minimalista que las Puertas 3D/5, que tampoco lo necesitaron). La inyección
de transporte (`setHttpClientOverride()`) es por instancia, y EspoCRM
construye una instancia nueva de `GoogleClientFactory`/`SyncService` por
cada ejecución de job — persistir la inyección a través del daemon
exigiría tocar su arranque, fuera del alcance ("cambios únicamente en el
repositorio"). En su lugar, el guion del ensayo construye `SyncService`
manualmente con las mismas dependencias reales que usaría el contenedor
(`EntityManager`, `EventMapper`, `ContactNameResolver`, `Config`, `Log`
reales, obtenidos del contenedor de inyección de EspoCRM) y le inyecta el
transporte controlado, invocando `pushMeeting()`/`sweep()` directamente —
mismo código real, misma base de datos real, mismo cliente real de
`google/apiclient`, solo sin pasar por la cola de jobs para la parte de
"quién dispara la ejecución". La creación de `Meeting`s y las transiciones
del campo sí pasan por la cola real (`GcsPush`) y, en los escenarios 12–14,
por peticiones HTTP reales — la única parte simulada es qué proceso
finalmente llama a `pushMeeting()`.

### 9.6 Teardown y comparación antes/después

```
docker compose -p gapssa-puerta6-rehearsal down -v
```

2 contenedores, 4 volúmenes, 1 red eliminados. Verificación posterior
(`docker ps -a`/`network ls`/`volume ls`, filtrados por
`gapssa-puerta6-rehearsal`): las tres listas vacías — cero residuos.

`gapssa-espocrm-1` real, comparación exacta antes/después de todo el
ensayo:

| Comprobación | Antes | Después |
|---|---|---|
| `Meeting` activos | 7 | 7 |
| `Meeting` soft-deleted | 4 | 4 |
| `Meeting` totales | 11 | 11 |
| `gcs_event_link` | 4 | 4 |
| `gapssa_meeting_decision_operation` | 0 | 0 |
| `gapssaBookingDecisionEnabled` | `false` | `false` |
| `gcsSyncStartAt` | `2026-08-04 16:32:05` | `2026-08-04 16:32:05` (sin tocar) |
| `app-check` | verde | verde |
| `gapssa-espocrm-1` `StartedAt` (Docker) | `2026-08-10T08:30:10Z` | idéntico — nunca se reinició |
| `gapssa-espocrm-db-1` `StartedAt` | `2026-08-10T08:30:10Z` | idéntico |

## 10. Validación — checklist del encargo

| Comprobación | Resultado |
|---|---|
| `php -l` sobre todos los archivos PHP tocados/nuevos | ✅ Sin errores |
| Arnés PHP de la extensión (`tests/*.php`) | ✅ 10 archivos, todos en verde (autoload, controladores, i18n, mapper, hook de relaciones, hook de contact, resolver de contactos, **exclusión×2 nuevas**, paquete) |
| `make gcs-test` (`gcs-deps-check` + build + batería completa) | ✅ `google-calendar-sync-1.2.0.zip` construido y verificado, autónomo, `php -l` sobre el contenido del ZIP sin errores |
| `make gcs-lint` | ✅ Sin errores de sintaxis (PHP real del contenedor) |
| Tests del adaptador/web afectados | **N/A** — cero archivos de `apps/web/` tocados (confirmado por `git status`); nada que probar ahí |
| Typecheck/lint de `apps/web` | **N/A**, mismo motivo |
| `git diff --check` | ✅ Sin problemas de espacios en blanco |
| Escaneo de secretos (patrones de claves de Google/API keys/private keys/passwords) sobre los archivos tocados | ✅ Cero coincidencias; cero credenciales (ni ficticias) del ensayo quedaron en archivos versionados |
| Commits | ✅ Cero — `git log` sin cambios, todo en working tree |

## 11. Parte B — futura puerta de despliegue real (propuesta revisada, NO ejecutada)

Requiere su propia aprobación explícita, separada de esta. **Nada de lo
descrito en esta sección se ha ejecutado** — ni backup, ni copia, ni
`rebuild`, ni ACL, ni `maintenanceMode`, contra `gapssa-espocrm-1` real.
`gapssaBookingDecisionEnabled` permanece `false` y `ESPO_BOOKING_ADAPTER`
permanece `simulated` durante todo el proceso descrito aquí.

### 11.1 Backup real — byte a byte, no solo el ZIP `1.1.1`

No basta con asumir que existe un ZIP `build/google-calendar-sync-1.1.1.zip`
utilizable como preimagen: el rollback debe restaurar exactamente los
bytes que estaban **vivos** en el contenedor inmediatamente antes de
desplegar, que no necesariamente coinciden con ningún ZIP guardado (por
ejemplo, si algún archivo se hubiera tocado directamente en el contenedor
real fuera de este flujo — nunca confirmado que no haya ocurrido).

**Primer paso de la Parte B, antes de copiar nada**: por cada archivo vivo
que el manifiesto (§11.2) vaya a añadir o reemplazar en `gapssa-espocrm-1`,
capturar:

- ruta real dentro del contenedor;
- SHA-256 del contenido vivo;
- tamaño en bytes;
- propietario y grupo (`stat -c '%U %G'`);
- modo (`stat -c '%a'`);
- timestamp de modificación (`stat -c '%Y'`, UTC);
- una copia física del contenido — no solo el hash.

Todo bajo un directorio dedicado y no sobrescribible, mismo patrón que las
Puertas 3C/3D:

```
/var/www/html/data/.backup/gapssa/puerta6/<timestamp-UTC>/
  archivos/...                            (copia física byte a byte de cada archivo vivo del manifiesto §11.2)
  manifiesto-backup.json                  (ruta, SHA-256, tamaño, propietario, grupo, modo, timestamp — uno por archivo)
  acl/portal-gapssa-api.field_data.json   (backup del rol completo, no solo este campo)
  acl/profesional-gapssa.field_data.json
  meetings-snapshot.json                  (conteos + snapshot técnico no-PII, ver abajo)
  config-efectiva-gcs.json                (configuración efectiva de GCS sin secretos, ver abajo)
  README.md
```

Propiedad `www-data:www-data`; permisos restrictivos (`700` en el
directorio, `600` en cada archivo) — mismo patrón que Puertas 3C/3D.

**Incluye explícitamente** (checklist exigido):

- metadata viva: `Resources/metadata/entityDefs/Meeting.json` y
  `Resources/i18n/{en_US,es_ES}/Meeting.json` tal como están desplegados
  hoy (`1.1.1`, sin el campo nuevo);
- `Hooks/Meeting/GcsPush.php`;
- `Hooks/Contact/GcsContactRename.php`;
- `Classes/SyncService.php`;
- `Classes/GoogleClientFactory.php`;
- `manifest.json` de la extensión (`1.1.1`);
- cualquier otro archivo que el manifiesto de §11.2 marque como
  reemplazado — el backup se genera **a partir del propio manifiesto**,
  nunca al revés, para que nunca falte una entrada;
- ACL completo (`field_data` íntegro, no solo el campo nuevo) de
  `Portal GAPSSA API` y `Profesional Gapssa`;
- conteos y snapshot técnico no-PII de `Meeting`: activos/soft-deleted/
  totales, `gcs_event_link` totales, `gapssa_meeting_decision_operation`
  totales — mismos campos que la comparación de §9.6, releídos en el
  momento real de la Parte B (no reutilizar los valores de §9.6, que
  corresponden al ensayo desechable, no a este despliegue);
- configuración efectiva de GCS **sin secretos**: `gcsSyncStartAt` leído
  vía `Espo\Core\Utils\Config` (nunca solo `data/config.php` — lección del
  incidente de la Puerta 5A, `docs/fase4b-puerta5-propuesta-v3.md`
  §"Incidente" §0.2), `status`/`lastError` de la cuenta `GcsAccount`
  Business (sin `accessToken`/`refreshToken`), y `maintenanceMode` actual
  (esperado: ausente/`NULL`, no `false` — lección de la Puerta 4,
  `docs/fase4b-puerta4-cierre.md`).

### 11.2 Manifiesto cerrado de despliegue

Nunca "copiar la extensión completa" como instrucción ambigua. Tabla
cerrada de todo archivo que la Parte B tocaría en `gapssa-espocrm-1` real.
Excluye explícitamente lo que nunca se despliega a EspoCRM real —
`docs/DECISIONS.md`, `build.sh`, `tests/*.php` viven solo en el
repositorio, fuera de `files/`, confirmado por la estructura que empaqueta
`extensions/espocrm-google-calendar-sync/build.sh`.

SHA-256 calculado sobre el árbol de trabajo actual del repositorio en el
momento de esta revisión (2026-08-12) — **a revalidar contra el ZIP
realmente construido** en el momento de ejecutar la Parte B: un
manifiesto cerrado fija las rutas, no congela el contenido entre esta
revisión y la ejecución (condición de parada explícita en §11.7 si no
coincide).

| # | Origen (repositorio) | Destino (`gapssa-espocrm-1`) | SHA-256 esperado (repo actual) | Nuevo / reemplaza | Propietario/grupo/modo esperado |
|---|---|---|---|---|---|
| 1 | `extensions/espocrm-google-calendar-sync/manifest.json` | manifiesto de la extensión instalada (gestionado por `bin/command extension`, no una ruta suelta bajo `custom/`) | `9c707a30fe1cb4b97e44c356afef8b77f926e13dcbff77c26dae2151016d6432` | Reemplaza (`1.1.1`→`1.2.0`) | gestionado por el instalador de EspoCRM |
| 2 | `.../Resources/metadata/entityDefs/Meeting.json` | `/var/www/html/custom/Espo/Modules/GoogleCalendarSync/Resources/metadata/entityDefs/Meeting.json` | `ea220cadfdfc10d40fb0cb919d2e70c70e38f50c04935349561b6afb8f627184` | Reemplaza | `www-data:www-data`, `644` |
| 3 | `.../Resources/i18n/en_US/Meeting.json` | `.../Resources/i18n/en_US/Meeting.json` | `55be0e3da8dfc2f5a01aa44fc81bda13bc8a576c99d7b119ca49f95d7fc7d612` | Reemplaza | `www-data:www-data`, `644` |
| 4 | `.../Resources/i18n/es_ES/Meeting.json` | `.../Resources/i18n/es_ES/Meeting.json` | `0b8d555bcd8386a23fec37a5c475a007b3e7229487e283f0045e53ca4c2178c1` | Reemplaza | `www-data:www-data`, `644` |
| 5 | `.../Classes/SyncService.php` | `.../Classes/SyncService.php` | `a3654179fc212350a9958caaaafb08008cc52c1b20eb71b5c25fc3c5ea1ea1ea` | Reemplaza | `www-data:www-data`, `644` |
| 6 | `.../Classes/GoogleClientFactory.php` | `.../Classes/GoogleClientFactory.php` | `4c41a389d05eda2a03aa2aa60aeed5cd412395db0867b8766e1780077538fac8` | Reemplaza | `www-data:www-data`, `644` |
| 7 | `.../Hooks/Meeting/GcsPush.php` | `.../Hooks/Meeting/GcsPush.php` | `8c4c8d511b5ad519e399e69d63c3a67b5762551ea147e8e6752b927ca4f75f2a` | Reemplaza | `www-data:www-data`, `644` |
| 8 | `.../Hooks/Contact/GcsContactRename.php` | `.../Hooks/Contact/GcsContactRename.php` | `21f9a1ca910548ceef110e68af4a9b2eace829d6d3dcacdd7a4c69c886efe673` | Reemplaza | `www-data:www-data`, `644` |

Ningún archivo de `apps/web/` ni del módulo custom de Gapssa
(`extensions/espocrm/custom/...`) aparece en este manifiesto — ninguno se
toca en esta puerta (§7).

### 11.3 Orden seguro de ejecución

1. **Precondiciones de solo lectura** (mismo patrón que Puertas 3C/3D §3):
   `app-check` verde; `maintenanceMode` ausente/`NULL`;
   `gapssaBookingDecisionEnabled=false`; `ESPO_BOOKING_ADAPTER=simulated`;
   `gcsSyncStartAt` leído vía `Espo\Core\Utils\Config` real (§11.1);
   columna `c_excluir_google_calendar_sync` **no existe todavía**;
   `field_data` actual de `Portal GAPSSA API` y `Profesional Gapssa` =
   línea base declarada; `Meeting` activos=7/soft-deleted=4/totales=11;
   `gcs_event_link`=4; versión de extensión instalada=`1.1.1`. Cualquier
   discrepancia detiene la ejecución antes del paso 2.
2. **Backup completo** (§11.1).
3. **`maintenanceMode=true`** vía `ConfigWriter` nativo (mismo mecanismo
   ya usado en `docs/fase4b-puerta4-propuesta-v4.md` §3).
4. **Revalidar que ningún archivo vivo cambió desde el backup** —
   recomputar el SHA-256 de cada archivo del manifiesto (§11.2) contra el
   backup del paso 2, inmediatamente antes de copiar. Cualquier
   discrepancia es condición de parada (§11.7).
5. **Copiar metadata y código de la extensión conforme al manifiesto**
   (§11.2) — vía `make gcs-install` (`bin/command extension --file=...`,
   instalador atómico nativo de EspoCRM), nunca `docker cp` archivo a
   archivo suelto, que dejaría un estado intermedio con solo parte del
   ZIP aplicado.
6. **`php -l`** de todos los PHP vivos copiados, dentro del contenedor
   (mismo patrón que `make gcs-lint`).
7. **Validar todos los JSON vivos copiados** — parseo estricto, no solo
   "archivo no vacío".
8. **`bin/command rebuild`** (`make gcs-rebuild`) — crea la columna
   `c_excluir_google_calendar_sync`.
9. **Verificar columna**: `DESCRIBE meeting` → `c_excluir_google_calendar_sync
   tinyint(1) NOT NULL DEFAULT 0`.
10. **Verificar que los 11 `Meeting` históricos** (7 activos + 4
    soft-deleted, línea base del paso 1) tienen `false` — ninguno nace en
    `true` por el `ALTER TABLE`.
11. **Aplicar ACL permanente** (§11.4: `Portal GAPSSA API` `read:yes/
    edit:no`; `Profesional Gapssa` `read:no/edit:no`) vía `EntityManager`
    — nunca SQL directo, mismo mecanismo que Puertas 3C/3D.
12. **`bin/command clear-cache`** — obligatorio (lección de Puerta 3C
    §2.2: la compilación de ACL no se invalida sola tras un
    `saveEntity()` directo).
13. **Verificación real vía `AclManager::checkField()`** para ambos
    roles — confirma exactamente la tabla de §11.4; diff bit a bit contra
    el backup del paso 2 confirmando que ninguna otra clave de
    `field_data` cambió (mismo patrón que Puerta 3C §5).
14. **`make gcs-test` fuera del contenedor** — batería completa en verde
    contra el ZIP recién construido, antes de dar la Parte B por cerrada.
15. **`app-check`** + verificación funcional no destructiva (`make
    gcs-status`: cuenta, scheduled job, últimos jobs — sin crear ningún
    `Meeting` real).
16. **Restaurar `maintenanceMode` exactamente a su preimagen** —
    **ausente/`NULL`, no `false`** (lección de la Puerta 4,
    `docs/fase4b-puerta4-cierre.md`) — vía `ConfigWriter`.
17. **`app-check` final** — verde.

### 11.4 ACL permanente aplicada por esta parte

| Rol real | `cExcluirGoogleCalendarSync` (permanente) |
|---|---|
| Admin | Acceso estructural completo (sin cambio de ACL) |
| `Portal GAPSSA API` (`6a7b345b239b2ed26`) | `{read: yes, edit: no}` |
| `Profesional Gapssa` (`6a7361290526f104b`) | `{read: no, edit: no}` |
| Anónimo | Sin acceso |

**`edit:yes` no queda permanente para ningún rol no-admin.** Justificación:

- `edit:yes` solo es necesario durante la ventana exacta de creación de
  los Fixtures A/B de la Puerta 5A (§12.1) — nunca en operación normal.
- Una API Key comprometida con `edit:yes` permanente podría excluir
  silenciosamente reservas normales de GCS: el campo no aparece en ningún
  layout (§6) y no genera ningún error visible, así que una exclusión
  maliciosa pasaría desapercibida hasta que alguien notara que una cita
  concreta dejó de sincronizarse.
- Que `apps/web` no exponga el campo (§6) no sustituye el mínimo
  privilegio del API User — es una capa adicional, no la única barrera.
- Esta Parte B despliega la **capacidad técnica** (columna, código, ACL
  de lectura), pero no habilita todavía su **uso** — habilitarlo es,
  explícitamente, la subpuerta separada §12.1, con su propia aprobación y
  su propia ventana temporal de `edit`.

### 11.5 Rollback — dos clases

**Clase 1 — antes de `rebuild` (durante los pasos 1–7 de §11.3, la
columna aún no existe)**: restaurar los archivos vivos exactamente desde
el backup byte a byte (§11.1); restaurar `maintenanceMode` a su preimagen
vía `ConfigWriter`; `app-check` verde. El ACL no llegó a tocarse en esta
clase, así que no requiere restauración.

**Clase 2 — después de crear la columna (desde el paso 8 en adelante)**:
restaurar el código de la extensión a la preimagen exacta del backup
(mismo mecanismo de instalación que el despliegue, aplicado en reversa);
restaurar `field_data` de ambos roles desde el backup (§11.1) vía
`EntityManager`, `clear-cache`, y reverificación con `AclManager` (mismo
patrón que Puerta 3C §6). **La columna `c_excluir_google_calendar_sync`
no se elimina automáticamente** — queda inerte, con `DEFAULT 0`, sin
ningún `Meeting` real dependiendo de que exista. Cualquier `DROP COLUMN`
es DDL destructivo e irreversible sobre datos reales y requiere una
autorización separada, nunca parte de un rollback automático.

### 11.6 Riesgos de la Parte B

- Ninguna escritura de esta parte tiene efecto sobre Google real por sí
  sola — la columna nueva y el ACL no sincronizan nada. El único riesgo es
  el de cualquier `rebuild`/cambio de ACL, ya cubierto por el patrón de
  las Puertas 3C/3D (compilación de ACL no invalidada sin `clear-cache`,
  backup/rollback ya probado).
- El campo por sí solo **no repara** el token OAuth caducado — eso sigue
  siendo la incidencia operativa separada documentada en el incidente de
  la Puerta 5A.
- **Riesgo retirado en esta revisión**: la versión anterior de esta
  propuesta dejaba `edit:yes` permanente para `Portal GAPSSA API`, lo que
  habría dejado una API Key comprometida con capacidad de excluir
  reservas reales de GCS de forma silenciosa (§11.4). La Parte B revisada
  ya no lo hace — ese riesgo se traslada, acotado en el tiempo, a la
  ventana temporal de la subpuerta §12.1, vigilada por sus propias
  condiciones de parada.

### 11.7 Condiciones de parada de la Parte B

- Cualquier discrepancia en las precondiciones de lectura del paso 1 de
  §11.3 (roles con `field_data` distinto del backup esperado, columna ya
  existente con un valor distinto de `DEFAULT 0`).
- Divergencia entre los hashes vivos y el backup antes de copiar (paso 4
  de §11.3).
- Configuración efectiva (vía `Espo\Core\Utils\Config`) distinta de la
  esperada en las precondiciones.
- `gcsSyncStartAt` no debe modificarse en ningún momento, aunque esté
  activo — cualquier escritura sobre esa clave detiene la Parte B de
  inmediato.
- `bin/command rebuild` termina con error o `app-check` deja de estar
  verde.
- Cualquier `Meeting` existente con valor `true` después del `rebuild`
  (paso 10 de §11.3).
- La extensión desplegada no coincide byte a byte con el manifiesto
  (§11.2) tras la copia.
- El ACL aplicado no coincide exactamente con la tabla de §11.4 al
  reverificar con `AclManager` (paso 13 de §11.3) — incluye explícitamente
  que `Portal GAPSSA API` termine con `edit:yes`.
- Cualquier job, `GcsEventLink` o llamada real a Google generado durante
  la Parte B — no debería producirse ninguno, al no crear ni tocar ningún
  `Meeting` real en esta parte.
- OAuth o tokens de la cuenta Business modificados — la Parte B no los
  toca.
- `maintenanceMode` no vuelve exactamente a su preimagen (paso 16 de
  §11.3) — activa el Rollback Clase 2 (§11.5) antes de considerar la
  Parte B cerrada.

### 11.8 Ejecución real — Parte B completada (2026-08-12, re-verificado 2026-08-13)

Aceptada como completada por autorización explícita. Todo lo listado a
continuación fue re-verificado de forma independiente en esta sesión
(2026-08-13) contra `gapssa-espocrm-1`/`gapssa-espocrm-db-1` reales, no
solo trasladado del informe de la sesión que ejecutó la Parte B.

**Backup real** — ruta no sobrescribible, confirmada en el contenedor:

```
/var/www/html/data/.backup/gapssa/puerta6/20260812T142434Z/
  archivos/{Classes,Hooks,Resources}/...   (preimagen byte a byte, v1.1.1)
  manifiesto-backup.json
  acl/portal-gapssa-api.field_data.json
  acl/profesional-gapssa.field_data.json
  meetings-snapshot.json
  config-efectiva-gcs.json
  README.md
```

**Archivos i18n** — `Resources/i18n/{en_US,es_ES}/Meeting.json` no
existían en la preimagen `1.1.1`; el propio `manifiesto-backup.json` los
marca como archivos nuevos, no reemplazos — confirmado también por
`git status` (`??`, no `M`, en el repositorio).

**Instalador nativo** — `bin/command extension` (vía `make gcs-install`)
reinstaló el módulo completo: **895 archivos** vivos bajo
`custom/Espo/Modules/GoogleCalendarSync` (recuento re-confirmado). Los 7
archivos que la Parte B reemplaza/añade coinciden **byte a byte** (SHA-256
idéntico) tanto con el manifiesto de §11.2 como con el árbol de trabajo
actual del repositorio:

| Archivo | SHA-256 (live = repo = manifiesto §11.2) |
|---|---|
| `Classes/SyncService.php` | `a3654179fc212350a9958caaaafb08008cc52c1b20eb71b5c25fc3c5ea1ea1ea` |
| `Classes/GoogleClientFactory.php` | `4c41a389d05eda2a03aa2aa60aeed5cd412395db0867b8766e1780077538fac8` |
| `Hooks/Meeting/GcsPush.php` | `8c4c8d511b5ad519e399e69d63c3a67b5762551ea147e8e6752b927ca4f75f2a` |
| `Hooks/Contact/GcsContactRename.php` | `21f9a1ca910548ceef110e68af4a9b2eace829d6d3dcacdd7a4c69c886efe673` |
| `Resources/metadata/entityDefs/Meeting.json` | `ea220cadfdfc10d40fb0cb919d2e70c70e38f50c04935349561b6afb8f627184` |
| `Resources/i18n/en_US/Meeting.json` | `55be0e3da8dfc2f5a01aa44fc81bda13bc8a576c99d7b119ca49f95d7fc7d612` |
| `Resources/i18n/es_ES/Meeting.json` | `0b8d555bcd8386a23fec37a5c475a007b3e7229487e283f0045e53ca4c2178c1` |

**Modo final** — `664`, propietario `www-data:www-data` en los archivos
verificados (mismo patrón para el resto del árbol de la extensión).

**Extensión instalada** — nueva fila en la tabla `extension`:
`id=6a7c85ea33e2f13b5`, `name=Google Calendar Sync`, `version=1.2.0`
(preimagen: `id=6a735492d326c5472`, `version=1.1.1`, ahora superada — el
historial de versiones `1.0.0`→`1.0.1`→`1.1.0`→`1.1.1`→`1.2.0` permanece
íntegro en la tabla).

**Columna y distribución final** — `DESCRIBE meeting` confirma
`c_excluir_google_calendar_sync tinyint(1) NOT NULL DEFAULT 0`. De los 11
`Meeting` históricos, **0** tienen el valor en `1` — ninguno nace excluido
por el `ALTER TABLE`, tal como exige §11.3 paso 10.

**ACL final** (`field_data`, releído en esta sesión vía consulta directa
al rol, no solo SQL crudo — coincide con lo que reportaría `AclManager`):

| Rol | `cExcluirGoogleCalendarSync` |
|---|---|
| `Portal GAPSSA API` (`6a7b345b239b2ed26`) | `{"read":"yes","edit":"no"}` |
| `Profesional Gapssa` (`6a7361290526f104b`) | `{"read":"no","edit":"no"}` |

Coincide exactamente con la tabla objetivo de §11.4 — sin `edit:yes`
permanente para ningún rol no-admin.

**Configuración efectiva** (vía `Espo\Core\Utils\Config`, no solo
`data/config.php` — lección de la Puerta 5A, §11.1):

- `maintenanceMode` = `null` (ausente, no `false`) ✅
- `gapssaBookingDecisionEnabled` = `false` ✅
- `gcsSyncStartAt` = `"2026-08-04 16:32:05"` — intacto, sin tocar ✅
- `ESPO_BOOKING_ADAPTER` — sigue `simulated` en todos los entornos reales;
  sin cambios (no forma parte de la configuración de EspoCRM, no aparece
  en `config.php`) ✅

**Conteos antes/después** (preimagen registrada en
`meetings-snapshot.json` del backup vs. estado actual re-consultado):

| Métrica | Antes (backup, 2026-08-12T14:26:05Z) | Después (re-verificado 2026-08-13) |
|---|---|---|
| `Meeting` activos | 7 | 7 |
| `Meeting` soft-deleted | 4 | 4 |
| `Meeting` totales | 11 | 11 |
| `gcs_event_link` | 4 | 4 |
| `gapssa_meeting_decision_operation` | 0 | 0 |
| `Meeting` con `cExcluirGoogleCalendarSync=1` | 0 (columna no existía) | 0 |
| Fixture A (Puerta 5A) | soft-deleted, `id=6a7c63799527a4746` | soft-deleted, sin cambio |
| Fixture B (Puerta 5A) | inexistente | inexistente |

**Ausencia de efectos GCS** — cero `Meeting`s excluidos, `gcs_event_link`
sin variación (4→4), ningún job GCS nuevo asociado a esta Parte B, ningún
cambio en `gcsSyncStartAt` ni en las credenciales OAuth. La Parte B es
puramente estructural (columna + código + ACL de lectura), sin efecto
sobre la sincronización real, tal como exige §11.6.

**Puerta 6, Parte B: completada.** Puerta 5A permanece **bloqueada**: la
subpuerta §12.1 (5A-1-apertura) no se ha autorizado ni ejecutado — la
capacidad técnica existe, pero su uso (fijar `true` en un `Meeting` real)
requiere su propia autorización explícita y separada, según §12.

## 12. Parte C — reanudación de Puerta 5A (bloqueada, requiere decisión aparte)

**No se reanuda aquí.** Esta puerta entrega el mecanismo; usarlo para
reanudar el Bloque 5A-1 (crear los Fixtures A/B con
`cExcluirGoogleCalendarSync=true`) es una decisión separada, posterior a
que la Parte B esté aprobada y ejecutada contra `gapssa-espocrm-1` real. Tal
como exigiste: no se propone reanudar apoyándose en que el token OAuth roto
"protegía" — con este campo, la protección es real y no depende del estado
del token.

### 12.1 Subpuerta 5A-1-apertura — ventana temporal de `edit` para los Fixtures A/B (propuesta, separada, todavía NO autorizada)

Distinta de la Parte B (§11): la Parte B deja el ACL **permanente** en
`edit:no` (§11.4). Esta subpuerta es el único mecanismo previsto para que
`Portal GAPSSA API` pueda fijar `cExcluirGoogleCalendarSync=true` al crear
los Fixtures A/B del Bloque 5A-1 — abre `edit` durante una ventana exacta,
la usa una vez, y la cierra antes de ceder el turno a la pausa humana.
Requiere su propia aprobación explícita, posterior a que la Parte B esté
aprobada y ejecutada. **Nada de lo siguiente se ejecuta en esta revisión.**

1. **Revalidar la configuración efectiva** vía `Espo\Core\Utils\Config`
   (`$container->get('config')->get('...')`, nunca solo `data/config.php`
   — misma lección del incidente de la Puerta 5A,
   `docs/fase4b-puerta5-propuesta-v3.md` §"Incidente" §0.2): confirmar
   `gapssaBookingDecisionEnabled=false`, `ESPO_BOOKING_ADAPTER=simulated`,
   y el estado real de `gcsSyncStartAt`/cuenta Business — sin asumir que
   el token OAuth caducado protege nada (bloqueo explícito de ese mismo
   documento, §0.6).
2. **Backup de `field_data`** del rol `Portal GAPSSA API`
   (`6a7b345b239b2ed26`) — mismo mecanismo exacto que Puerta 3C §4 paso 1
   (JSON textual completo, SHA-256, solo lectura, antes de tocar nada).
3. **Cambiar exclusivamente** `cExcluirGoogleCalendarSync.edit: no → yes`
   en ese `field_data` — ninguna otra clave tocada, misma mutación mínima
   que Puerta 3C §4 paso 3.
4. **`bin/command clear-cache`** — obligatorio, misma lección de Puerta
   3C §2.2 (la compilación de ACL no se invalida sola tras un
   `saveEntity()` directo).
5. **Verificar vía `AclManager`** (nunca solo SQL) que el nivel de campo
   efectivo para `portal-gapssa-api` es ahora `edit: yes`, y que ninguna
   otra clave de `field_data` cambió — diff bit a bit contra el backup del
   paso 2, mismo patrón que Puerta 3C §5.
6. **Crear únicamente los Fixtures A/B** con el campo `true` explícito en
   el propio `POST /api/v1/Meeting` — el Bloque 5A-1 tal como lo define
   `docs/fase4b-puerta5-propuesta-v3.md` §2.3 (Paso B), con esta única
   diferencia respecto a la propuesta original. Ningún otro `Meeting` se
   crea en esta subpuerta.
7. **Confirmar, para cada Fixture, los cuatro invariantes exigidos**
   (cualquier fallo es condición de parada inmediata y bloquea el paso 8):
   - el valor `true` quedó persistido (releído por API o por
     `EntityManager`, nunca asumido);
   - no se encoló ningún job `GcsPush*` para ese `Meeting` (consulta
     directa a `job`/`make gcs-status`, filtrando por el `id` del
     Fixture);
   - no apareció ninguna fila `GcsEventLink` para ese `Meeting`;
   - no hubo tráfico hacia `googleapis.com`/`oauth2.googleapis.com`
     atribuible a este `Meeting` — verificado contra logs reales, no hay
     `MockHandler` posible contra la instancia real (a diferencia del
     ensayo desechable de §9.2).
8. **Restaurar inmediatamente** `cExcluirGoogleCalendarSync.edit: yes → no`
   — antes de ceder el turno a la pausa humana obligatoria del Bloque
   5A-1 (`docs/fase4b-puerta5-propuesta-v3.md` §3). La ventana de
   `edit:yes` dura exactamente el tiempo entre el paso 4 y este paso,
   nunca más.
9. **`bin/command clear-cache`** de nuevo, y **reverificación vía
   `AclManager`** de que `portal-gapssa-api` volvió exactamente a
   `edit: no` — mismo patrón del paso 5, en sentido inverso.
10. **La pausa humana del Bloque 5A-1 debe comenzar con `edit:no` ya
    confirmado y restaurado** — nunca con la ventana todavía abierta.

**Condición de parada específica de esta subpuerta**: si la restauración
de ACL de los pasos 8/9 falla —`saveEntity()` no persiste, `clear-cache`
no surte efecto, o `AclManager` sigue devolviendo `edit: yes` tras
reintentar— la Puerta 5A **queda bloqueada** de inmediato: no se avanza a
la pausa humana, y **no se activa `PutDecide`** bajo ninguna circunstancia
mientras el ACL no quede confirmado restaurado. Más estricto que una
condición de parada ordinaria: no basta con detenerse, hay que confirmar
el estado seguro (`edit:no`) antes de considerar cualquier paso siguiente,
incluida la propia pausa de inspección.

#### 12.1.1 Ejecución real — subpuerta 5A-1-apertura completada (2026-08-12/13)

Ejecutada contra `gapssa-espocrm-1` real por autorización explícita, tras
revalidar todas las precondiciones (§12.1 punto 1) contra la configuración
efectiva real: `app-check` verde, `maintenanceMode=null`,
`gapssaBookingDecisionEnabled=false`, `ESPO_BOOKING_ADAPTER=simulated`
(`.env`), `gcsSyncStartAt="2026-08-04 16:32:05"` intacto,
`c_excluir_google_calendar_sync tinyint(1) NOT NULL DEFAULT 0`, 11
`Meeting` históricos (7 activos/4 soft-deleted) con `false`, Fixture A
antiguo (`6a7c63799527a4746`) únicamente soft-deleted, Fixture B ausente,
`gcs_event_link=4`, cero jobs GCS reintentables, usuario técnico
`tecnico-puerta5-asignacion` (`6a7c5d4868f7a2699`) activo, equipo técnico
"Asignación Portal GAPSSA" con 3 miembros y 0 `role_team`, ACL de partida
`Portal GAPSSA API` `{read:yes, edit:no}` / `Profesional Gapssa`
`{read:no, edit:no}`. `GcsAccount` Business en `status=Error`
(`invalid_grant`, incidente ya documentado en
`docs/fase4b-puerta5-propuesta-v3.md`) — estado conocido, no bloqueante,
y no usado como mecanismo de aislamiento (la exclusión por campo es
independiente del token).

- **Backup de `field_data`** — `Portal GAPSSA API`, solo lectura, antes de
  tocar nada: SHA-256
  `300dda056ea52cc7ecdb8a8fb00687639f5d68647e9341861402e1acdeeb4dc0`,
  guardado en
  `/var/www/html/data/.backup/gapssa/puerta5-apertura/20260812T221459Z/portal-gapssa-api.field_data.pre.json`
  (modo `600`, propietario `www-data:www-data`).
- **Apertura ACL** — vía `EntityManager` (`Role::saveEntity`), nunca SQL
  directo. Diff estructural completo pre/post: **una única clave
  cambiada**, `Meeting.cExcluirGoogleCalendarSync.edit: no → yes`. Ninguna
  otra clave de `field_data` tocada. `clear-cache` ejecutado. Verificado
  vía `AclManager::checkField()` real (no solo SQL) sobre el usuario API
  real (`portal-gapssa-api`, `6a7b345b2624dbb56`): `read=true, edit=true`.
- **Fixture A** — `POST /api/v1/Meeting` con la API Key existente de
  `portal-gapssa-api` (nunca mostrada). Payload cerrado (mismo patrón que
  `docs/fase4b-puerta5-propuesta-v3.md` §2.3.3, con las diferencias
  exigidas por este encargo: `name` fijo, `assignedUserId` al usuario
  técnico, `cExcluirGoogleCalendarSync: true` explícito; `status` omitido
  a propósito — se deja derivar por `SyncEstadoReservaToStatus`, mismo
  mecanismo probado en la Puerta 5A). `dateStart`/`dateEnd` técnicos
  (`2026-06-15 09:00:00`/`09:15:00`, campos obligatorios del esquema, sin
  relación con una cita real). Respuesta `HTTP 200`, `id=6a7cf117522f19bcf`.
  Releído vía `GET` independiente (no el valor de la respuesta de
  creación): `cExcluirGoogleCalendarSync=true`,
  `cEstadoReserva=PendingCenterApproval`, `status=Planned` (derivado),
  `cMotivoResolucionReserva=null`, `contactsIds=[]`,
  `assignedUserId=6a7c5d4868f7a2699`. Cuatro invariantes confirmados: cero
  filas en `job` para ese `target_id`, cero filas en `gcs_event_link` para
  ese `meeting_id`, `gcs_account.last_error` sin cambio (mismo timestamp
  `2026-08-12 12:43:09 UTC` del incidente previo — ningún tráfico nuevo).
- **Fixture B** — mismo payload exacto (mismo `name` fijo, por diseño de
  este encargo), `id=6a7cf18e8d7531711` (único, distinto de A y del
  Fixture A eliminado). Respuesta `HTTP 200`. Mismos cuatro invariantes
  releídos y confirmados independientemente.
- **Cierre ACL** — inmediatamente tras verificar B. Vía `EntityManager`,
  única clave `Meeting.cExcluirGoogleCalendarSync.edit: yes → no`.
  `clear-cache` ejecutado. `AclManager::checkField()` confirma
  `read=true, edit=false`. `field_data` completo comparado contra la
  preimagen: **SHA-256 idéntico**
  (`300dda05...eeb4dc0`) — restauración exacta, ninguna otra clave
  afectada.
- **Verificación final** — dos `Meeting` activos y únicos con
  `cExcluirGoogleCalendarSync=1` (`6a7cf117522f19bcf`,
  `6a7cf18e8d7531711`), ambos `PendingCenterApproval`/`Planned`, ambos
  asignados al usuario técnico, cero contactos. Fixture A antiguo
  (`6a7c63799527a4746`) permanece soft-deleted, sin tocar. `Meeting`
  totales tras la subpuerta: 9 activos + 4 soft-deleted = 13 (los 11
  históricos intactos + los 2 Fixtures nuevos). `gcs_event_link` sin
  variación (4→4). `gapssa_meeting_decision_operation=0` (idempotencia sin
  cambio). `gapssaBookingDecisionEnabled=false`,
  `ESPO_BOOKING_ADAPTER=simulated`, `gcsSyncStartAt` y OAuth intactos. ACL
  permanente restaurada y verificada. `app-check` final: verde
  (migración/BD/`maintenanceMode`/cron, los cuatro en `OK`).
- **Cierre**: se cumplieron los pasos 1–10 de §12.1 en el orden exacto
  descrito. **Detenido aquí, tal como exige el encargo**: no se ha
  llamado a `PutDecide`, no se ha aprobado ni rechazado ningún Fixture, no
  se ha activado `gapssaBookingDecisionEnabled`, no se ha ejecutado el
  Bloque 5A-2, no se ha tocado OAuth ni `ESPO_BOOKING_ADAPTER`, no se han
  eliminado los Fixtures, no se ha retirado el usuario técnico, cero
  commits. Queda a la espera de inspección manual y autorización
  independiente para el Bloque 5A-2.

## 13. Riesgos generales de esta puerta (diseño/repositorio)

- El `DELETE` de limpieza de una transición `false→true` puede fallar sin
  reintento automático inmediato (mismo `attempts=0` que cualquier job de
  esta cola) — mitigado por el nuevo comportamiento de `sweep()` (§3, §5),
  que converge en el siguiente barrido (máx. 5 min).
- `setHttpClientOverride()` añade una superficie nueva a
  `GoogleClientFactory` — mitigado: `null` por defecto, ningún código de
  producción lo invoca (verificado: ningún archivo fuera de
  `tests/`/el ensayo lo llama), y aunque se invocara maliciosamente
  requeriría ya tener capacidad de ejecutar PHP arbitrario dentro del
  contenedor — en ese escenario el sistema ya estaría comprometido por
  completo, con o sin este método.

## 14. Condiciones de parada (de esta puerta, ya evaluadas)

Ninguna se activó — se listan para que quede constancia de qué se vigiló:

- `make gcs-test` en rojo → no ocurrió.
- El ensayo desechable dejando residuos → no ocurrió (§9.6).
- `gapssa-espocrm-1` con cualquier cambio detectable antes/después del
  ensayo → no ocurrió (§9.6, comparación campo a campo).
- Cualquier llamada real observada hacia `googleapis.com`/`oauth2.googleapis.com`
  durante el ensayo → estructuralmente imposible (`MockHandler` intercepta
  antes de cualquier E/S de red) y no se detectó ninguna.

## 15. Documentos modificados

- `docs/fase4b-puerta6-exclusion-gcs.md` (este documento). Sesión original:
  §1–§10 (diseño, implementación, ensayo desechable) — Parte A, aceptada
  como completada, sin cambios de fondo en esta revisión. Esta revisión:
  §4.1 (alcance exacto de la garantía de `pushMeeting()`), §5 (semántica
  completa del `DELETE` de limpieza), §6 (ACL permanente corregida), §11
  reescrito (backup byte a byte §11.1, manifiesto cerrado §11.2, orden
  seguro §11.3, ACL permanente §11.4, rollback en dos clases §11.5,
  riesgos §11.6, condiciones de parada §11.7), §12.1 nuevo (subpuerta
  5A-1-apertura).
- Ningún otro documento del repositorio se ha tocado en esta revisión —
  en particular, `docs/fase4b-puerta5-propuesta-v3.md` y
  `docs/fase4b-puerta5-gcs-fixtures.md` siguen exactamente como estaban;
  la referencia cruzada hacia esta puerta que mencionaba `docs/fase4b-puerta5-propuesta-v3.md`
  §0.6 (introducida en la sesión anterior) sigue vigente sin cambios.

## 16. Estado de git

Cero commits, en esta revisión y en la anterior. Único archivo tocado:
este documento (`docs/fase4b-puerta6-exclusion-gcs.md`). Ningún archivo
de código de la extensión ni de `apps/web/` se ha tocado en esta
revisión — es una actualización puramente documental. Ningún ACL real,
ninguna credencial, ningún `Meeting` real tocado.

---

**Entrega de esta revisión**: Parte A (§1–§10) sin cambios de fondo,
aceptada como completada. Se precisa el alcance exacto de la garantía de
`pushMeeting()` (§4.1) y la semántica completa del `DELETE` de limpieza
(§5), y se entrega la Parte B revisada (§11) con backup real byte a byte,
manifiesto cerrado con SHA-256 por archivo, orden seguro de 17 pasos, ACL
permanente sin `edit:yes` para ningún rol no-admin, rollback en dos clases
y condiciones de parada ampliadas — más una subpuerta nueva, separada y
todavía no autorizada, para la ventana temporal de los Fixtures A/B de la
Puerta 5A (§12.1). **Nada de esto se ha ejecutado**: sin despliegue contra
`gapssa-espocrm-1`, sin `rebuild`/`maintenanceMode`/ACL/copias reales, sin
`Meeting`s nuevos, sin `PutDecide`, sin renovación de OAuth, sin commits.
Queda a la espera de tu aprobación explícita y separada, primero para la
Parte B (§11) y, después, para la subpuerta 5A-1-apertura (§12.1).
