# Puerta 3C — propuesta: `Meeting.name` de `{read:no, edit:no}` a `{read:no, edit:yes}` para `Portal GAPSSA API`

**Nada de esto está ejecutado contra `gapssa-espocrm-1` real.** Propuesta
aparte, motivada por el bloqueo encontrado en la Puerta 5A (§0/§1 más
abajo) y validada mediante un ensayo desechable independiente (§2) — no
mediante ninguna operación contra la instancia real. Sin commits.

## 0. Motivación — bloqueo real encontrado en la Puerta 5A

El primer intento de creación de un fixture en la Puerta 5A (`POST
/api/v1/Meeting` vía `portal-gapssa-api`) fue rechazado por EspoCRM real
con:

```
HTTP 400
{"messageTranslation":{"label":"validationFailure","scope":null,"data":{"field":"name","type":"required"}}}
```

`Meeting.name` es un campo **obligatorio del propio entity def** de
EspoCRM — independiente de cualquier ACL de campo. El rol `Portal GAPSSA
API` (id `6a7b345b239b2ed26`) tiene hoy `Meeting.name` en `{read: no,
edit: no}` (confirmado por lectura directa de `role.field_data` en la
instancia real, Puerta 5A §Paso A): con `edit: no`, EspoCRM descarta el
valor de `name` del payload ANTES de la validación de campo obligatorio
(confirmado empíricamente en el ensayo desechable, §2.2 — enviar `name`
explícitamente no cambia el resultado mientras `edit` siga en `no`).

`HttpEspoBookingAdapter.createMeeting()` (`apps/web/src/server/booking/httpEspoAdapter.ts`)
ya se corrigió en el repositorio para enviar una constante técnica fija y
sin PII (`PORTAL_MEETING_NAME = 'Reserva portal GAPSSA'`) en cada
creación — pero esa corrección, por sí sola, **no basta** contra la
instancia real: mientras `Meeting.name` siga en `edit: no` para este rol,
EspoCRM seguirá descartando el campo y respondiendo el mismo `400`. Esta
puerta es la única vía para que la corrección del adaptador funcione
contra `gapssa-espocrm-1` real.

## 1. Alcance — exclusivamente esto, nada más

| Rol | Campo | Antes | Después |
|---|---|---|---|
| `Portal GAPSSA API` (`6a7b345b239b2ed26`) | `Meeting.name` | `{read: no, edit: no}` | `{read: no, edit: yes}` |

- **`Profesional Gapssa` (`6a7361290526f104b`): sin cambios** — no forma
  parte de esta propuesta, no se lee ni se escribe su `field_data`.
- **Administración/rol implícito de `admin`: sin cambios** — el admin ya
  bypasa cualquier ACL de campo por diseño nativo de EspoCRM (mismo
  principio que Puerta 4 v3 §2/§3); esta puerta no le añade ni le quita
  nada.
- **`read` permanece en `no`** — nunca se amplía a `yes`. Solo se toca
  `edit`. Ver `docs/fase4b-puerta5-propuesta-v3.md` (docblock de
  `PORTAL_MEETING_NAME` en `httpEspoAdapter.ts`) para la justificación
  completa de por qué `read` debe seguir bloqueado: evita exponer
  asuntos/nombres de `Meeting` reales (texto libre, creados desde la
  propia interfaz de EspoCRM) a un rol pensado únicamente para orquestar
  el flujo de reservas del portal.
- **Ningún otro scope, ningún otro campo, de ningún otro rol, se toca.**
  En particular: `Meeting.create` de scope permanece `yes` (ya lo era,
  no se re-declara); todos los demás campos prohibidos hoy para
  `Profesional Gapssa` (`cGapssaAccountId`, `cBookingRequestId`,
  `cMotivoResolucionReserva` — Puerta 3B/4) **continúan prohibidos**, sin
  tocarlos.
- **Ningún `Meeting` se crea durante esta puerta** — es exclusivamente un
  cambio de ACL sobre el rol.

## 2. Mecanismo — ya validado, no experimental

### 2.1 Ensayo desechable previo (evidencia, no ejecución real)

El mecanismo exacto de esta propuesta (`EntityManager`/`saveEntity()`
sobre la entidad `Role`, mutando únicamente
`fieldData.Meeting.name.edit`) se ejecutó y verificó de punta a punta
contra un EspoCRM 10.0.3 + MariaDB 11.4 **completamente desechable**
(misma imagen que producción, red/puertos/usuarios/API Key propios, sin
relación con `gapssa-espocrm-1`, destruido al terminar — cero
contenedores/redes/volúmenes residuales, verificado). Resultado:

