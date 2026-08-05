# 4 · Mantenimiento

## Actualizar a una versión nueva

Sube el ZIP nuevo por Administración → Extensiones. EspoCRM desinstala la
versión anterior y aplica la nueva **conservando los datos**:

- Cuentas de Google y sus tokens: no hay que reconectar.
- Vínculos cita ↔ evento: no se duplica nada.
- Configuración (Client ID, Client Secret, calendario elegido).

Después, **Rebuild**. Y una comprobación rápida: que el listado de Cuentas de
Google sigue abriendo y una cita nueva se exporta.

Haz copia de la base de datos antes de actualizar en producción.

## Desinstalar

Administración → Extensiones → *Uninstall*.

**No borra nada**: ni citas, ni cuentas, ni vínculos, ni las tablas, ni la
configuración, ni los eventos ya creados en Google. Solo elimina los archivos y
el trabajo programado. Por eso, reinstalar recupera la sincronización tal como
estaba.

Para la mayoría de los casos, esto es todo. Si además necesitas dejar de usar
Google, basta con desconectar la cuenta (⋮ → **Desconectar**), que revoca el
acceso, y borrar el calendario secundario en Google Calendar si ya no lo
quieres. Eso no toca la base de datos.

## Diagnóstico

**Primer sitio donde mirar:** el campo **Último error** de la ficha de la
cuenta. Guarda el mensaje literal de Google y la fecha en UTC.

**Segundo:** el log de EspoCRM, en `data/logs/espo-{fecha}.log`. Para más
detalle, sube `logger.level` a `DEBUG` en `data/config.php`.

**Tercero:** Administración → **Jobs**. Los trabajos `GcsPushEvent` fallidos
aparecen en estado *Failed* con su mensaje.

### Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| No se exporta ninguna cita | Cron del CRM parado | Configúralo; sin él no funciona nada en segundo plano |
| Íd., con cron activo | No se eligió calendario | Ficha de la cuenta → Calendario sincronizado |
| 404 al abrir Cuentas de Google | Falta Rebuild tras instalar | Administración → Rebuild |
| `redirect_uri_mismatch` | URI distinta en el CRM y en Google | Deben coincidir carácter a carácter, incluido `https` y la barra |
| `invalid_grant` | Token revocado, o app OAuth en modo *Testing* (los tokens caducan a los 7 días) | Publica la app en Google Cloud y reconecta |
| No llega refresh token | Google solo lo entrega la primera vez | Revoca el acceso en <https://myaccount.google.com/permissions> y reconecta |
| Eventos duplicados | Dos instancias del CRM contra el mismo calendario | Un calendario por instancia |
| Un evento no se actualiza | Se borró a mano en Google | Se recrea solo en el siguiente barrido |
| La cuenta pasa a *Error* sola | Fallo temporal de red o de Google | El barrido reintenta cada 5 minutos; si persiste, mira Último error |

### El botón de emergencia

Si la sincronización se descuadra, desconecta la cuenta, vacía el calendario
secundario en Google y vuelve a conectar. Las citas del CRM no se tocan y el
barrido reconstruye el espejo de los últimos 14 días.

Por eso conviene usar un calendario secundario y no el principal.

## Límites conocidos de esta versión

- **Solo exporta.** Lo que se cree o edite directamente en el calendario de
  Google no llega al CRM, y se sobrescribirá en la siguiente exportación de esa
  cita.
- **No exporta el histórico**: solo las citas creadas o modificadas después de
  conectar la cuenta.
- **Sin recurrencia**: una cita es un evento; las citas periódicas no generan
  eventos recurrentes.
- **Sin invitados**: el evento no incluye asistentes, para que Google no envíe
  sus propias invitaciones y se mantenga el envío del CRM.
- **Retardo** de hasta 1 minuto, y hasta 5 para los reintentos.
- **Ventana de reintento de 14 días**: si la cuenta queda en error más tiempo,
  las citas anteriores se reexportan solo al modificarse de nuevo.

---

# Desinstalación total avanzada — destructiva

> ⚠️ **Esta sección elimina datos de forma irreversible.** No la sigas salvo
> que quieras borrar por completo el rastro de la extensión y entiendas lo que
> hace cada paso. La desinstalación normal (más arriba) **no** requiere nada de
> esto.

**Solo para administradores técnicos** con acceso a la base de datos y a los
archivos del servidor. Si no administras tú el servidor, para aquí.

## Antes de tocar nada

1. **Copia de seguridad completa y verificada** de la base de datos y de la
   carpeta `data/`. Verificada significa que has comprobado que restaura, no
   solo que el archivo existe. Los vínculos cita ↔ evento y las cuentas
   **no se pueden recuperar** de otro modo.
2. **Detén el cron / la sincronización** del CRM. Si un trabajo se ejecuta a
   mitad del proceso, puede recrear registros o fallar de forma confusa.
3. **Desconecta la cuenta de Google primero** (⋮ → Desconectar), estando la
   extensión aún instalada. Es la única forma limpia de revocar el acceso; una
   vez borradas las tablas ya no podrás hacerlo desde el CRM, solo desde
   <https://myaccount.google.com/permissions>.
4. **Comprueba los nombres reales de las tablas** en tu instalación antes de
   ejecutar ningún SQL. Los que aparecen abajo son los que usa esta extensión
   por defecto, pero confírmalo:

   ```sql
   SHOW TABLES LIKE 'gcs%';
   ```

## Pasos

1. Desinstala la extensión por la interfaz (Administración → Extensiones).
2. Elimina las tablas, **solo si `SHOW TABLES` confirmó estos nombres**:

   ```sql
   DROP TABLE IF EXISTS gcs_event_link;
   DROP TABLE IF EXISTS gcs_account;
   ```

3. Elimina de `data/config.php` y `data/config-internal.php` las claves
   `gcsClientId`, `gcsClientSecret`, `gcsRedirectUri` y `gcsSyncStartAt`.
4. Rebuild y limpieza de caché.
5. Reactiva el cron.

## Advertencias

- **No copies y pegues estos SQL sin verificar el entorno.** Asegúrate de estar
  conectado a la base de datos correcta: es un error frecuente y sin vuelta
  atrás.
- No se proporciona ningún script automático de borrado, a propósito. Cada paso
  debe ser una decisión consciente.
- Los eventos ya creados en Google Calendar **no** se eliminan con esto. Si los
  quieres fuera, borra el calendario secundario desde Google Calendar.
- Tras el borrado, reinstalar la extensión parte de cero: habrá que volver a
  configurar credenciales, reconectar Google y elegir calendario, y el espejo
  se reconstruirá solo con las citas que se modifiquen a partir de entonces.
