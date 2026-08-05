# Desinstalar la extensión

## Procedimiento

```bash
make gcs-uninstall
```

o en Administración > Extensiones > Uninstall.

## Qué hace (y qué no)

**Hace:**

- Elimina los archivos del módulo y las vistas del cliente.
- Elimina el registro del scheduled job `GcsPushSweep` (`BeforeUninstall`).

**No hace (política deliberada: sin acciones destructivas):**

- No borra ninguna cita (`Meeting`).
- No borra los registros `GcsAccount` ni `GcsEventLink` ni sus tablas
  (`gcs_account`, `gcs_event_link`): EspoCRM conserva las tablas de entidades
  eliminadas hasta que se limpian manualmente.
- No borra la configuración (`gcsClientId`, `gcsClientSecret`, `gcsRedirectUri`,
  `gcsSyncStartAt`).
- No toca los eventos ya creados en Google Calendar.
- No revoca los tokens de Google.

Gracias a esto, reinstalar la extensión recupera la sincronización tal como
estaba, sin reconectar ni duplicar eventos.

## Limpieza manual opcional (solo si no vas a reinstalar)

1. **Revocar el acceso a Google** (recomendado): antes de desinstalar, abre la
   cuenta y usa ⋮ > Desconectar; o revoca la aplicación OAuth en
   <https://myaccount.google.com/permissions>.
2. **Eliminar los eventos espejo**: borra el calendario secundario que hayas
   sincronizado desde Google Calendar. Por eso se recomienda no usar el principal.
3. **Eliminar datos y configuración** (irreversible; haz copia de seguridad
   verificada de la base de datos antes):

   ```sql
   DROP TABLE IF EXISTS gcs_event_link;
   DROP TABLE IF EXISTS gcs_account;
   ```

   y eliminar `gcsClientId`, `gcsClientSecret`, `gcsRedirectUri` y
   `gcsSyncStartAt` de `data/config.php` / `data/config-internal.php`.

Ninguno de estos pasos se ejecuta automáticamente; requieren confirmación
explícita del administrador.
