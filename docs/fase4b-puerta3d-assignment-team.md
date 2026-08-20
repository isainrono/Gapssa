# Puerta 3D — propuesta: `assignmentPermission` de `no` a `team` para `Portal GAPSSA API`, vía un equipo técnico sin rol adjunto

**Nada de esto está ejecutado contra `gapssa-espocrm-1` real.** Propuesta
aparte, motivada por el bloqueo encontrado en el segundo intento de Fixture
A de la Puerta 5A (§1 más abajo) y validada mediante una auditoría de solo
lectura del núcleo real de EspoCRM (§2) y un ensayo desechable independiente
(§3) — ninguna operación contra la instancia real. Sin commits de
infraestructura EspoCRM; sí se añadieron pruebas de solo repositorio (§6),
descritas ahí.

## 1. Motivación — segundo bloqueo real, distinto del de la Puerta 3C

Con la Puerta 3C ya cerrada (`Meeting.name` en `{read: no, edit: yes}` para
`Portal GAPSSA API`), el segundo intento de Fixture A (`POST
/api/v1/Meeting` vía `portal-gapssa-api`, `assignedUserId` = admin técnico)
fue rechazado por EspoCRM real con:

```
HTTP 403
X-Status-Reason: Assignment failure: assigned user or team not allowed.
```

Ningún registro se creó (activos=7/históricos=10 confirmados sin cambios
antes y después). Causa raíz confirmada por lectura directa, solo lectura,
contra `gapssa-espocrm-1` real:

| Comprobación | Resultado real |
|---|---|
| `role.assignment_permission` (columna dedicada, ver §2.1) de `Portal GAPSSA API` (`6a7b345b239b2ed26`) | `no` |
| `portal-gapssa-api` (`6a7b345b2624dbb56`) pertenece a algún equipo | No (`team_user`: 0 filas) |
| `Meeting.create` de scope | `yes` (sin cambios, no es la causa) |
| `Meeting.name` | `{read: no, edit: yes}` (Puerta 3C, sin cambios, no es la causa) |

`assignmentPermission=no` significa, por diseño de EspoCRM (§2.2): un actor
solo puede asignar un registro **a sí mismo**. Como `portal-gapssa-api`
nunca debe asignar `Meeting` a sí mismo (el `assignedUserId` debe ser
siempre el profesional real que atiende la cita), este bloqueo es
estructural, no un error de configuración puntual — y afecta también a la
futura Puerta 5B: `HttpEspoBookingAdapter.createMeeting()`
(`apps/web/src/server/booking/httpEspoAdapter.ts:595`) usa
`input.professionalId` directamente como `assignedUserId` en el `POST`.

## 2. Auditoría real de solo lectura — semántica de `assignmentPermission`

Todo lo siguiente se leyó directamente del núcleo real de EspoCRM 10.0.3
dentro de `gapssa-espocrm-1` (`application/Espo/Core/...`) — nunca de
documentación pública genérica. Ningún archivo se modificó.

### 2.1 Mecanismo de almacenamiento — hallazgo clave, distinto de la Puerta 3C

A diferencia de `Meeting.name` (Puerta 3C, dentro de `role.field_data`
JSON), `assignmentPermission` **no** vive dentro de `role.data` ni
`role.field_data`. Es un **atributo propio de la entidad `Role`**
(`entityDefs/Role.json`: `"assignmentPermission": {"type": "enum",
"options": ["not-set","all","team","no"], "default":"not-set"}`), respaldado
por una **columna SQL dedicada**: `role.assignment_permission` (`varchar`,
`DESCRIBE role` confirmado contra la instancia real). `RoleEntityWrapper::
getPermissionLevel()` (`Core/Acl/Table/RoleEntityWrapper.php:53`) lee
literalmente `$this->entity->get('assignmentPermission')` — un `set()`
dentro de `data`/`field_data` (el patrón de la Puerta 3C) **no tiene ningún
efecto** sobre este permiso. Confirmado empíricamente en el ensayo (§3.2):
intentarlo así deja el nivel efectivo en `no` pase lo que pase.

Consecuencia directa para el mecanismo de escritura de la Puerta 3D (§5):
el backup/rollback debe operar sobre el **atributo `assignmentPermission`**
del `Role` (columna `assignment_permission`), no sobre el JSON de
`field_data`.

Valores reales confirmados (solo lectura):

