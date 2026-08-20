---
name: gapssa-project-agent
description: Agente experto en el monorepositorio de Gapssa / GAPSSA by Nana (centro de estética en Barcelona) — arquitectura, reglas de negocio y estado de implementación de EspoCRM, la extensión Google Calendar Sync, el futuro portal Next.js/Payload/n8n/FacturaScripts, infraestructura Docker Compose y gobernanza del proyecto. Úsala para: fuentes de verdad de datos (Contact, Meeting/Cita, CTratamiento, CZonaAtencion), reservas y estados de cita, consentimientos y menores, integraciones EspoCRM↔Google Calendar↔n8n↔FacturaScripts, comandos `make gcs-*`/`docker compose`, `compose.yml`, `.env.example`, `PROJECT_CONTEXT.md`, `PLAN_DESARROLLO_WEB_PORTAL.md`, `extensions/espocrm-google-calendar-sync`, `gcs_account`, `gcs_event_link`, `apps/web`, `apps/cms`, `integrations/n8n`, portal `/mi-cuenta`, `gapssa.es`, `gapssa1`. Dispara también ante errores de sync de calendario, dudas sobre qué sistema es dueño de un dato, o peticiones de implementar reservas/auth/consentimientos para Gapssa.
---

# Gapssa — agente experto del proyecto

## Alcance

Esta skill aporta **conocimiento del proyecto**, no ejecuta nada. Todo output
debe ser accionable por el usuario: comando exacto (`make gcs-install`,
`docker compose logs espocrm`), código con ruta de archivo exacta, o pasos de
UI con menús literales de EspoCRM. No propongas trabajo que contradiga
`PROJECT_CONTEXT.md` o `PLAN_DESARROLLO_WEB_PORTAL.md` sin señalarlo
explícitamente como contradicción a resolver con el usuario.

## Reglas que evitan los errores más comunes de este proyecto

1. **No confundas plan con código.** `apps/web`, `apps/cms`,
   `packages/contracts`, `integrations/n8n`, `infra/docker` son carpetas
   vacías (solo `.gitkeep`) a fecha de esta skill. Next.js, Payload, n8n,
   Redis, PostgreSQL y FacturaScripts son **objetivo**, no están desplegados.
   Verifica siempre con `find`/`ls` antes de decir "el portal ya hace X".
2. **Respeta las fuentes de verdad.** Nunca propongas que la web decida
   disponibilidad, que n8n escriba precios, o que cualquier app escriba
   directo en la BD de otra. Consulta la tabla de propietarios de dato antes
   de diseñar un flujo nuevo.
3. **No inventes reglas de negocio ni valores pendientes** (precios,
   duraciones, textos legales, políticas de cancelación...). Si la tarea
   depende de uno, dilo explícitamente como bloqueante en vez de rellenarlo.
4. **`Meeting` = "Cita" en la interfaz, no una entidad `Cita` aparte.** Y los
   cambios de contactos en una cita se detectan con `AfterRelate`, no con
   `afterSave` — mezclar esto produce hooks que nunca se disparan.
5. **Cambiar `composer.json` de la extensión GCS exige refirmar el lock**
   (`make gcs-lock` o `make gcs-relock` según el caso) antes de
   `make gcs-deps`, o todo falla por diseño.

## Instrucción anti-alucinación

Si no estás seguro de un nombre de campo, endpoint, comando o tabla de este
proyecto, dilo explícitamente y remite a la referencia o al archivo fuente
(`PROJECT_CONTEXT.md`, `docs/espocrm-modelo-inicial.md`,
`extensions/espocrm-google-calendar-sync/docs/`) en vez de adivinar. No
generalices con documentación pública de EspoCRM/n8n cuando la pregunta es
sobre una decisión específica de **este** proyecto.

## Enrutamiento

Muchas preguntas cruzan dos archivos (p. ej. "reserva con Google Calendar"
toca 03 y 04). Lee ambos si aplica.

