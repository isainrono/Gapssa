# Google Calendar Sync — extensión para EspoCRM

Sincronización de citas (`Meeting`) de EspoCRM con Google Calendar.

Extensión genérica: no depende de entidades personalizadas ni de configuración
del proyecto donde se desarrolló, así que se instala en cualquier EspoCRM 10.
Interfaz en inglés y español. Ver `docs/DEPLOY_OTHER_INSTANCE.md`.

**Fase 1 (esta versión):** espejo de salida hacia el calendario **Business**. Todas
las citas creadas, modificadas o canceladas en EspoCRM se reflejan en un único
calendario de Google administrado por el negocio. No se importa nada desde Google.

**Fase 2 (pendiente de aprobación):** cuentas User por profesional con
sincronización bidireccional.

## Requisitos

- EspoCRM 10.0.x (probado contra 10.0.3).
- PHP **8.3** o superior con extensión curl (la imagen oficial la incluye).
  Es el mínimo que exige el propio EspoCRM 10 (`>=8.3.0 <8.6.0`) y con el que
  se resolvió `composer.lock` (`platform.php = 8.3.0`).
- Cron de EspoCRM operativo (en este proyecto, el contenedor `espocrm-daemon`).
- Proyecto de Google Cloud con la Calendar API habilitada
  (ver `docs/GOOGLE_CLOUD_SETUP.md`).

La extensión usa la librería oficial **`google/apiclient` ^2.18**. El ZIP es
autónomo: incluye todo su árbol de dependencias y no depende de Guzzle, PSR,
Monolog ni phpseclib de EspoCRM. Para **construirlo** hacen falta Docker y red
(Composer se ejecuta en un contenedor); para **instalarlo**, no. Detalle en
`docs/VENDOR.md`.

## Instalación rápida

Desde la raíz del monorepositorio:

```bash
make gcs-lock       # SOLO la primera vez: genera composer.lock (requiere red)
make gcs-deps       # instala las dependencias exactas del lock
make gcs-build      # empaqueta el ZIP y lo verifica de punta a punta
make gcs-install    # deps + build + instalación en el contenedor + app-check
```

Instalación manual alternativa: Administración > Extensiones > subir el ZIP.

Después de instalar:

1. Configurar credenciales OAuth: `docs/GOOGLE_CLOUD_SETUP.md` y `docs/OAUTH_SETUP.md`.
2. Conectar la cuenta Business y elegir calendario: `docs/OAUTH_SETUP.md`.
3. Ejecutar las pruebas de aceptación: `docs/TESTING.md`.

## Comandos Makefile

| Comando | Descripción |
|---|---|
| `make gcs-lock` | Genera o actualiza `composer.lock` (requiere red) |
| `make gcs-relock` | Refirma el lock tras cambiar metadatos, sin tocar versiones |
| `make gcs-deps` | Instala las dependencias exactas del lock en `vendor/` |
| `make gcs-deps-check` | Verifica que `vendor/` está completo, exacto y es autónomo |
| `make gcs-build` | Empaqueta el ZIP y lo verifica (deps + autoload + mapper + `php -l`) |
| `make gcs-test` | Ejecuta las pruebas contra el contenido del ZIP |
| `make gcs-clean` | Borra `vendor/` y `build/` (reproducibles desde el lock) |
| `make gcs-lint` | `php -l` de todos los PHP con el PHP real del contenedor |
| `make gcs-install` | Deps + build + instalación/actualización + `app-check` |
| `make gcs-uninstall` | Desinstala la extensión (no borra datos) |
| `make gcs-rebuild` | `bin/command rebuild` |
| `make gcs-status` | Estado de la cuenta, scheduled job y últimos jobs de push |

## Arquitectura (fase 1)

```
Meeting (afterSave / afterRemove)
   └── Hook GcsPush ── solo encola ──► Job GcsPushEvent (cola, grupo gcs-push)
                                           └── SyncService.pushMeeting()
                                                 ├── GcsEventLink (¿ya existe evento?)
                                                 ├── búsqueda por espoMeetingId (anti-duplicados)
                                                 └── insert / update / delete en Google

Scheduled Job GcsPushSweep (*/5 min) ──► SyncService.sweep()
   └── reintenta citas con push pendiente o fallido (idempotente)
```

- `GoogleClientFactory`: construye `Google\Client` y `Google\Service\Calendar`
  autenticados a partir de la cuenta.
- `GcsAccount`: cuenta de Google (tokens cifrados con `Espo\Core\Utils\Crypt`).
- `GcsEventLink`: mapeo cita ↔ evento por calendario (índice único meeting+account).
- Todo evento exportado lleva `extendedProperties.private.espoMeetingId`.
- Política de cancelación: al cancelar o borrar la cita, el evento **se elimina**
  del calendario Business. La cita y su historial permanecen en EspoCRM.

## Documentación

- `docs/GOOGLE_CLOUD_SETUP.md` — crear el proyecto y las credenciales en Google Cloud.
- `docs/DEPLOY_OTHER_INSTANCE.md` — instalar en otro EspoCRM.
- `docs/VENDOR.md` — dependencias PHP incluidas y cómo actualizarlas.
- `docs/OAUTH_SETUP.md` — configurar y conectar la cuenta en EspoCRM.
- `docs/TESTING.md` — pruebas de aceptación de la fase 1.
- `docs/UPGRADE.md` — actualizar la extensión.
- `docs/UNINSTALL.md` — desinstalar sin perder datos.
- `docs/DECISIONS.md` — decisiones de diseño tomadas.
- `docs/LIMITATIONS.md` — limitaciones conocidas.
- `docs/TEST_RESULTS.md` — resultado de las validaciones realizadas.

## Seguridad

- `clientId`, `clientSecret` y tokens nunca se incluyen en el código ni en Git.
- `clientSecret` se guarda con nivel `internal` (no se devuelve por la API).
- `accessToken` y `refreshToken` se cifran con las utilidades de EspoCRM y están
  bloqueados a nivel de API (`entityAcl` forbidden).
- El `state` de OAuth es aleatorio, de un solo uso y validado con `hash_equals`.
- Solo administradores pueden configurar y conectar la cuenta Business.
- A Google solo se envían: título, descripción, fechas y el id interno de la cita.
