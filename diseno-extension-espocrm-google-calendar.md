# Extensión EspoCRM ↔ Google Calendar (sincronización bidireccional)

Diseño y guía de implementación. EspoCRM 9.x/10.x, extensión distribuible (módulo + ZIP instalable).

**Modelo de cuentas:** una cuenta **Business** (la del negocio, conectada por el admin, siempre activa) recibe copia de **todas** las citas del CRM, y cada usuario puede opcionalmente vincular su cuenta **User** para sincronizar bidireccionalmente su propio calendario. Resultado: el calendario central lo ve todo (incluso citas de usuarios que nunca vinculen su Google) y cada persona lleva el suyo.

> Nota previa: EspoCRM vende la "Google Integration" oficial (de pago) que ya hace esto. Construir la tuya tiene sentido si quieres evitar el coste, personalizar el mapeo o distribuirla a varios clientes.

---

## 1. Arquitectura

```
┌──────────────────────────── EspoCRM ────────────────────────────┐
│                                                                 │
│  Meeting ──── GcsEventLink (meetingId, accountId, eventId,      │
│      │                      etag) — un link por calendario      │
│      │ afterSave / afterRemove (hooks)                          │
│      ▼                                                          │
│  Job GcsPushEvent ─────────────► Calendario BUSINESS (siempre)  │
│   (grupo por cuenta)   └───────► Calendario del usuario         │
│                                  asignado (si vinculó)          │
│                                                                 │
│  Scheduled Job GcsPullSync (cada 5 min)                         │
│      events.list(syncToken) ◄─── SOLO calendarios User          │
│      │ crea/actualiza Meetings con SILENT (evita bucle)         │
│      │ (Business: solo escritura, no se hace pull)              │
│                                                                 │
│  Cada evento exportado lleva extendedProperties.private         │
│  .espoMeetingId → emparejamiento y anti-duplicados              │
│                                                                 │
│  GcsAccount (Business|User): tokens OAuth, calendarId,          │
│  syncToken · Entry point gcsCallback: redirect OAuth            │
└─────────────────────────────────────────────────────────────────┘
```

Decisiones clave:

- **Entidad sincronizada: `Meeting`** (opcionalmente `Call` después). Como un Meeting puede existir en varios calendarios (el del negocio + el del usuario asignado), el mapeo Meeting↔evento vive en una entidad propia **`GcsEventLink`**, no en campos del Meeting.
- **Dos tipos de cuenta**: `Business` (una sola, conectada por el admin, siempre activa, recibe todo) y `User` (opcional, una por usuario, bidireccional). Mismo flujo OAuth para ambas.
- **Espo → Google (doble destino)**: hooks `afterSave`/`afterRemove` en Meeting que **encolan un job** (nunca llamar a la API de Google dentro del hook: bloquearía el guardado y un fallo de red rompería el save). El job exporta al calendario Business siempre y al del usuario asignado si tiene cuenta vinculada. Jobs con `group` = id de la cuenta destino para serializar.
- **Google → Espo (asimétrico)**: scheduled job cada 5 min con **sincronización incremental** (`syncToken`) **solo sobre calendarios User**. Del calendario Business no se hace pull: es un espejo de salida; editarlo directamente no se propaga (regla simple que elimina toda una familia de duplicados y bucles). Push por `events.watch` (webhooks) es mejora v2: exige HTTPS público y renovación de canales.
- **Emparejamiento y anti-bucle con `extendedProperties`**: todo evento que exporta la extensión lleva `extendedProperties.private.espoMeetingId`. En el pull: si el evento trae esa propiedad → es un Meeting existente, se actualiza; si no → es un evento creado por el usuario en Google, se crea el Meeting (asignado a él) y el push lo propaga al calendario central. Además, al escribir desde Google se guarda con `SaveOption::SILENT` + opción propia `gcsSync => true` para que el hook no re-encole hacia el mismo calendario de origen.
- **Privacidad**: en el momento de vincular, el usuario designa **qué calendario** sincronizar (por defecto `primary`, pero recomendado un calendario secundario "Trabajo"). Así sus eventos personales no entran al CRM ni al calendario central. Es un desplegable en la pantalla de conexión (`calendarList.list` de la API).
- **Conflictos**: last-modified-wins comparando `modifiedAt` (Espo) vs `updated` (Google). Documentado y suficiente para v1.
- **Recurrencia**: en v1, los eventos recurrentes de Google se importan como instancias individuales (expandidas con `singleEvents=true`) y los Meetings de Espo no generan recurrencia en Google. La recurrencia bidireccional completa es el punto más costoso de todo el proyecto; déjala explícitamente fuera del alcance inicial.
- **Prefijo `Gcs`** en entidades, campos y hooks para no colisionar con otras extensiones.