| Si la pregunta trata de... | Lee |
|---|---|
| Modelo de negocio, catálogo, precios, estados de cita, quién es dueño de qué dato, qué no se puede inventar | `references/01-fuentes-de-verdad-y-reglas-negocio.md` |
| Arquitectura general, qué está construido vs. planeado, integraciones EspoCRM↔Google↔FacturaScripts↔n8n, reglas de idempotencia/reintentos | `references/02-arquitectura-e-integraciones.md` |
| Entidades EspoCRM (`Contact`, `Meeting`, `CTratamiento`, `CZonaAtencion`), extensión Google Calendar Sync (hooks, jobs, `gcs-*`, límites, seguridad de tokens) | `references/03-espocrm-modelo-y-extension-gcs.md` |
| Portal Next.js/Payload: auth, reservas, bloqueos de horario, consentimientos, menores, `/mi-cuenta`, fases de implementación | `references/04-portal-web-reservas-plan.md` |
| Docker Compose, `.env`, comandos `make` raíz, backups, despliegue VPS/Plesk, calendario de fechas | `references/05-infraestructura-y-operacion.md` |
| Seguridad, privacidad, RGPD-like, gobernanza, "reglas de trabajo obligatorias", criterio para cambios nuevos | `references/06-seguridad-privacidad-y-gobernanza.md` |

## Núcleo mínimo

- Negocio: centro único, una profesional, 55 conceptos de catálogo, sin
  inyecciones/procedimientos sanitarios. Precio = base + suplementos −
  descuentos.
- EspoCRM 10.0.3, contenedores `espocrm`/`espocrm-db`/`espocrm-daemon`/
  `espocrm-websocket`, HTTP en `localhost:8081`, EUR, `es_ES`,
  `Europe/Madrid`.
- Cliente = `Contact`. Cita = `Meeting` (mostrado "Cita"). Tratamiento =
  `CTratamiento`. Zona = `CZonaAtencion`.
- Extensión **Google Calendar Sync** v1.1.1, fase 1: solo EspoCRM → Google,
  un calendario Business, hook encola job, barrido cada 5 min, ventana 14
  días. Fase 2 (pull bidireccional) no construida.
- Portal Next.js + Payload + PostgreSQL + Redis + n8n: **plan**, objetivo V1
  1 de septiembre de 2026, nada desplegado aún.
- n8n orquesta EspoCRM/Google/FacturaScripts; uso exclusivamente interno, sin
  revender ni exponer a clientes.
- FacturaScripts: futura fuente de verdad de precios/pagos/facturas; sin
  integrar todavía.
- Reserva de invitado: retención 10 min sin verificar → bloqueo formal 5h →
  aprobación manual → caduca sin respuesta en 5h. Máx. 2 solicitudes
  pendientes por cliente.
- Todo secreto fuera del repo; navegador nunca llama directo a
  EspoCRM/n8n/FacturaScripts, solo al BFF de Next.js.
- `gapssa1/` es referencia visual (no versionada), no la implementación real
  de `apps/web`.

## Gotchas caros

- El barrido de reintentos de GCS filtra por `Meeting.modifiedAt`: renombrar
  un `Contact` o relacionar/desrelacionar un contacto **no** toca esa
  columna, así que el barrido nunca corrige un título desactualizado por sí
  solo — existen hooks dedicados para eso (`GcsContactRename`, `AfterRelate`
  con `gcsSync`). Ver 03 antes de "arreglar" esto de otra forma.
- `silent` se ignora en `afterSave` pero **no** en los hooks de relación de
  la extensión GCS: si tratas ambos igual, reintroduces un bug ya corregido.
- App OAuth de Google en modo Testing: refresh tokens caducan a los 7 días,
  no es un fallo de la extensión.
- `docker compose down --volumes` borra la base de datos local completa; no
  proponerlo como solución rápida a nada.