| Rol | `assignment_permission` |
|---|---|
| `Portal GAPSSA API` (`6a7b345b239b2ed26`) | `no` |
| `Profesional Gapssa` (`6a7361290526f104b`) | `team` |

### 2.2 Semántica exacta de `no`/`team`/`all` (`AclManager`/`Acl\AssignmentChecker\Helper`)

- **Auto-asignación siempre permitida, cualquiera que sea el nivel**:
  `AclManager::checkUserPermission()` (`Core/AclManager.php:602`) comprueba
  `$user->getId() === $userId` **antes** de mirar el nivel de permiso — un
  actor siempre puede asignarse un registro a sí mismo, incluso con
  `assignmentPermission=no`. Esto es universal (aplica también a un API
  User) — confirmado en el ensayo (caso 6, §3.3).
- **`no`**: para cualquier destino que no sea el propio actor, denegado
  siempre — confirmado (casos 1/2, §3.3).
- **`team`**: permitido solo si actor y destino comparten al menos un
  equipo — `checkBelongsToAnyOfTeams($assignedUserId, $actorTeamIdList)`
  (`Core/Acl/AssignmentChecker/Helper.php:107`). El orden de evaluación real
  es: `assignedUser` → `teams` (campo `teams` de la propia entidad, si
  existe) → `assignedUsers`/`collaborators` (si el entityDef los define) —
  `Core/Acl/DefaultAssignmentChecker.php:52`. Confirmado (casos 2/3/4, §3.3).
- **`all`**: sin restricción, cualquiera que sea el equipo del destino —
  confirmado (caso 5, §3.3).
- **`assignedUserId` ausente**: `Acl\AssignmentChecker\Helper::
  checkAssignedUser()` (línea 90) tiene un caso especial — si el actor es un
  API User (`$user->isApi()`) y `assignmentPermission=no`, omitir
  `assignedUserId` SÍ está permitido a nivel de ACL (a diferencia de un
  usuario no-API, para quien se deniega). **Pero para `Meeting` esto nunca
  llega a aplicarse**: el propio `entityDef` de `Meeting` marca
  `assignedUser` como campo obligatorio, así que la petición falla antes con
  `400 Field validation failure ... type: required` — confirmado (caso 7,
  §3.3). Documentado aquí porque es una peculiaridad real del núcleo, no
  porque cambie la propuesta.
- **Comprobación independiente de acceso al registro `User` destino**:
  además de `assignmentPermission`, EspoCRM exige que el actor pueda LEER el
  registro `User` al que apunta `assignedUserId` (comprobación genérica de
  acceso a enlace foráneo, `"No foreign record access for link operation
  (Meeting:assignedUser)"`). `Portal GAPSSA API` ya tiene `User: {read:
  all}` en `role.data` (confirmado por lectura directa, sin relación con
  Puerta 3C/3D) — esta comprobación YA está satisfecha hoy y esta puerta no
  la toca.
- **Mensaje `"Assignment failure: assigned user or team not allowed."`**:
  se lanza desde `Espo\Core\Record\Service::processAssignmentCheck()`
  (línea 357) cuando `checkAssignment()` devuelve `false` — el mismo punto
  para el fallo real de la Puerta 5A.

### 2.3 Fusión de permisos por equipo — la ruta exacta del riesgo (§4)

`Acl\Table\DefaultTable::load()` (`Core/Acl/Table/DefaultTable.php:190`)
construye el conjunto de roles efectivos de un usuario iterando
`$this->roleListProvider->get()`, que devuelve la **unión** de: (a) los
roles asignados directamente (`role_user`) y (b) los roles asignados a
**cada equipo** del que el usuario es miembro (`role_team`) — sin
distinción entre ambos orígenes en el resultado final. Un equipo sin
ninguna fila en `role_team` no aporta ningún rol adicional a sus miembros;
un equipo CON una fila en `role_team` sí lo hace, automáticamente, para
todo miembro nuevo o existente.

## 3. Auditoría de equipos reales (sin PII) y ensayo desechable

### 3.1 Auditoría real (solo lectura, IDs técnicos, sin nombres/correos/teléfonos)