## 2. Requisitos en Google Cloud

1. Crear proyecto en https://console.cloud.google.com → habilitar **Google Calendar API**.
2. Pantalla de consentimiento OAuth: tipo *External* (o *Internal* si es Workspace propio), scope `https://www.googleapis.com/auth/calendar.events` (mejor que el scope completo `calendar`: pide solo lo necesario).
3. Credencial **OAuth client ID** tipo *Web application*. Redirect URI: `https://tu-crm.com/?entryPoint=gcsCallback`.
4. Mientras la app esté en modo *Testing*, los refresh tokens caducan a los 7 días; para producción hay que publicarla (verificación de Google si es External + scope sensible).

El `clientId`/`clientSecret` se guardan en la config de Espo (pantalla de administración propia de la extensión), no hardcodeados.

## 3. Estructura del proyecto (ext-template)

```bash
# Crear repo desde github.com/espocrm/ext-template, luego:
php init.php        # nombre: GoogleCalendarSync → módulo GoogleCalendarSync / google-calendar-sync
npm install
cp config-default.json config.json   # editar BD y siteUrl
npm run all         # descarga Espo, instala instancia de desarrollo en site/
```

Archivos del módulo (todo bajo `src/files/` en el repo; se copia a la raíz de Espo al instalar):

```
src/files/custom/Espo/Modules/GoogleCalendarSync/
├── Resources/
│   ├── module.json                        # {"order": 30}
│   ├── autoload.json                      # psr-4 del vendor de Google
│   ├── routes.json                        # endpoints OAuth
│   ├── metadata/
│   │   ├── scopes/{GcsAccount,GcsEventLink}.json
│   │   ├── entityDefs/{GcsAccount,GcsEventLink}.json
│   │   ├── clientDefs/GcsAccount.json
│   │   └── app/scheduledJobs.json
│   └── i18n/en_US/  (+ es_ES/)
├── Entities/GcsAccount.php
├── Hooks/Meeting/GcsPush.php
├── Jobs/GcsPushEvent.php                  # job encolado (push unitario)
├── Jobs/GcsPullSync.php                   # scheduled job (pull incremental)
├── Api/GetGcsAuthUrl.php                  # devuelve URL de autorización
├── EntryPoints/GcsCallback.php            # recibe el code de Google
├── Classes/GoogleClientFactory.php        # construye el cliente autenticado
├── Classes/EventMapper.php                # Meeting ↔ evento Google
├── Classes/SyncService.php                # lógica push/pull
└── composer.json                          # google/apiclient
src/files/client/custom/modules/google-calendar-sync/
└── src/views/gcs-account/record/detail.js # botón "Conectar con Google"
src/scripts/AfterInstall.php
```

Dependencia PHP — `src/files/custom/Espo/Modules/GoogleCalendarSync/composer.json`:

```json
{ "require": { "google/apiclient": "^2.16" } }
```

