# EspoCRM: modelo de datos actual y extensión Google Calendar Sync

Fuentes: `docs/espocrm-modelo-inicial.md`, `extensions/espocrm-google-calendar-sync/`
(README.md, docs/DECISIONS.md, docs/LIMITATIONS.md, manifest.json). Marca:
**[SRC]** verificado en código/config del repo, **[DOC]** documentado y
validado por el propietario, **[ND]** no implementado.

Para dudas de EspoCRM en general (Studio, API v8, roles, actualizaciones) que
no sean específicas de este proyecto, complementa con la skill global
`suitecrm-agent`/`suitecrm-expert` solo si aplica a EspoCRM — verifica
primero si la duda es realmente sobre el modelo de **este** proyecto (abajo)
antes de generalizar.

## 1. Entidades nativas usadas y por qué [SRC/DOC]

- **`Contact`** (mostrado como "Contacto") almacena a los **clientes**. No se
  ha creado una entidad de cliente personalizada.
- **`Meeting`** (mostrado en la interfaz como **"Cita"** / "Citas") almacena
  las **citas**, para conservar de fábrica calendario, participantes,
  recordatorios y sincronización. El nombre técnico se mantiene `Meeting` para
  no romper compatibilidad con la API de EspoCRM — no lo confundas con una
  entidad `Cita` que no existe.
- **Moneda**: predeterminada y base **EUR**. USD se conserva temporalmente en
  la lista de monedas para que un rebuild de metadatos no intente calcular
  una tasa USD/EUR inexistente.
- Los **precios e impuestos no se guardan en EspoCRM**: pertenecerán a
  FacturaScripts cuando se integre.

## 2. Entidad `CTratamiento` (Tratamiento) [SRC]

| Campo | Tipo | Reglas |
|---|---|---|
| `name` | Texto | Obligatorio (impuesto por EspoCRM) |
| `familia` | Lista | Obligatorio, auditado |
| `duracionMinutos` | Entero | Obligatorio, valor inicial 60, mínimo 5, máximo 480, auditado |
| `activo` | Sí/No | Activo por defecto, auditado |
| `description` | Texto | Descripción operativa opcional |

Familias iniciales de `familia`: Masajes, Aparatología, Depilación,
Tratamientos faciales, Uñas, Pestañas y cejas (coincide con las familias del
catálogo de negocio, [[01-fuentes-de-verdad-y-reglas-negocio]] §5).

## 3. Entidad `CZonaAtencion` (Zona de atención) [SRC]

| Campo | Tipo | Reglas |
|---|---|---|
| `name` | Texto | Nombre visible de la zona |
| `tipo` | Lista | `Centro` o `Domicilio / externa`; obligatorio, auditado |
| `activa` | Sí/No | Activa por defecto, auditada |
| `description` | Texto | Observaciones opcionales |

## 4. Relaciones de la cita [SRC]

| Origen | Relación | Destino | Campo técnico en la cita |
|---|---|---|---|
| `Meeting` | Muchos-a-uno | `CTratamiento` | `cTratamiento` |
| `Meeting` | Muchos-a-uno | `CZonaAtencion` | `cZonaAtencion` |
| `Meeting` | Muchos-a-muchos nativa | `Contact` | `contacts` |

La relación inversa de tratamientos y zonas se etiqueta "Citas" en la
interfaz. **Nota importante para hooks/lógica de negocio**: `contactsIds` de
`Meeting` no es un atributo persistente normal — se guarda mediante
`relateById()`/`unrelateById()` y dispara `AfterRelate`/`AfterUnrelate`, no
`afterSave` (ver §7).

Datos ficticios de validación (sufijo `[PRUEBA]`, no son datos reales):
tratamiento `Masaje relajante 60 min [PRUEBA]`, zonas `Cabina 1 [PRUEBA]` /
`Cabina 2 [PRUEBA]`, cita `Cita Isain Uñas`.

## 5. Extensión Google Calendar Sync — qué hace hoy [SRC]

Versión **1.1.1** (manifest.json), `acceptableVersions: >=10.0.0 <11.0.0`,
PHP `>=8.3.0`. Genérica: **no** depende de `CTratamiento`/`CZonaAtencion` ni
de nada específico de Gapssa; instalable en cualquier EspoCRM 10 con la
entidad nativa `Meeting`.

**Fase 1 (implementada)**: espejo de **solo salida** (EspoCRM → Google) hacia
un único calendario **Business** administrado por el negocio. Nada se importa
desde Google. **Fase 2 (no construida, pendiente de aprobación)**: cuentas
User por profesional con sincronización bidireccional.

### 5.1 Flujo (fase 1) [SRC]

```text
Meeting (afterSave / afterRemove)
   └── Hook GcsPush ── solo encola ──► Job GcsPushEvent (cola, grupo gcs-push)
                                           └── SyncService.pushMeeting()
                                                 ├── GcsEventLink (¿ya existe evento?)
                                                 ├── búsqueda por espoMeetingId (anti-duplicados)
                                                 └── insert / update / delete en Google

Scheduled Job GcsPushSweep (*/5 min) ──► SyncService.sweep()
   └── reintenta citas con push pendiente o fallido (idempotente)
```

