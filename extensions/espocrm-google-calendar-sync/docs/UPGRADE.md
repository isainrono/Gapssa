# Actualizar la extensión

## Procedimiento

1. Sube la versión en `manifest.json` (`version`).
2. Genera e instala:

   ```bash
   make gcs-install
   ```

   Instalar un ZIP con el mismo nombre de extensión **actualiza**: EspoCRM
   desinstala la versión anterior (conservando datos) y ejecuta de nuevo
   `AfterInstall`, esta vez con `isUpgrade = true`.

3. Verifica: `make health` y `make gcs-status`.

## Qué se conserva al actualizar

- Registros `GcsAccount` (tokens incluidos) y `GcsEventLink`: las tablas no se
  tocan, así que la sincronización continúa sin reconectar ni duplicar eventos.
- Configuración (`gcsClientId`, `gcsClientSecret`, `gcsRedirectUri`,
  `gcsSyncStartAt`).
- El scheduled job `GcsPushSweep` (AfterInstall es idempotente: no lo duplica).

## Migraciones futuras

No existe script de migración por versión en EspoCRM: la lógica de migración
se añade en `scripts/AfterInstall.php` bajo `$params['isUpgrade'] === true` y
debe ser idempotente.

## Reversión

1. `make gcs-uninstall` (no borra datos).
2. Instala el ZIP de la versión anterior (consérvalos en `build/` o usa Git:
   `git checkout <tag-anterior> -- extensions/espocrm-google-calendar-sync`).
3. `make gcs-install`.

Antes de actualizar en producción: `make espocrm-backup`.