y **obligatorio** `Resources/autoload.json` (las extensiones no se instalan vía Composer; sin esto el namespace `Google\` no resuelve aunque `vendor/` exista):

```json
{
  "psr-4": {
    "Google\\": "custom/Espo/Modules/GoogleCalendarSync/vendor/google/apiclient/src",
    "Google\\Service\\": "custom/Espo/Modules/GoogleCalendarSync/vendor/google/apiclient-services/src"
  },
  "autoloadFileList": [
    "custom/Espo/Modules/GoogleCalendarSync/vendor/google/apiclient/src/aliases.php"
  ]
}
```

> `google/apiclient` pesa mucho (arrastra todos los servicios de Google). Alternativa ligera y razonable: cliente HTTP propio contra `https://www.googleapis.com/calendar/v3/` con Guzzle, gestionando tú el refresh del token. El diseño no cambia; solo `GoogleClientFactory`. Si lo haces, en `composer.json` del apiclient usa `Google\Task\Composer::cleanup` para recortar servicios, o directamente Guzzle.

## 4. Modelo de datos

### 4.1 `GcsAccount` (la Business + una por usuario que vincule)

`Resources/metadata/entityDefs/GcsAccount.json`:

```json
{
  "fields": {
    "name": {"type": "varchar", "maxLength": 100},
    "type": {"type": "enum", "options": ["Business", "User"], "default": "User", "readOnly": true},
    "user": {"type": "link"},
    "status": {"type": "enum", "options": ["Active", "Error", "Disconnected"], "default": "Disconnected"},
    "calendarId": {"type": "varchar", "default": "primary"},
    "accessToken": {"type": "text", "readOnly": true},
    "refreshToken": {"type": "text", "readOnly": true},
    "tokenExpiresAt": {"type": "datetime", "readOnly": true},
    "syncToken": {"type": "varchar", "maxLength": 255, "readOnly": true},
    "lastSyncAt": {"type": "datetime", "readOnly": true},
    "lastError": {"type": "text", "readOnly": true}
  },
  "links": {
    "user": {"type": "belongsTo", "entity": "User"}
  },
  "indexes": {
    "user": {"columns": ["userId"]}
  }
}
```

`scopes/GcsAccount.json`: `{"module": "GoogleCalendarSync", "entity": true, "object": true, "acl": true, "tab": false}`.
`clientDefs/GcsAccount.json`: `{"controller": "controllers/record", "recordViews": {"detail": "google-calendar-sync:views/gcs-account/record/detail"}}` — ojo a la forma `{modulo}:views/...`; la forma `module/...` en singular que aparece en la doc oficial **no resuelve** y el panel falla en silencio con 404.

Reglas: `user` es obligatorio solo si `type = User` (Dynamic Logic o validación en servicio); una sola cuenta `Business` (validar en `beforeSave`); solo el admin crea/ve la Business (ACL del rol). Los tokens en `text` plano es lo pragmático en v1; si distribuyes a terceros, cífralos con `Espo\Core\Utils\Crypt` antes de guardar. En la pantalla de conexión de cuentas `User`, tras el OAuth se lista `calendarList.list` para que el usuario **elija qué calendario sincronizar** (recomendado: uno secundario "Trabajo", no `primary`, para que sus eventos personales no entren al CRM).

### 4.2 `GcsEventLink` (mapeo Meeting ↔ evento por calendario)

Un Meeting puede existir en dos calendarios (Business + el del usuario asignado), así que el mapeo no cabe en campos del Meeting. `Resources/metadata/entityDefs/GcsEventLink.json`:

```json
{
  "fields": {
    "meeting": {"type": "link", "required": true},
    "account": {"type": "link", "required": true},
    "eventId": {"type": "varchar", "maxLength": 255, "required": true},
    "etag": {"type": "varchar", "maxLength": 255}
  },
  "links": {
    "meeting": {"type": "belongsTo", "entity": "Meeting", "foreign": "gcsEventLinks"},
    "account": {"type": "belongsTo", "entity": "GcsAccount"}
  },
  "indexes": {
    "meetingAccount": {"unique": true, "columns": ["meetingId", "accountId"]},
    "eventId": {"columns": ["eventId"]}
  }
}
```

(El `foreign: gcsEventLinks` exige declarar el link inverso en `entityDefs/Meeting.json` del módulo — merge, no reemplazo.) `scopes/GcsEventLink.json`: `{"module": "GoogleCalendarSync", "entity": true, "object": false, "acl": false, "tab": false}` — entidad interna, sin UI.

Tras cualquier cambio de `entityDefs`: **rebuild** (`bin/command rebuild` o `npm run rebuild` en el ext-template) — es lo que crea las tablas/columnas. "No aparece el campo" = falta rebuild, el 90 % de las veces.

## 5. OAuth por usuario

### 5.1 Rutas — `Resources/routes.json`

```json
[
  {"route": "/GcsSync/authUrl", "method": "get",
   "actionClassName": "Espo\\Modules\\GoogleCalendarSync\\Api\\GetGcsAuthUrl"}
]
```

### 5.2 Acción que genera la URL de autorización

```php
<?php
// Api/GetGcsAuthUrl.php
namespace Espo\Modules\GoogleCalendarSync\Api;

use Espo\Core\Api\{Action, Request, Response, ResponseComposer};
use Espo\Modules\GoogleCalendarSync\Classes\GoogleClientFactory;

class GetGcsAuthUrl implements Action
{
    public function __construct(private GoogleClientFactory $clientFactory) {}

    public function process(Request $request): Response
    {
        $client = $this->clientFactory->createBare(); // con clientId/secret/redirectUri, sin tokens
        $client->setAccessType('offline');            // imprescindible para obtener refresh token
        $client->setPrompt('consent');                // fuerza refresh token aunque ya autorizara antes
        $client->setState(bin2hex(random_bytes(16))); // CSRF; guárdalo para validarlo en el callback

        return ResponseComposer::json(['authUrl' => $client->createAuthUrl()]);
    }
}
```

El botón "Conectar con Google" del frontend llama a `GET api/v1/GcsSync/authUrl` y hace `window.location = authUrl`. El mismo flujo sirve para la cuenta Business: el admin abre el registro GcsAccount de tipo Business y pulsa el mismo botón (pasa el id de la cuenta en el `state` para que el callback sepa a cuál asignar los tokens). Tras el callback, mostrar el desplegable de `calendarList.list` para elegir el calendario a sincronizar.

### 5.3 Entry point de callback

```php
<?php
// EntryPoints/GcsCallback.php  →  https://tu-crm.com/?entryPoint=gcsCallback
namespace Espo\Modules\GoogleCalendarSync\EntryPoints;

use Espo\Core\Api\{Request, Response};
use Espo\Core\EntryPoint\EntryPoint;
use Espo\Entities\User;
use Espo\Modules\GoogleCalendarSync\Classes\GoogleClientFactory;
use Espo\ORM\EntityManager;

class GcsCallback implements EntryPoint
{
    // SIN trait NoAuth: requiere sesión de Espo, así sabemos qué usuario conecta.
    public function __construct(
        private GoogleClientFactory $clientFactory,
        private EntityManager $entityManager,
        private User $user
    ) {}

    public function run(Request $request, Response $response): void
    {
        // 1. Validar state (CSRF), 2. canjear el code:
        $client = $this->clientFactory->createBare();
        $token = $client->fetchAccessTokenWithAuthCode($request->getQueryParam('code'));

        $account = $this->entityManager
            ->getRDBRepository('GcsAccount')
            ->where(['userId' => $this->user->getId()])
            ->findOne() ?? $this->entityManager->getNewEntity('GcsAccount');

        $account->setMultiple([
            'userId' => $this->user->getId(),
            'accessToken' => $token['access_token'],
            'refreshToken' => $token['refresh_token'] ?? $account->get('refreshToken'),
            'tokenExpiresAt' => date('Y-m-d H:i:s', time() + $token['expires_in']),
            'status' => 'Active',
        ]);
        $this->entityManager->saveEntity($account);

        $response->setHeader('Location', '/#GcsAccount')->setStatus(302);
    }
}
```

`GoogleClientFactory::createForUser($userId)` hace lo mismo a la inversa: carga `GcsAccount`, monta el `Google\Client`, y si el token expiró usa `fetchAccessTokenWithRefreshToken()` y persiste el nuevo access token.

## 6. Push: Espo → Google

### 6.1 Hook (solo encola)

```php
<?php
// Hooks/Meeting/GcsPush.php
namespace Espo\Modules\GoogleCalendarSync\Hooks\Meeting;

use Espo\Core\Hook\Hook\AfterSave;
use Espo\Core\Job\JobSchedulerFactory;
use Espo\ORM\Entity;
use Espo\ORM\Repository\Option\SaveOptions;
use Espo\Modules\GoogleCalendarSync\Jobs\GcsPushEvent;

class GcsPush implements AfterSave
{
    public function __construct(private JobSchedulerFactory $jobSchedulerFactory) {}

    public function afterSave(Entity $entity, SaveOptions $options): void
    {
        if ($options->get('gcsSync') || $options->get('silent')) {
            return; // el cambio vino del pull de Google: el job decide a qué calendarios sí exportar
        }

        // Siempre se encola: el destino Business existe aunque el usuario no haya vinculado nada.
        $this->jobSchedulerFactory->create()
            ->setClassName(GcsPushEvent::class)
            ->setGroup('gcs-push-' . ($entity->get('assignedUserId') ?? 'none'))
            ->setData([
                'meetingId' => $entity->getId(),
                'action' => 'upsert',
            ])
            ->schedule();
    }
}
```

Análogo `afterRemove` → encola `action: delete`. Nota: la firma con `SaveOptions` tipado es de las interfaces modernas; en 9.x también vale `array $options` — comprueba la interfaz de tu versión exacta.

### 6.2 Job de push

```php
<?php
// Jobs/GcsPushEvent.php
namespace Espo\Modules\GoogleCalendarSync\Jobs;

use Espo\Core\Job\Job;
use Espo\Core\Job\Job\Data;
use Espo\Modules\GoogleCalendarSync\Classes\SyncService;

class GcsPushEvent implements Job
{
    public function __construct(private SyncService $syncService) {}

    public function run(Data $data): void
    {
        $this->syncService->pushMeeting(
            $data->get('meetingId'),
            $data->get('action')
        );
    }
}
```

`SyncService::pushMeeting()` resuelve los **destinos**: siempre la cuenta `Business` activa, más la cuenta `User` del usuario asignado si existe y está activa. Para cada destino: busca el `GcsEventLink` (meetingId + accountId); si no existe → `events.insert`, si existe → `events.update` (o `delete`). El Meeting se convierte con `EventMapper` (name→summary, description, dateStart/dateEnd **UTC → RFC3339 con timeZone**, invitados→attendees si quieres) e incluye siempre:

```json
"extendedProperties": {"private": {"espoMeetingId": "{meetingId}"}}
```

Tras cada llamada se crea/actualiza el `GcsEventLink` con `eventId`/`etag`. Como el estado va en `GcsEventLink` (no en el Meeting), no hay que re-guardar el Meeting → no hay riesgo de redisparar el hook. En `update`, envía el `etag` en `If-Match`: si Google responde 412, el evento cambió allí primero → deja que el pull resuelva. Excepción de diseño: si el origen del cambio fue el pull desde el calendario del propio usuario (`gcsSync`), el push posterior solo debe ir al calendario Business, no de vuelta al del usuario — `SyncService` lo sabe porque el pull encola ese push directamente con el destino acotado.

## 7. Pull: Google → Espo

`Resources/metadata/app/scheduledJobs.json`:

```json
{"GcsPullSync": {"jobClassName": "Espo\\Modules\\GoogleCalendarSync\\Jobs\\GcsPullSync"}}
```

```php
<?php
// Jobs/GcsPullSync.php
namespace Espo\Modules\GoogleCalendarSync\Jobs;

use Espo\Core\Job\JobDataLess;
use Espo\Modules\GoogleCalendarSync\Classes\SyncService;
use Espo\ORM\EntityManager;

class GcsPullSync implements JobDataLess
{
    public function __construct(
        private EntityManager $entityManager,
        private SyncService $syncService
    ) {}

    public function run(): void
    {
        $accounts = $this->entityManager->getRDBRepository('GcsAccount')
            ->where(['status' => 'Active', 'type' => 'User'])->find();
        // Del calendario Business NO se hace pull: es espejo de salida.

        foreach ($accounts as $account) {
            try {
                $this->syncService->pullForAccount($account);
            } catch (\Throwable $e) {
                $account->set('lastError', $e->getMessage());
                $account->set('status', 'Error');
                $this->entityManager->saveEntity($account);
            }
        }
    }
}
```

Lógica de `pullForAccount()` (solo cuentas `User`):

1. `events.list(calendarId, syncToken: X, singleEvents: true)`; si no hay `syncToken` (primera vez), sincronización completa acotada (`timeMin` = hoy − 30 días) paginando con `pageToken`.
2. Por cada evento, emparejar por `extendedProperties.private.espoMeetingId` (o, en su defecto, por `GcsEventLink.eventId`):
   - **Trae `espoMeetingId`** → Meeting existente: actualizar campos mapeados (el usuario lo editó en su Google). Si `status == 'cancelled'` → cancelar/borrar el Meeting.
   - **No lo trae** → evento nuevo creado por el usuario en su calendario: crear Meeting asignado a él, crear su `GcsEventLink`, y encolar un push **acotado al calendario Business** para que aparezca en el central.
3. **Guardar siempre con `SILENT` + `gcsSync`** para que el hook no re-exporte al calendario de origen.
4. Conflicto (el Meeting también cambió en Espo desde el último sync): gana el `updated`/`modifiedAt` más reciente.
5. Al terminar, persistir el `nextSyncToken` y `lastSyncAt` en la cuenta.
6. Si Google devuelve **410 Gone**, el syncToken caducó: borrar el token y repetir con sincronización completa.

El job se activa en Administración > Scheduled Jobs (crear registro con el job `GcsPullSync`, cron `*/5 * * * *`). Requiere que el **cron de Espo** esté configurado en el servidor — sin cron no hay sync ni jobs de push.

## 8. Frontend mínimo

`client/custom/modules/google-calendar-sync/src/views/gcs-account/record/detail.js`: extiende `views/record/detail`, añade botón "Connect Google" que hace `Espo.Ajax.getRequest('GcsSync/authUrl').then(r => window.location.href = r.authUrl)`. Referéncialo en `clientDefs` como `google-calendar-sync:views/gcs-account/record/detail`. Con ES6 (`bundled: true` en `extension.json`), el build transpila y empaqueta solo.

## 9. AfterInstall

`src/scripts/AfterInstall.php` (clase en namespace global, firma `run(Container $container, array $params = [])`): idempotente; crea el registro de Scheduled Job `GcsPullSync` con cron `*/5 * * * *` si no existe. Con `$params['isUpgrade'] === true` es donde irían migraciones futuras (no existe AfterUpgrade: las actualizaciones reejecutan AfterInstall). En `BeforeUninstall`, no borres los Meetings ni la entidad GcsAccount sin avisar: por defecto, desinstalar no debe destruir datos del cliente.

## 10. Ciclo de desarrollo y build

```bash
# editar en src/ → sincronizar a la instancia de desarrollo:
npm run sync && npm run clear-cache
npm run rebuild            # si tocaste entityDefs

# probar OAuth y sync en http://localhost/.../site (admin / 1)
tail -f site/data/logs/espo-*.log    # con logger.level: DEBUG en site/data/config.php

# empaquetar:
npm run extension          # → build/google-calendar-sync-{versión}.zip
```

Instalación en el cliente: Administración > Extensions > subir ZIP, o `bin/command extension --file="google-calendar-sync-1.0.0.zip"`.

`extension.json`: `acceptableVersions: [">=9.0.0"]` (pruébalo de verdad contra la mínima), `php: [">=8.2"]`, `bundled: true`.

> **Nota de implementación:** la extensión final se validó para EspoCRM
> `>=10.0.0 <11.0.0` y PHP `>=8.3.0`. Estos requisitos sustituyen a los valores
> preliminares de esta propuesta.

## 11. Orden de implementación sugerido

1. Esqueleto ext-template + entidades `GcsAccount` y `GcsEventLink` + rebuild. Verifica que todo aparece en la UI.
2. `GoogleClientFactory` + flujo OAuth completo (acción authUrl + entry point) + selección de calendario. Verifica que el refresh token se guarda y se renueva.
3. Push al calendario **Business** (hook + job + extendedProperties). Con esto ya tienes el calendario central completo, que es el requisito principal — hito entregable por sí solo.
4. Push al calendario del usuario asignado (segundo destino sobre la misma lógica).
5. Pull desde calendarios User con syncToken. Primero creación/actualización, luego borrados y conflictos.
6. AfterInstall, i18n (en_US + es_ES), pruebas de instalar/actualizar/desinstalar el ZIP en instancia limpia.

## 12. Errores que te vas a encontrar (y su causa)

| Síntoma | Causa probable |
|---|---|
| Campo/entidad no aparece | Falta `rebuild` + limpiar caché |
| Clase `Google\Client` no encontrada | Falta `Resources/autoload.json` o ruta mal escrita |
| Vista JS no carga, sin error claro | Id de vista `module/...` singular en vez de `google-calendar-sync:views/...` |
| No hay refresh token en el callback | Faltó `access_type=offline` + `prompt=consent`, o Google solo lo da la primera vez |
| Refresh token muere a los 7 días | App OAuth en modo Testing; publícala |
| Sync no corre nunca | Cron del servidor no configurado, o Scheduled Job no creado |
| Bucle Espo↔Google (eventos duplicados) | El pull guarda sin `SILENT`/`gcsSync` y el hook re-exporta |
| Duplicados en el calendario central | El pull crea Meetings desde eventos que ya llevan `espoMeetingId` (emparejamiento roto), o se hizo pull del calendario Business |
| Eventos personales del usuario en el CRM | Vinculó su calendario `primary` en vez de uno de trabajo designado |
| 410 Gone en events.list | syncToken caducado: forzar sync completa |
| Hook ignorado en silencio | Otro módulo define un hook con el mismo nombre para Meeting: prefija (`GcsPush`) |