- **El hook nunca llama a Google directamente**: solo encola un job. Un fallo
  de red nunca impide guardar una cita.
- `GcsAccount`: cuenta de Google, tokens cifrados con `Espo\Core\Utils\Crypt`.
- `GcsEventLink`: mapeo cita↔evento por calendario, índice único
  `meeting+account`.
- Todo evento exportado lleva `extendedProperties.private.espoMeetingId`.
- Cancelar o borrar la cita **elimina** el evento del calendario Business
  (espejo limpio); el historial vive solo en EspoCRM. Reactivar la cita
  recrea el evento.
- Actualizaciones **sin `If-Match`**: EspoCRM siempre tiene la última palabra
  (last-write-wins); el `etag` se guarda para la fase 2.

### 5.2 Título del evento y nombre del cliente [SRC]

- El nombre viene de la relación `contacts` de `Meeting` (la misma que usa
  EspoCRM para invitaciones), **nunca** de `parent`. Formato
  `Asunto (Nombre)` o `Asunto (Nombre1, Nombre2)`.
- Los cambios de contactos se detectan con hooks `AfterRelate`/`AfterUnrelate`
  del repositorio, **no** con `afterSave` (verificado contra
  `Espo\Core\FieldProcessing\Relation\LinkMultipleSaver` en 10.0.3): el
  `afterSave` corre antes y no vería el cambio.
- `silent` **no** se ignora en los cambios de relación (corregido en 1.1.1):
  `LinkMultipleSaver` relaciona contactos de una cita nueva con
  `SaveOption::SILENT`; si el hook lo ignorase, el título quedaría sin
  cliente **de forma permanente** (el barrido filtra por
  `Meeting.modifiedAt`, que relacionar un contacto no toca). `gcsSync` sí se
  sigue respetando en los hooks de relación, para no crear bucles.
- Deduplicación por petición: `HookManager` cachea instancias por clase, así
  que guardar una cita con 3 contactos (3 `afterRelate`) encola una sola vez
  el push.
- `ContactNameResolver` aísla el acceso al ORM, ordena por `name` (alfabético,
  insensible a mayúsculas) para resultado determinista, lee hasta 50 filas,
  descarta vacíos/duplicados y **recorta a 10 nombres al final** (no antes).
- `ContactNameResolver` **no captura excepciones**: un fallo del ORM hace
  fallar la exportación de esa cita a propósito (se registra y reintenta) en
  vez de exportar un evento sin nombre y dar el trabajo por bueno.
- Renombrar un `Contact` (`firstName`/`middleName`/`lastName`) reexporta sus
  citas vía `Hooks/Contact/GcsContactRename` (`AfterSave`), acotado a 200
  filas por `dateStart DESC` — sin este hook el título quedaría obsoleto para
  siempre.
- Solo se envía el **nombre**: nunca correo, teléfono ni identificadores del
  contacto.

### 5.3 Seguridad de la extensión [SRC]

- `clientId`/`clientSecret`/tokens nunca en código ni Git.
- `clientSecret` con nivel de config `internal` (solo escritura, la API nunca
  lo devuelve).
- `accessToken`/`refreshToken` cifrados con `Espo\Core\Utils\Crypt` y
  bloqueados vía `entityAcl.fields.forbidden`.
- `state` de OAuth aleatorio, de un solo uso, validado con `hash_equals`.
- Solo administradores configuran/conectan la cuenta Business.
- Scopes mínimos: `calendar.events` + `calendar.calendarlist.readonly` (no el
  scope completo `calendar`).
- A Google solo llega: título, descripción, fechas, id interno de la cita.

### 5.4 Librería y build [SRC]

- Cliente oficial **`google/apiclient` ^2.18** (`Google\Client` +
  `Google\Service\Calendar`); ya no hay cliente cURL propio.
- ZIP **autónomo**: `composer install` instala el árbol completo, recortado a
  solo el servicio Calendar vía
  `extra."google/apiclient-services"` + `Google\Task\Composer::cleanup`
  (sin esto `vendor/` superaría 500 MB). No depende de Guzzle/PSR/Monolog/
  phpseclib de EspoCRM.
- `composer.lock` se versiona; `vendor/` no (`.gitignore`), se reconstruye con
  `make gcs-deps`.
- `platform.php = 8.3.0` en `composer.json`: el lock se resuelve para el PHP
  de la imagen oficial de EspoCRM, no el del Mac de desarrollo.
- `phpseclib/phpseclib ^3` declarado como dependencia **directa** aunque
  `google/apiclient`/`google/auth` solo lo sugieren (`AccessToken.php`,
  `ServiceAccountSignerTrait.php` lo usan en runtime) — lo detectó
  `tools/check-dependencies.php`.
- `build.sh` aborta si falta el lock o `vendor/`, empaqueta, **extrae el ZIP**
  y repite verificación de dependencias + autoload + mapper + `php -l` sobre
  el contenido final. Un ZIP que no pasa esos filtros no se produce.

