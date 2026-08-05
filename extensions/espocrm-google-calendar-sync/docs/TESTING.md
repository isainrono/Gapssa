# Pruebas de aceptación — Fase 1

Prerrequisitos: extensión instalada (`make gcs-install`), credenciales OAuth
configuradas, cuenta Business conectada y calendario de pruebas elegido
(crea en Google Calendar un calendario secundario `Pruebas CRM` y selecciónalo).

El cron procesa los jobs cada minuto; tras cada acción espera ~1 minuto o
ejecuta manualmente:

```bash
docker compose exec espocrm php daemon.php --run-once 2>/dev/null || \
docker compose exec espocrm bin/command run-job-queue 2>/dev/null || true
```

Estado rápido en cualquier momento: `make gcs-status`.

## Comprobación previa: la extensión responde

Hazla siempre después de instalar o actualizar, **antes** de tocar OAuth. Un
ZIP puede instalarse sin errores y aun así devolver 404 si falta el controlador
de alguna entidad (ocurrió en la v1.0.0; ver `TEST_RESULTS.md`, revisión 4).

```bash
make health          # bin/command app-check

# La API de la entidad debe responder 200, no 404
docker compose exec espocrm php -r '
$c = curl_init("http://localhost/api/v1/GcsAccount");
curl_setopt_array($c, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_USERPWD=>"admin:TU_PASSWORD", CURLOPT_HTTPAUTH=>CURLAUTH_BASIC]);
$r = curl_exec($c);
echo "HTTP ", curl_getinfo($c, CURLINFO_RESPONSE_CODE), "\n", substr($r,0,300), "\n";'
```

Debe devolver `HTTP 200` y un JSON con `"total": 1` y el registro
**Calendario Business**. En la interfaz: Administración → Google Calendar Sync
→ **Cuentas de Google** abre el listado con ese registro en estado
*Desconectada*.

Si aparece `Controller '...' does not exist`, falta el controlador de esa
entidad: `make gcs-build` lo verifica ahora automáticamente.

## Casos

### 1–2. Conexión y calendario

1. Conectar la cuenta Business (⋮ > Conectar con Google) → estado **Activa**,
   correo detectado.
2. Elegir el calendario `Pruebas CRM` → campo guardado y nombre visible.

### 3–4. Alta de cita

3. Crear una cita en EspoCRM (nombre, fecha futura, 60 min).
4. Comprobar en Google Calendar que aparece **una sola vez**, con título, hora
   local correcta (Europe/Madrid) y descripción.

### 5–6. Modificación

5. Cambiar fecha y hora de la cita en EspoCRM.
6. Comprobar que **el mismo evento** se mueve (no se crea otro). El evento
   conserva su id; verifica que solo hay un evento con ese título.

### 7–8. Cambio de profesional

7. Cambiar el usuario asignado de la cita.
8. El evento Business se mantiene actualizado (en fase 1 el destino no cambia;
   el push se re-ejecuta sin duplicar).

### 9–10. Cancelación

9. Cambiar el estado de la cita a **No realizada** (`Not Held`, el estado
   cancelado configurado en esta instancia).
10. Política definida: el evento **se elimina** del calendario Business. La
    cita sigue en EspoCRM con su historial. Si se reactiva la cita (estado
    Planificada), el evento se vuelve a crear en el siguiente push o barrido.

### 11–13. Errores y reintentos

11. Simular un error de Google: en Configuración, cambia temporalmente el
    Client Secret por un valor inválido y desconecta+conecta... — más sencillo:
    corta la salida de red del contenedor o revoca el acceso en
    <https://myaccount.google.com/permissions>. Después crea/modifica una cita.
12. Comprobar que la cita **se guarda igualmente** en EspoCRM (el hook solo
    encola; nunca bloquea el guardado), que el job queda en estado Failed
    (Administración > Jobs) y que la cuenta pasa a **Error** con el detalle en
    `Último error`.
13. Restablecer el acceso (reconectar la cuenta). El scheduled job
    `GcsPushSweep` (cada 5 min) reintenta automáticamente. Comprobar que el
    evento aparece **una sola vez** (la búsqueda por `espoMeetingId` en Google
    impide duplicados incluso si el vínculo local se perdió).

### 14. Persistencia

14. `docker compose down && docker compose up -d`. Comprobar que la cuenta
    sigue **Activa** (tokens en BD), que el scheduled job sigue programado y
    que una nueva cita se sigue exportando.

## Verificaciones adicionales

- Los hooks de invitaciones por correo existentes siguen funcionando (crear
  cita con contacto con email → llega la invitación ICS de siempre).
- `GET /api/v1/GcsAccount/{id}` como admin **no** devuelve `accessToken`,
  `refreshToken`, `oauthState` ni `syncToken`.
- Desinstalar (`make gcs-uninstall`) y reinstalar no borra citas ni cuentas, y
  la reinstalación re-adopta los eventos existentes sin duplicar (vínculos
  conservados + red anti-duplicados).
