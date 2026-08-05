# 1 · Instalación

Tiempo estimado: 10 minutos, más los 15 de la configuración en Google
(`2-GOOGLE-CLOUD.md`), que puedes hacer antes o en el paso 4.

## Antes de empezar

Comprueba estas tres cosas en el CRM de destino. Ahorran la mayoría de los
problemas posteriores:

1. **Versión**: Administración → acerca de. Debe ser EspoCRM 10.0.x.
2. **Cron activo**: Administración → Trabajos Programados. Si los trabajos
   existentes no se han ejecutado en los últimos minutos, el cron no está
   configurado y la extensión no exportará nada. Resuélvelo primero.
3. **Copia de seguridad** de la base de datos. La instalación no borra datos,
   pero es buena costumbre.

## Paso 1 · Subir la extensión

Administración → **Extensiones** → *Upload* → selecciona el archivo
`google-calendar-sync-{versión}.zip` de esta carpeta → **Install**.

Alternativa por consola, si prefieres:

```bash
bin/command extension --file="google-calendar-sync-{versión}.zip"
```

Tras instalar, la lista de extensiones debe mostrar **Google Calendar Sync**
con la versión del ZIP que acabas de subir.

## Paso 2 · Reconstruir

Administración → **Rebuild**. Por consola:

```bash
bin/command rebuild
```

Esto crea las tablas `gcs_account` y `gcs_event_link`. Si te saltas este paso,
la extensión aparecerá instalada pero no funcionará.

## Paso 3 · Comprobar que responde

Administración → **Google Calendar Sync** → **Cuentas de Google**.

Debe abrirse un listado con un registro llamado **Calendario Business** en
estado *Desconectada*.

> Si sale un error 404 o «Controller does not exist», falta el rebuild del paso
> 2. Repítelo y limpia la caché.

## Paso 4 · Introducir las credenciales de Google

Necesitas el Client ID y el Client Secret de `2-GOOGLE-CLOUD.md`.

Administración → **Google Calendar Sync** → **Configuración**:

| Campo | Valor |
|---|---|
| Client ID de Google | El del cliente OAuth |
| Client Secret de Google | El del cliente OAuth (no se vuelve a mostrar) |
| URI de redirección OAuth | Se rellena sola. **Verifica** que coincide exactamente con la registrada en Google |

La URI es la del CRM más `/?entryPoint=gcsCallback`, por ejemplo
`https://crm.cliente.com/?entryPoint=gcsCallback`. Debe coincidir carácter a
carácter con la de Google Cloud, o la conexión fallará con
`redirect_uri_mismatch`.

Guarda.

## Paso 5 · Conectar la cuenta de Google

1. Administración → Google Calendar Sync → **Cuentas de Google**.
2. Abre **Calendario Business**.
3. Menú **⋮** → **Conectar con Google**.
4. Autoriza con la cuenta de Google del negocio y acepta los permisos.
5. Vuelves al CRM: la cuenta debe quedar en **Activa** y mostrar el correo
   detectado.

Debes estar conectado al CRM como administrador en ese mismo navegador; el
callback exige sesión de administrador.

## Paso 6 · Elegir el calendario

1. En la misma ficha, **Editar**.
2. **Calendario sincronizado**: elige el calendario de destino.
3. Guarda.

**Recomendación importante:** crea antes en Google Calendar un calendario
secundario —por ejemplo «Trabajo» o «Citas CRM»— y selecciona ese, no el
principal. Ventajas: la agenda del negocio queda separada de lo personal, y si
algún día quieres rehacer el espejo puedes vaciar ese calendario sin tocar nada
más.

Si el calendario recién creado no aparece en la lista, usa **⋮ → Actualizar
calendarios**.

## Listo

A partir de aquí, cada cita que se cree o modifique se exporta en menos de un
minuto. Continúa con `3-VERIFICACION.md` para confirmarlo.

## Qué se instala

- Entidades `GcsAccount` (cuentas de Google) y `GcsEventLink` (vínculo interno
  entre cita y evento).
- Una entrada de menú en Administración.
- Un trabajo programado, *Google Calendar Sync — Push Sweep*, que cada 5
  minutos reintenta las exportaciones que hubieran fallado.

No se modifica ninguna entidad existente salvo añadir una relación interna a
`Meeting`. No se tocan las invitaciones por correo ni el generador de ICS.