- El diff programático entre `field_data` antes/después mostró
  **exactamente una clave modificada** (`Meeting.name.edit`: `no` →
  `yes`) — el resto, incluidas todas las demás entradas de `Meeting` y de
  cualquier otro scope, permaneció byte a byte idéntico.
- Tras el cambio, `POST /api/v1/Meeting` con
  `name: "Reserva portal GAPSSA"` vía el API User del ensayo devolvió
  `HTTP 200` — el `Meeting` se creó con `cEstadoReserva=PendingCenterApproval`,
  `status=Planned` (derivado automáticamente por `SyncEstadoReservaToStatus`),
  `cMotivoResolucionReserva=NULL`.
- **La respuesta del propio `POST`, y cualquier `GET` posterior del
  mismo API User (incluso pidiendo `name` explícitamente en `select=`),
  nunca incluyó `name`** — confirmado que `read: no` se mantiene efectivo
  tras el cambio.
- Un `GET` como el admin ficticio del ensayo **sí** devolvió
  `name: "Reserva portal GAPSSA"` — confirma que el dato existe y es
  legible por quien deba serlo, solo bloqueado para este rol concreto.
- `PUT /api/v1/Meeting/{id}` genérico intentando `cEstadoReserva=Confirmed`
  siguió bloqueado (`409 meeting_decision_requires_atomic_action`) — el
  cambio de ACL de `name` no afecta a `GuardMeetingDecisionTransition`.
- `PUT /api/v1/GapssaMeetingDecision/{id}` (`PutDecide`) siguió bloqueado
  (`503 meeting_decision_disabled`, el flag nunca se activó en el
  ensayo) — el cambio de ACL de `name` no afecta al interruptor de la
  Puerta 4.

### 2.2 Lección operativa del ensayo — cache de ACL

`bin/command clear-cache` (no hace falta un `rebuild` completo) es
**obligatorio** después de guardar el rol para que el cambio de
`field_data` surta efecto — EspoCRM mantiene una compilación de ACL en
`data/cache/application/{acl,aclMap,entityAcl.php}` que **no** se
invalida automáticamente al hacer `saveEntity()` sobre `Role` en este
mecanismo de script directo (a diferencia de un guardado vía la propia
UI de Administración, que sí dispara la invalidación como parte del
ciclo de vida normal de la petición HTTP). Confirmado en el ensayo:
inmediatamente después de `saveEntity()`, sin `clear-cache`, el `POST`
seguía devolviendo el comportamiento ANTERIOR al cambio — `AclManager`
devolvía el valor cacheado, no el recién guardado. Este paso queda
incluido explícitamente en el procedimiento (§4, fase 4).

## 3. Precondiciones (solo lectura, antes de tocar nada)

| # | Comprobación | Método | Esperado |
|---|---|---|---|
| 1 | `app-check` | `docker compose exec espocrm bin/command app-check` | Verde |
| 2 | `maintenanceMode` | Lectura de `data/config.php` | `NULL` |
| 3 | `gapssaBookingDecisionEnabled` | Misma lectura | `false` |
| 4 | `Meeting.name` actual para `Portal GAPSSA API` | `SELECT field_data FROM role WHERE id="6a7b345b239b2ed26";` | `{"read":"no","edit":"no"}` — si ya no lo es, condición de parada (alguien más lo cambió) |
| 5 | `Meeting.name` actual para `Profesional Gapssa` | `SELECT field_data FROM role WHERE id="6a7361290526f104b";` | Lo que sea que tenga hoy — se registra como línea base, no se toca |
| 6 | `Meeting` reales | `SELECT COUNT(*) FROM meeting WHERE deleted=0; SELECT COUNT(*) FROM meeting;` | Línea base declarada (Puerta 5A): 7 activos, 10 históricos — se reconfirma aquí, no se asume |
| 7 | `gapssa_meeting_decision_operation` | `SELECT COUNT(*) FROM gapssa_meeting_decision_operation;` | `0` |

Cualquier discrepancia detiene la ejecución antes de §4.

## 4. Procedimiento

1. **Backup exacto** de `role.field_data` del rol `Portal GAPSSA API` —
   copia textual del JSON actual (vía `SELECT field_data FROM role WHERE
   id="6a7b345b239b2ed26";`, solo lectura), guardada aparte con hash
   SHA-256 del texto exacto. Este es el valor de rollback (§6) — nunca
   una reconstrucción manual del JSON.
