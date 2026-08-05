# Google Calendar Sync — paquete de instalación

Extensión para EspoCRM que copia las citas (`Meeting`) a un calendario de
Google administrado por el negocio.

## Contenido de esta carpeta

| Archivo | Para qué |
|---|---|
| `google-calendar-sync-{versión}.zip` | **La extensión.** Es lo único que se sube al CRM |
| `1-INSTALACION.md` | Pasos de instalación, de principio a fin |
| `2-GOOGLE-CLOUD.md` | Crear el proyecto y las credenciales en Google |
| `3-VERIFICACION.md` | Comprobar que funciona antes de darlo por bueno |
| `4-MANTENIMIENTO.md` | Actualizar, desinstalar y diagnosticar problemas |

## Orden de trabajo

```
2-GOOGLE-CLOUD.md   →   1-INSTALACION.md   →   3-VERIFICACION.md
(15 min, en Google)     (10 min, en el CRM)    (10 min)
```

Puedes hacer el paso de Google antes o después de instalar; necesitarás sus
credenciales en el punto 4 de la instalación.

## Qué hace y qué no

**Hace:** cada cita creada, modificada o cancelada en EspoCRM aparece,
se actualiza o se elimina en un calendario de Google. En segundo plano, sin
bloquear el guardado, y con reintentos automáticos si Google falla.

**No hace (todavía):** no importa nada desde Google. Lo que se edite
directamente en ese calendario no vuelve al CRM y se sobrescribirá en la
siguiente exportación de esa cita. La sincronización bidireccional por
profesional es la fase 2.

## Requisitos del servidor de destino

- EspoCRM **10.0.x** (probado en 10.0.3).
- PHP **8.3** o superior con `curl` y `json` (es el mínimo que ya exige
  EspoCRM 10).
- **Cron de EspoCRM funcionando.** Sin cron no se exporta ninguna cita: es el
  requisito que más se pasa por alto.
- Módulo CRM activo (la entidad `Meeting`).
- Una cuenta de Google para el negocio.

No hace falta Composer, ni red durante la instalación, ni tocar el servidor por
SSH: el ZIP lleva dentro todas sus dependencias.

## Importante si administras varias instalaciones

Cada EspoCRM debe sincronizar **su propio calendario de Google**. Si dos
instancias apuntan al mismo, sus exportaciones se pisarán: los identificadores
internos de cita de una no significan nada en la otra.