### 5.5 Barrido de reintentos (`GcsPushSweep`) [SRC]

Cada 5 minutos, red de reintentos porque los jobs fallidos de EspoCRM no se
reintentan solos. Detecta citas con push pendiente (sin vínculo, o vínculo más
antiguo que `modifiedAt`). Ventana: citas modificadas en los **últimos 14
días**, máximo **100 por pasada**. Anti-duplicados en dos capas: (a)
`GcsEventLink` con índice único `meeting+account`, (b) antes de insertar sin
vínculo, busca en Google por `privateExtendedProperty espoMeetingId` y adopta
el evento si ya existe.

### 5.6 Comandos Makefile de la extensión [SRC]

Ejecutar siempre desde la raíz del monorepo. Orden típico de primera
instalación: `gcs-lock` → `gcs-deps` → `gcs-build` → `gcs-install` (o
directamente `gcs-install`, que encadena deps+build).

| Comando | Qué hace |
|---|---|
| `make gcs-lock` | Genera/actualiza `composer.lock` (requiere red). Solo la primera vez o al cambiar dependencias |
| `make gcs-relock` | Refirma el lock tras cambiar solo metadatos de `composer.json` (name, description), sin mover versiones |
| `make gcs-deps` | Instala las dependencias exactas del lock en `vendor/`; falla si el lock no existe o está desincronizado |
| `make gcs-deps-check` | Verifica que `vendor/` está completo, exacto y es autónomo |
| `make gcs-build` | Empaqueta el ZIP y lo verifica de punta a punta |
| `make gcs-test` | Ejecuta las pruebas contra el contenido del último ZIP construido |
| `make gcs-clean` | Borra `vendor/` y `build/` (reproducibles desde el lock) |
| `make gcs-lint` | `php -l` de todos los PHP con el PHP real del contenedor |
| `make gcs-install` | deps + build + instalación/actualización en el contenedor + `app-check` |
| `make gcs-uninstall` | Desinstala (no borra datos) |
| `make gcs-rebuild` | `bin/command rebuild` |
| `make gcs-status` | Estado de la cuenta, scheduled job y últimos jobs de push (consulta la BD directamente, solo lectura) |
| `make gcs-package` | Genera la carpeta de entrega en `dist/` para llevar a otro entorno |

**Gotcha caro**: si cambias `composer.json`, `make gcs-deps` **abortará**
(`composer validate --strict`) hasta que refirmes el lock. Si cambiaron
dependencias reales → `make gcs-lock`; si solo cambiaron metadatos → `make
gcs-relock`. No hay forma de saltarse esto y no debe haberla: es a propósito,
para no instalar nunca algo distinto de lo registrado en el lock.

## 6. Limitaciones conocidas de la extensión (fase 1) [SRC]

- Solo salida: cambios hechos directamente en Google se sobrescriben en el
  siguiente push de esa cita.
- Sin exportación de histórico: solo se sincronizan citas creadas/modificadas
  después de conectar la cuenta Business.
- Sin recurrencia: una cita EspoCRM = un evento Google.
- Latencia: hasta ~1 min (cola normal) o ~5 min (reintento por barrido).
- Sin invitados en el evento de Google (deliberado: las invitaciones siguen
  saliendo por correo desde el CRM).
- Ventana de reintento de 14 días: si la cuenta lleva en Error más de 14 días,
  las citas modificadas antes de esa ventana no se reintentan solas.
- Un solo calendario Business; multi-centro queda fuera de alcance.
- El callback OAuth exige sesión de administrador en el mismo navegador
  (intencional, no se puede conectar desde enlace externo).
- App OAuth en modo **Testing**: refresh tokens caducan a los **7 días**
  (límite de Google). Publicar la app lo resuelve —
  `docs/GOOGLE_CLOUD_SETUP.md` paso 11.
- Renombrar un contacto reexporta como máximo 200 citas (las más recientes y
  futuras); citas más antiguas conservan el título previo.
- Solo inglés y español en la interfaz de la extensión.
- Una instancia EspoCRM, un calendario Google: no sincronizar dos EspoCRM
  distintos contra el mismo calendario (`espoMeetingId` no es único entre
  instancias).

## 7. Antes de tocar código de la extensión

1. Lee `docs/DECISIONS.md` completo: cada decisión documenta el porqué y
   suele haber una carrera o bug histórico detrás.
2. No confundas `afterSave` con `AfterRelate`/`AfterUnrelate` al razonar sobre
   cuándo se dispara un hook de `Meeting` — depende de si el campo es
   `linkMultiple` (como `contacts`) o no.
3. Si algo parece un bug de "el título no se actualiza", revisa primero si el
   barrido filtra por `Meeting.modifiedAt` (no detecta cambios en `Contact` ni
   en relaciones silenciosas) antes de asumir que hace falta un fix nuevo.
4. Cualquier cambio de dependencias PHP exige `make gcs-lock` +
   `make gcs-deps-check`, nunca editar `vendor/` a mano.