| Comprobación | Resultado |
|---|---|
| Equipos existentes en `gapssa-espocrm-1` | 1 — `Gapssa` (`6a7360a9270359f49`) |
| Miembros activos de `Gapssa` | 1 — `6a71e26f5a32d9575` (`type=regular`, `is_active=1`) |
| `role_team` de `Gapssa` | 1 fila — rol `Profesional Gapssa` (`6a7361290526f104b`) adjunto |
| `portal-gapssa-api` (`6a7b345b2624dbb56`) miembro de algún equipo | No |
| `admin` (`6a70ac4451597eea8`) miembro de algún equipo | No |
| Usuarios `type=regular`, `is_active=1` en toda la instancia | Exactamente 1 — `6a71e26f5a32d9575` (coincide con el único profesional del negocio, `PROJECT_CONTEXT.md`) |
| Roles directos (`role_user`) de `portal-gapssa-api` | Exactamente 1 — `Portal GAPSSA API` (sin roles adicionales) |
| `ESPOCRM_PROFESSIONAL_USER_IDS` en `.env` real | No configurado (comentado en `.env.example`; solo obligatorio cuando `ESPO_BOOKING_ADAPTER=http` — hoy `simulated`). El valor usado en pruebas contractuales del adaptador (`env.test.ts:288`) es `6a71e26f5a32d9575` — coincide exactamente con el único miembro real de `Gapssa` |

**Conclusión directa (punto 5 del encargo)**: unir `portal-gapssa-api` al
equipo real `Gapssa` le haría heredar el rol `Profesional Gapssa` completo
(lectura/escritura de `Contact`, campos hoy prohibidos para el API User,
etc.) — inaceptable. Solución A del encargo (unir al equipo existente)
**queda descartada**. Se estudia en su lugar un equipo técnico separado
(§3.3, caso 4, y §4).

### 3.2 Topología del ensayo desechable

Igual patrón que `docs/fase4b-occ-rehearsal.md` — proyecto Docker Compose
separado, sin relación con `gapssa`:

| | Real (`gapssa`) | Desechable (este ensayo) |
|---|---|---|
| Proyecto Compose | `gapssa` | `gapssa-puerta3d-rehearsal` |
| Contenedores | `gapssa-espocrm-1`, `gapssa-espocrm-db-1` | `gapssa-puerta3d-rehearsal-espocrm-1`, `...-espocrm-db-1` |
| Red | `gapssa_public`/`gapssa_private` | `gapssa-puerta3d-rehearsal-net` (única) |
| Volúmenes | `gapssa_espocrm-*` | `gapssa-puerta3d-rehearsal-*` (4 volúmenes) |
| Puerto HTTP | `8081` (`0.0.0.0`) | `18082`, atado solo a `127.0.0.1` |
| Base de datos | `espocrm`/`espocrm` | `puerta3d_rehearsal`/`puerta3d_rehearsal` |
| Credenciales | reales, `.env` (nunca leído) | generadas con `openssl rand -hex 12`, exclusivas, nunca reutilizadas |
| Imágenes | — | `espocrm/espocrm:10.0.3-apache-trixie` + `mariadb:11.4`, idénticas a la real |

Solo `espocrm` + `espocrm-db` (sin `daemon`/`websocket`, innecesarios para
probar ACL vía API síncrona). Config validada (`docker compose ... config`)
antes de levantar nada. Al terminar (§3.4): `down -v` con el nombre de
proyecto explícito, y verificación de que no queda ningún contenedor, red o
volumen con prefijo `gapssa-puerta3d-rehearsal` — confirmado, cero residuos.
El stack real (`gapssa-espocrm-1`, mismo uptime de 8 días/2 días activo
antes y después) quedó intacto en todo momento.

### 3.3 Matriz de pruebas y resultados

Fixtures del ensayo (roles/equipos/usuarios ficticios, sin ninguna relación
con IDs reales): rol `RoleHuman` (con `Contact.read=all`, simulando un rol
"humano" con permisos amplios, análogo a `Profesional Gapssa`), roles
`RoleNo`/`RoleTeam`/`RoleAll` (cada uno con `Meeting.create=yes`,
`Meeting.name.edit=yes`, `User.read=all` — igual que el `Portal GAPSSA API`
real tras la Puerta 3C — y `assignmentPermission` fijado como atributo
directo, no dentro de `data`, corrigiendo el hallazgo de §2.1), equipo
`TeamSharedNoRole` (sin `role_team`), equipo `TeamSharedWithRole` (con
`RoleHuman` adjunto vía `role_team`), tres API Users (`api-no`/`api-team`/
`api-all`, cada uno con un único rol directo) y tres usuarios regulares
destino (`target-no-team`, `target-shared-no-role` — miembro solo de
`TeamSharedNoRole` —, `target-shared-with-role` — miembro solo de
`TeamSharedWithRole`).

