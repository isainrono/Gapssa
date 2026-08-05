# OAuth en EspoCRM — configuración y conexión

Prerequisito: credenciales creadas en Google Cloud (`GOOGLE_CLOUD_SETUP.md`).

## Dónde vive cada cosa

| Dato | Ubicación | Quién lo ve |
|---|---|---|
| Client ID | Administración > Google Calendar Sync > Configuración | Solo administradores |
| Client Secret | Misma pantalla; guardado con nivel `internal` | Nadie tras guardarlo (solo escritura) |
| Redirect URI | Misma pantalla; por defecto `{siteUrl}/?entryPoint=gcsCallback` | Solo administradores |
| Access/refresh token | Ficha GcsAccount, cifrados con `Espo\Core\Utils\Crypt` | Nunca por API (`entityAcl` forbidden) |
| State anti-CSRF | Campo interno `oauthState`, un solo uso | Nunca por API |

## Flujo de conexión (cuenta Business)

1. El administrador abre la ficha **Calendario Business**
   (Administración > Google Calendar Sync > Cuentas de Google).
2. ⋮ > **Conectar con Google** → el CRM genera la URL de autorización
   (`GET GcsSync/authUrl`) con `access_type=offline` y `prompt=consent`
   (imprescindible para recibir refresh token) y un `state` aleatorio guardado
   en la cuenta.
3. Google redirige a `{siteUrl}/?entryPoint=gcsCallback&code=...&state=...`.
   El entry point exige sesión de administrador, valida el `state` con
   `hash_equals` y lo invalida.
4. El CRM canjea el `code`, cifra y guarda los tokens, detecta el correo de la
   cuenta y cachea la lista de calendarios.
5. El administrador edita la ficha y elige el **Calendario sincronizado**
   (recomendado: calendario secundario “Trabajo”, no el principal).

## Acciones disponibles en la ficha

- **Conectar con Google** — inicia (o repite) la autorización. Repetirla no
  duplica nada; renueva tokens.
- **Actualizar calendarios** — recarga la lista de calendarios (si creaste el
  calendario “Trabajo” después de conectar).
- **Desconectar** — revoca los tokens en Google (best-effort) y los borra del
  CRM. No borra citas, vínculos ni el registro de la cuenta.

## Estados de la cuenta

- **Desconectada** — sin tokens. No se exporta nada.
- **Activa** — operativa. `Última sincronización` se actualiza con cada push.
- **Error** — el último push falló; el detalle está en `Último error`. El job
  de barrido (cada 5 min) reintenta automáticamente; si el error es de
  credenciales (`invalid_grant`), reconecta la cuenta.

## Renovación de tokens

El access token caduca en ~1 hora; la extensión lo renueva sola con el refresh
token (con margen de 2 minutos) y persiste el nuevo token cifrado. Si Google
devuelve `invalid_grant`, la cuenta pasa a **Error** con instrucciones en
`Último error`.
