# Configuración de Google Cloud para Google Calendar Sync

Guía paso a paso para vincular EspoCRM con Google Calendar. Tiempo estimado:
15–20 minutos. Necesitas una cuenta de Google (la del negocio) con acceso a
[Google Cloud Console](https://console.cloud.google.com).

## 1. Crear el proyecto en Google Cloud

1. Entra en <https://console.cloud.google.com> con la cuenta de Google del negocio.
2. En la barra superior, pulsa el selector de proyectos y luego **New Project**.
3. Nombre del proyecto: el del negocio, por ejemplo `CRM Calendar Sync`.
   Organización: déjala vacía si
   no usas Google Workspace.
4. Pulsa **Create** y espera a que el proyecto quede seleccionado (compruébalo
   en la barra superior).

## 2. Habilitar Google Calendar API

1. Menú ☰ > **APIs & Services** > **Library**.
2. Busca `Google Calendar API`.
3. Ábrela y pulsa **Enable**.

## 3. Configurar la pantalla de consentimiento

1. Menú ☰ > **APIs & Services** > **OAuth consent screen** (en consolas
   recientes: **Google Auth Platform** > **Branding/Audience**).
2. Tipo de usuario: **External** (salvo que la cuenta pertenezca a un Google
   Workspace propio; en ese caso, **Internal**, que evita el paso 11).
3. Rellena:
   - App name: el nombre del negocio, tal como lo verá quien autorice.
   - User support email: la cuenta del negocio.
   - Developer contact: la misma dirección.
4. Guarda. No hace falta subir logotipo ni dominios verificados para uso interno.
5. En **Audience** (o "Test users"), añade como usuario de prueba la dirección
   de Google del negocio (la que vas a conectar). Mientras la app esté en modo
   **Testing**, solo estas direcciones podrán autorizar.

## 4. Scopes utilizados

La extensión solicita únicamente:

- `https://www.googleapis.com/auth/calendar.events` — crear, modificar y
  eliminar eventos.
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly` — listar los
  calendarios para poder elegir cuál sincronizar.

No es necesario añadirlos manualmente en la pantalla de consentimiento para el
modo Testing; Google los mostrará al autorizar. Si publicas la app (paso 11),
decláralos en la sección **Data Access / Scopes**.

## 5. Crear el OAuth Client ID (tipo Web)

1. Menú ☰ > **APIs & Services** > **Credentials**.
2. **Create Credentials** > **OAuth client ID**.
3. Application type: **Web application**.
4. Name: `EspoCRM`.
5. En **Authorized redirect URIs**, añade exactamente la URI del paso 6.
6. Pulsa **Create**. Google mostrará el **Client ID** y el **Client Secret**:
   cópialos a un lugar seguro (el secret solo se muestra completo aquí).

## 6. Redirect URI que debes copiar

La URI es la URL de **tu** CRM seguida de `/?entryPoint=gcsCallback`.
Ejemplos, sustituye por el dominio y puerto reales:

- Producción (ejemplo): `https://crm.tu-dominio.com/?entryPoint=gcsCallback`
- Entorno local (ejemplo): `http://localhost:8080/?entryPoint=gcsCallback`

Debe coincidir **carácter a carácter** con el campo "URI de redirección OAuth"
de EspoCRM (paso 7). Si cambias de entorno, añade la nueva URI aquí y actualiza
la configuración del CRM.

> Nota: Google no permite URIs `http://` salvo con `localhost`. Para producción
> es imprescindible HTTPS.

## 7. Introducir clientId y clientSecret en EspoCRM

1. Entra en EspoCRM como administrador.
2. **Administración** > sección **Google Calendar Sync** > **Configuración**.
3. Rellena:
   - **Client ID de Google**: el Client ID del paso 5.
   - **Client Secret de Google**: el Client Secret del paso 5 (no se volverá a
     mostrar una vez guardado).
   - **URI de redirección OAuth**: se rellena sola al instalar; verifica que
     coincide con la del paso 6.
4. Guarda.

## 8. Conectar la cuenta Business

1. **Administración** > **Google Calendar Sync** > **Cuentas de Google**.
2. Abre la cuenta `Calendario Business` (creada automáticamente al instalar).
3. Menú desplegable (⋮) > **Conectar con Google**.
4. Autoriza con la cuenta de Google del negocio (debe estar en la lista de
   usuarios de prueba del paso 3).
5. Acepta los permisos. Volverás al CRM y la cuenta aparecerá como **Activa**,
   con el correo de Google detectado.

## 9. Seleccionar el calendario

1. En la misma ficha, pulsa **Editar**.
2. En **Calendario sincronizado** elige el calendario de destino.
   - Recomendado: crea antes en Google Calendar un calendario secundario
     llamado **«Trabajo»** (o «Citas CRM») y elígelo aquí.
   - Evita el calendario principal: mantiene separada la agenda del negocio y
     permite borrar/regenerar el espejo sin tocar nada personal.
3. Guarda. Desde este momento las citas nuevas o modificadas se exportan.
   Si el calendario no aparece, usa ⋮ > **Actualizar calendarios**.

## 10. Verificar que el refresh token funciona

1. Crea una cita de prueba en EspoCRM y comprueba que aparece en Google.
2. En la ficha de la cuenta, verifica que **Token caduca** tiene fecha futura
   (~1 hora) y **Última sincronización** se actualiza.
3. Prueba real de renovación: espera más de 1 hora (o modifica una cita al día
   siguiente) y comprueba que la exportación sigue funcionando sin reconectar.
   La renovación es automática con el refresh token.
4. Si la cuenta pasa a **Error** con `invalid_grant`, el refresh token murió:
   revisa el paso 11 y vuelve a conectar.

## 11. Pasar de Testing a Production

En modo **Testing**, Google caduca los refresh tokens a los **7 días**: la
sincronización dejará de funcionar semanalmente hasta que publiques la app.

1. **OAuth consent screen / Audience** > **Publish app**.
2. Como los scopes de Calendar son "sensibles", Google puede indicar que la app
   necesita verificación. Para una app usada solo por el propio negocio:
   - Puedes publicarla sin completar la verificación; al autorizar aparecerá el
     aviso "Google no ha verificado esta aplicación" > **Advanced** >
     **Ir a la aplicación (no segura)**. Es aceptable porque tú eres el desarrollador
     y el único usuario.
   - Con Google Workspace propio, usa tipo **Internal**: sin verificación ni avisos.
3. Tras publicar, desconecta y vuelve a conectar la cuenta para obtener un
   refresh token sin caducidad de 7 días.

## 12. Diagnóstico de errores OAuth habituales

| Error | Causa | Solución |
|---|---|---|
| `redirect_uri_mismatch` | La URI de EspoCRM no coincide con la registrada | Copia exacta (esquema, puerto, barra) en ambos lados (pasos 5–7) |
| `access_denied` al autorizar | Cuenta no incluida como usuario de prueba | Añádela en Audience/Test users (paso 3) |
| `invalid_client` | Client ID o Secret mal copiados | Vuelve a pegarlos sin espacios; regenera el secret si hace falta |
| `invalid_grant` al renovar | Token revocado o app en Testing >7 días | Publica la app (paso 11) y reconecta |
| No vuelve refresh token | Google solo lo emite la primera vez | Revoca el acceso en <https://myaccount.google.com/permissions> y reconecta (la extensión ya fuerza `prompt=consent`) |
| `403 Forbidden` al conectar desde el CRM | Usuario sin permisos de administrador | Conéctate como administrador |
| La página del callback da error de sesión | El admin no tenía sesión abierta en el CRM en ese navegador | Inicia sesión en el CRM y repite ⋮ > Conectar con Google |
| Cuenta en estado **Error** | Ver campo **Último error** de la ficha | El mensaje incluye el detalle devuelto por Google |

Más diagnóstico: el log de EspoCRM en `data/logs/espo-{fecha}.log`. Sube
`logger.level` a `DEBUG` en `data/config.php` si necesitas más detalle. En una
instalación con Docker, el log se lee desde dentro del contenedor de EspoCRM.