| # | Caso | Resultado | Conforme a §2.2 |
|---|---|---|---|
| 1 | `no` + sin equipo compartido | `403` Assignment failure | Sí |
| 2 | `team` + sin equipo compartido | `403` Assignment failure | Sí |
| 3 | `team` + equipo compartido **sin** rol adjunto | `200`, creado | Sí — caso objetivo de la propuesta |
| 4 | `team` + equipo compartido **con** rol humano adjunto | `200`, creado — **pero el actor (`api-team`) resultó con `Contact.read=all` efectivo**, pese a que su único rol directo (`RoleTeam`) declara `Contact.read=no` | Confirma el riesgo de §2.3/§3.1 — descarta unir al equipo real |
| 5 | `all` | `200`, creado, sin restricción de equipo | Sí |
| 6 | `no` + `assignedUserId` = el propio API User | `200`, creado, autoasignado | Sí (autoasignación siempre permitida) |
| 7 | `no` + `assignedUserId` omitido | `400` Field validation failure (`assignedUser`, `required`) | Sí — el carve-out de `isApi()` nunca llega a aplicarse en `Meeting` (§2.2) |

**Verificación explícita del caso 4** (script de solo lectura vía
`AclManager::checkField()`): `api-team` tiene como único rol asignado
directamente `RoleTeam` (`Contact.read=no`), pero
`AclManager::getLevel($apiTeam, 'Contact', 'read')` devuelve `all` — la
única fuente posible es `TeamSharedWithRole`, que sí tiene `RoleHuman`
adjunto vía `role_team`. Prueba directa, contra un motor EspoCRM real, del
mecanismo descrito en §2.3.

Efectos colaterales verificados para el caso 3 (el diseño elegido, §4): el
`Meeting` creado queda con `assignedUserId` = el usuario destino esperado;
ningún otro campo ACL cambia; sin extensión Google Calendar Sync instalada
en el ensayo (deliberado, fuera de alcance) no hay ninguna llamada a Google
real — el ensayo nunca la ejercitó.

### 3.4 Cierre del ensayo

`docker compose -p gapssa-puerta3d-rehearsal ... down -v` — 2 contenedores,
1 red, 4 volúmenes eliminados. Verificación posterior
(`docker ps/network ls/volume ls --filter name=gapssa-puerta3d-rehearsal`):
listas vacías, cero residuos. Stack real `gapssa` verificado sin cambios
antes y después (mismos contenedores, mismo uptime).

## 4. Solución mínima segura — decisión

Confirmado viable (puntos A–D del encargo):

- **A (unir al equipo existente `Gapssa`)**: **rechazado** — hereda
  `Profesional Gapssa` (§3.1, §3.3 caso 4).
- **B (`assignmentPermission=no→team` en `Portal GAPSSA API`)**: viable,
  pero por sí solo no basta sin un equipo compartido seguro.
- **C (todos los IDs de `ESPOCRM_PROFESSIONAL_USER_IDS` en el mismo
  equipo)**: viable — hoy es un único ID (`6a71e26f5a32d9575`), ya miembro
  de `Gapssa`; se añadiría además a un **segundo** equipo técnico nuevo
  (nunca se le retira de `Gapssa`).
- **D (ningún rol humano/permiso adicional heredado por el API User)**:
  viable únicamente creando un equipo técnico **nuevo**, sin ninguna fila en
  `role_team` — demostrado seguro en el caso 3 del ensayo (§3.3): crear fue
  posible y, a diferencia del caso 4, no hay ningún rol adjunto a ese equipo
  que pudiera propagarse.

**Diseño propuesto**: un equipo técnico nuevo (nombre propuesto
`Asignación Portal GAPSSA` — a confirmar en la aprobación), **sin ninguna
fila en `role_team`**, con exactamente dos miembros:

| Miembro | Motivo |
|---|---|
| `portal-gapssa-api` (`6a7b345b2624dbb56`) | Actor que necesita `assignmentPermission=team` para poder asignar `Meeting` a un profesional |
| `6a71e26f5a32d9575` (único profesional activo, ya miembro de `Gapssa`) | Destino permitido — permanece además en `Gapssa` sin cambios |