2. **Cargar la entidad `Role` vía `EntityManager`** (mismo mecanismo
   nativo que la Puerta 3B real, `docs/fase4b-decision-flow-final.md`):
   `$role = $entityManager->getRDBRepositoryByClass(Role::class)->getById('6a7b345b239b2ed26');`.
   Nunca reconstruir el objeto `fieldData` a mano — se parte siempre del
   objeto real ya cargado, para no arriesgar perder una clave existente.
3. **Mutación mínima**: `$fieldData = $role->get('fieldData');
   $fieldData->Meeting->name->edit = 'yes'; $role->set('fieldData',
   $fieldData); $entityManager->saveEntity($role);` — ninguna otra clave
   tocada, ni siquiera `Meeting.name.read` (permanece `'no'`, sin
   reescribirlo explícitamente aunque el valor no cambie, para minimizar
   el diff).
4. **`bin/command clear-cache`** — obligatorio, ver §2.2. Sin este paso,
   la verificación de §5 daría un falso negativo (o, peor, un falso
   positivo si se verificara solo contra SQL en vez de contra
   `AclManager`).
5. **Verificación mediante `AclManager`** (no solo SQL — ver §2.2, la
   lección del ensayo): script que instancia
   `Espo\Core\AclManager` (vía `Application::getInjectableFactory()` o
   equivalente) y confirma, para un usuario real del rol `Portal GAPSSA
   API` (`portal-gapssa-api`, id `6a7b345b2624dbb56`):
   - Nivel de campo efectivo de `Meeting.name` = `edit: yes`, `read: no`
     (vía la API pública de `AclManager`/`Acl` para niveles de campo, no
     leyendo `field_data` crudo — eso ya se hizo en el paso 1/backup, este
     paso confirma que el *runtime* lo refleja).
   - `Meeting.create` de scope sigue en `yes` (sin cambios, se reconfirma
     para descartar un efecto colateral).
6. **`app-check`** final — verde.

## 5. Verificación de preservación bit a bit

Diff programático (mismo patrón usado en el ensayo, §2.1) entre el
`field_data` de backup (paso 1) y el `field_data` releído tras el cambio:
**se exige que la única diferencia sea exactamente
`['Meeting','name','edit']: 'no' -> 'yes'`** — cualquier otra diferencia,
por mínima que sea, es una condición de parada y revierte inmediatamente
(§6).

También se confirma, por lectura directa, que:
- `role.data` (ACL de scope) del mismo rol no cambió en ningún byte.
- `field_data` del rol `Profesional Gapssa` no cambió en ningún byte
  (no se ha tocado ese rol en absoluto).

## 6. Rollback exacto

Restaurar el JSON exacto capturado en el paso 1 de §4
(`$role->set('fieldData', json_decode($backupJson)); $entityManager->saveEntity($role);`),
seguido de `bin/command clear-cache` (mismo motivo que la fase 4 — sin
esto, el rollback tampoco surtiría efecto en runtime) y una repetición
del diff de §5 confirmando que `Meeting.name` vuelve exactamente a
`{read: no, edit: no}` y que ninguna otra clave quedó alterada respecto
al backup original.

## 7. Condiciones de parada

- Cualquier discrepancia en las precondiciones de §3.
- El diff de §5 muestra cualquier cambio distinto del único esperado.
- La verificación vía `AclManager` (paso 5 de §4) no refleja `edit: yes`
  tras `clear-cache`.
- `app-check` no queda verde al terminar.
- Cualquier `Meeting` creado, modificado o eliminado durante esta puerta
  (no debería haber ninguno — si lo hay, es una señal de que algo más
  ocurrió de forma no controlada).

## 8. Qué NO cubre esta puerta

- No crea ningún `Meeting` — eso vuelve a ser el Paso B de la Puerta 5A,
  a reanudar aparte, con su propia autorización, una vez esta puerta esté
  aprobada y ejecutada.
- No cambia `ESPO_BOOKING_ADAPTER`.
- No activa `gapssaBookingDecisionEnabled`.
- No toca `Profesional Gapssa` ni ningún otro rol.
- No es la Puerta 5B — sigue sin ejecutarse ninguna llamada del BFF a
  EspoCRM real.

---

**Queda a la espera de tu aprobación explícita, separada de la de la
Puerta 5A**, antes de ejecutar cualquier parte de §4 contra
`gapssa-espocrm-1` real.