Y el cambio de ACL: `Portal GAPSSA API`.`assignmentPermission`: `no` →
`team`.

Efecto esperado, ya demostrado en el ensayo (caso 3): `portal-gapssa-api`
podrá asignar `Meeting` únicamente a quien comparta con él este equipo
técnico (hoy, solo el profesional listado) — nunca a `admin` ni a ningún
otro usuario fuera de él — y no ganará ningún permiso adicional, porque el
equipo técnico no tiene ningún rol adjunto.

## 5. Revisión del adaptador (`HttpEspoBookingAdapter`) — punto 11/12 del encargo

`createMeeting()` (`httpEspoAdapter.ts:573`) usa `input.professionalId`
directamente como `assignedUserId`. Se trazó el origen de ese valor en las
dos únicas rutas que llaman a `createMeeting` (vía
`verificationSteps.ts::completeBookingToMeeting`, único llamante real):

- `guestFlow.ts::createGuestBooking` y
  `authenticatedFlow.ts::createAuthenticatedBooking` llaman ambos a
  `validateSlotRequest()` (`slotValidation.ts:46`) **antes** de persistir
  nada — que a su vez llama a `adapter.getProfessional(input.professionalId)`,
  el cual devuelve `null` (rechazado como `professional_not_found`) si el id
  no está en `config.professionalUserIds` (`httpEspoAdapter.ts:378`).
- El valor persistido (`professionalId`) y el que finalmente llega a
  `createMeeting()` (`record.professionalId`, `verificationSteps.ts:253`)
  es literalmente el mismo string `input.professionalId` que ya pasó esa
  comprobación — nunca se re-deriva ni se vuelve a leer del cliente entre
  medias.
- No existe ninguna otra ruta de código que llame a `createMeeting()`
  (`grep` sobre `apps/web/src/server/` confirmado — único llamante).

**Conclusión: no hay ningún hueco en el adaptador.** La allowlist
`ESPOCRM_PROFESSIONAL_USER_IDS` ya es una defensa completa y correcta —
ningún `professionalId` fuera de ella puede llegar nunca a un `POST
/api/v1/Meeting` real. No se implementó ningún cambio de código de
producción.

Sí se encontró un **hueco de cobertura de pruebas**: ni
`httpEspoAdapter.test.ts` ni las pruebas de integración cubrían
explícitamente este comportamiento (`getProfessional`/`listProfessionals`
con id fuera de la allowlist). Se añadió el describe `'profesionales:
allowlist ESPOCRM_PROFESSIONAL_USER_IDS'` en
`apps/web/src/server/booking/httpEspoAdapter.test.ts` (4 casos: id fuera de
la allowlist nunca llama a EspoCRM, id permitido sí resuelve, `listProfessionals`
nunca filtra hacia dentro un id no permitido, allowlist vacía no resuelve
nada) — 47/47 pruebas del archivo en verde tras el cambio.

**Combinación de las dos capas de defensa** (nunca una sustituye a la
otra):

1. **BFF (`ESPOCRM_PROFESSIONAL_USER_IDS`)**: rechaza la solicitud del
   cliente ANTES de llegar a EspoCRM — la única capa que puede dar un
   mensaje de error específico (`professional_not_found`) sin gastar una
   llamada HTTP a EspoCRM.
2. **EspoCRM (`assignmentPermission=team` + equipo técnico, esta puerta)**:
   rechaza en el propio EspoCRM cualquier intento de asignación que, por lo
   que sea (bug futuro del BFF, allowlist mal configurada, llamada directa a
   la API con la misma API Key desde otro contexto), se saltara la capa 1 —
   defensa en profundidad, nunca redundante.

## 6. Propuesta de procedimiento — Puerta 3D (a ejecutar solo con aprobación aparte)

1. **Precondiciones** (solo lectura): mismo patrón que Puerta 3C §3 —
   `app-check` verde, `maintenanceMode=NULL`, flag=false, adapter=simulated,
   `Portal GAPSSA API.assignment_permission=no` (releer, condición de parada
   si ya no lo es), `Gapssa` (`6a7360a9270359f49`) sigue con exactamente 1
   miembro y `role_team`→`Profesional Gapssa`, `portal-gapssa-api` y `admin`
   sin equipos, Meeting activos=7/históricos=10, ningún equipo con el nombre
   propuesto ya existe.
2. **Backup** (antes de tocar nada): `role.assignment_permission` exacto de
   `Portal GAPSSA API` (columna dedicada, no JSON — corrige el mecanismo de
   la Puerta 3C), `role.data`/`role.field_data` completos de `Portal GAPSSA
   API` (preservación bit a bit, igual que Puerta 3C), lista de
   `team_user` actual de `portal-gapssa-api` y del profesional
   (`6a71e26f5a32d9575`), mismo formato de directorio dedicado
   (`/var/www/html/data/.backup/gapssa/puerta3d/<timestamp-UTC>/`,
   `www-data:www-data`, permisos restrictivos, SHA-256, README).
3. **Creación del equipo técnico** vía `EntityManager` (mismo mecanismo
   nativo, `getRDBRepositoryByClass(Team::class)->getNew()`), nombre a
   confirmar en la aprobación, **sin** fijar `rolesIds` (ninguna fila en
   `role_team` — verificado como condición explícita, no solo por omisión).
4. **Membership**: añadir `portal-gapssa-api` y `6a71e26f5a32d9575` al
   equipo nuevo (`teamsIds` del usuario, cargado vía `EntityManager`, nunca
   reconstruido a mano) — **sin** tocar su membership existente en `Gapssa`.
5. **Mutación mínima del rol**: `$role->set('assignmentPermission',
   'team')` sobre el `Role` real cargado vía `EntityManager` — ningún otro
   atributo, `data` ni `field_data` tocado.
6. **`bin/command clear-cache`** — obligatorio (mismo motivo que Puerta 3C
   §2.2: la compilación de ACL no se invalida sola tras un `saveEntity`
   directo).
7. **Verificación real vía `AclManager`** (nunca solo SQL): para el usuario
   real `portal-gapssa-api`, `checkAssignmentPermission` hacia
   `6a71e26f5a32d9575` = `true`; hacia `admin` = `false`; hacia cualquier
   otro usuario fuera del equipo técnico = `false`.
8. **Preservación bit a bit**: diff estructural de `role.data`/
   `role.field_data` de `Portal GAPSSA API` (única diferencia permitida:
   ninguna — estos dos JSON no cambian en esta puerta, solo el atributo
   `assignmentPermission`); `Profesional Gapssa` sin ningún cambio;
   membership de `Gapssa` sin ningún cambio.
9. **Rollback exacto**: restaurar `assignment_permission` al valor de
   backup (`no`), despoblar el equipo técnico o eliminarlo (a decidir en la
   aprobación), `clear-cache`, reverificar `checkAssignmentPermission`
   hacia cualquier destino = `false` salvo autoasignación.
10. **Ningún `Meeting` se crea durante esta puerta.**

### Pruebas negativas a ejecutar tras la ejecución (§15 del encargo)

Todas vía `AclManager`/lectura, nunca `POST` reales adicionales más allá de
los ya reservados para el Paso B de la Puerta 5A:

- Asignar al profesional autorizado (`6a71e26f5a32d9575`) → permitido.
- Asignar a `admin` → denegado.
- Asignar a cualquier usuario fuera del equipo técnico → denegado.
- `Meeting.delete` → sigue `no` (sin relación con `assignmentPermission`,
  pero se reconfirma).
- Campos hoy prohibidos (`cGapssaAccountId`, `cBookingRequestId` en
  `Profesional Gapssa`; cualquier otro `field_data` de `Portal GAPSSA API`)
  → siguen prohibidos.

## 7. Qué NO cubre esta puerta

- No crea ningún `Meeting` — el Paso B de la Puerta 5A se reanuda aparte,
  con su propia autorización, una vez esta puerta esté aprobada y
  ejecutada.
- No activa `gapssaBookingDecisionEnabled`, no llama a `PutDecide`, no
  cambia `ESPO_BOOKING_ADAPTER`.
- No modifica `Profesional Gapssa` ni su membership de `Gapssa`.
- No toca Google Calendar.
- No corrige los dos fallos de integración no relacionados (fuera de
  alcance, mencionados solo como recordatorio).

---

**Queda a la espera de tu aprobación explícita**, separada de la de la
Puerta 5A, antes de ejecutar cualquier parte de §6 contra `gapssa-espocrm-1`
real.
