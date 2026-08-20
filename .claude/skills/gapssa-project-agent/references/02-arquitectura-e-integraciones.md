# Arquitectura técnica e integraciones

Fuente: `/PROJECT_CONTEXT.md` §11–15 y `/PLAN_DESARROLLO_WEB_PORTAL.md` §4, más
inspección directa del repositorio (5 de agosto de 2026). Marca: **[DOC]**
decisión validada, **[SRC]** verificado en el repo (código/config),
**[ND]** planeado pero no construido todavía.

## 1. Estado real de implementación — lee esto primero [SRC]

No asumas que algo existe porque aparece en los documentos de planificación.
Estado verificado del monorepo en la fecha de esta skill:

| Pieza | Estado |
|---|---|
| EspoCRM (Docker Compose) | **Funcionando**: `espocrm`, `espocrm-db`, `espocrm-daemon`, `espocrm-websocket` |
| Extensión Google Calendar Sync | **Implementada y empaquetada**, versión 1.1.1, fase 1 (solo salida) |
| `apps/web` (Next.js) | **Vacío**, solo `.gitkeep` |
| `apps/cms` (Payload) | **Vacío**, solo `.gitkeep` |
| `packages/contracts` | **Vacío**, solo `.gitkeep` |
| `integrations/n8n` | **Vacío**, solo `.gitkeep`. n8n no está desplegado en `compose.yml` |
| `infra/docker` | **Vacío**, solo `.gitkeep` |
| FacturaScripts | No integrado, no hay contenedor ni código |
| `gapssa1/gapssa-web` | Directorio **no versionado** (aparece como `??` en `git status`, permisos `700`) con un scaffold temprano de Next.js 16 + React 19 + Tailwind 4 + `framer-motion` + `lucide-react`, y una ruta `app/portal` todavía vacía. Es material de referencia visual, **no** la implementación de `apps/web` — el propio plan dice explícitamente "usar `gapssa1` como referencia, no como implementación final ni como código que deba copiarse literalmente" |

Antes de decir "la web ya usa X" o "n8n ya hace Y", comprueba el estado real
con `find apps integrations infra packages -type f` o equivalente: la
arquitectura de abajo es en gran parte **objetivo**, no código corriendo.

## 2. Arquitectura de negocio validada (objetivo) [DOC]

```text
                    ┌────────────────────────┐
                    │ Web / Payload CMS      │
                    │ Next.js + React + TS   │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │ n8n Community Edition  │
                    │ Orquestación interna   │
                    └───┬────────┬────────┬──┘
                        │        │        │
              ┌─────────▼─┐  ┌───▼────┐  ┌▼────────────────┐
              │ EspoCRM   │  │ Google │  │ FacturaScripts  │
              │ CRM       │  │Calendar│  │ ERP             │
              └───────────┘  └────────┘  └─────────────────┘
```

### Tecnologías por capa [DOC]
- Web y área privada: **Next.js + React + TypeScript**.
- Contenidos: **Payload CMS**.
- CRM: **EspoCRM** (hoy 10.0.3, imagen `espocrm/espocrm:10.0.3-apache-trixie`
  [SRC, `.env.example`]).
- ERP: **FacturaScripts** (futuro).
- Automatización: **n8n Community Edition**.
- Extensiones EspoCRM y plugins FacturaScripts: **PHP**.
- Componentes web/auxiliares: **TypeScript**.
- Despliegue: Docker sobre VPS con Plesk.

## 3. Arquitectura técnica del portal (objetivo, plan de agosto) [DOC]

```text
Cliente
   |
   v
Next.js: web pública + reservas + portal
   |
   v
API/BFF privada de Next.js
   |------------> Payload CMS: contenido y traducciones
   |------------> EspoCRM: clientes, catálogo operativo y citas
   |------------> PostgreSQL: autenticación, sesiones y datos auxiliares
   |------------> Redis: códigos, bloqueos, límites y colas
   |------------> n8n: automatizaciones y comunicaciones
   `-. futuro .-> FacturaScripts: precios, pagos y facturación

EspoCRM <-------> Google Calendar, como agenda complementaria
```

Regla dura: **el navegador nunca accede directamente a EspoCRM, n8n o
FacturaScripts**. Next.js es la única capa BFF que autentica, autoriza y
valida. Antes de fijar versiones de Next.js/Payload/adaptadores de base de
datos, comprobar compatibilidad actual — no asumir APIs antiguas [DOC].

## 4. Integraciones principales [DOC]

### 4.1 Google Calendar → EspoCRM (vía n8n, fase 2 de la extensión, [ND])
1. n8n detecta evento creado/modificado/cancelado.
2. Localiza relación existente o busca cliente por teléfono.
3. Crea ficha básica si no hay coincidencia fiable.
4. Crea/actualiza la cita en EspoCRM.
5. Valida horario, zona y solapamientos.
6. Si hay conflicto, conserva la situación anterior y pide revisión.
7. Registra resultado, identificadores y errores.

Esta dirección **todavía no está construida**: la extensión GCS instalada hoy
es fase 1, solo salida (Espo → Google) — ver
[[03-espocrm-modelo-y-extension-gcs]].

### 4.2 EspoCRM → Google Calendar (implementado, fase 1) [SRC]
1. EspoCRM comunica el cambio (hook `afterSave`/`afterRemove` de `Meeting`).
2. Se encola un job en el grupo `gcs-push`; nunca se llama a Google desde el
   propio hook.
3. `SyncService` crea/actualiza/borra el evento en el calendario Business.
4. Transfiere solo información operativa mínima: título (con nombre de
   cliente), descripción, fechas, id interno de la cita.
5. Conserva la relación cita↔evento en `GcsEventLink`.
6. `gcsSync` marca los cambios originados por la propia sincronización para
   evitar bucles.

Detalle completo (hooks exactos, anti-duplicados, cancelación, límites) en
[[03-espocrm-modelo-y-extension-gcs]].

### 4.3 EspoCRM → FacturaScripts [ND, futuro]
1. Cita completada → operación económica pendiente.
2. Varias citas de una visita pueden agruparse.
3. FacturaScripts registra cobro y emite documento fiscal.
4. Devuelve número, importe, estado y referencia a EspoCRM.
5. Las correcciones generan ajustes/rectificativas; **nunca** eliminan el
   original.

### 4.4 Consumo de stock [ND, futuro]
1. EspoCRM propone consumibles asociados al tratamiento.
2. La profesional confirma cantidades/lotes reales.
3. n8n envía el consumo a FacturaScripts.
4. FacturaScripts registra la salida y confirma o marca incidencia.

## 5. Reglas de integración obligatorias [DOC]

Aplican a **cualquier** integración nueva que construyas en este proyecto:

- Cada registro relacionado conserva identificadores externos.
- Cada envío lleva una clave de idempotencia.
- Se registra el sistema de origen.
- Los reintentos **no pueden crear duplicados**.
- Una interrupción deja la operación en espera, nunca la descarta.
- Las operaciones críticas no se comunican como definitivas hasta que responde
  el sistema responsable.
- Las discrepancias no se corrigen silenciosamente.
- Las eliminaciones se modelan como estados o anulaciones con historial, no
  como `DELETE` físico salvo excepción justificada.
- Cada cambio sensible registra valor anterior, valor nuevo, fecha, usuario o
  sistema, canal y motivo.

La conciliación diaria debe detectar como mínimo: citas completadas sin
operación económica, cobros sin factura o con diferencias, consumos de stock
pendientes, eventos de Google Calendar sin vínculo con EspoCRM, posibles
clientes duplicados, renovaciones cobradas sin beneficios activados,
devoluciones sin reflejo operativo, errores de sincronización pendientes.

## 6. Infraestructura de red y subdominios (objetivo de producción) [DOC]

- VPS con Plesk como proxy inverso y terminación HTTPS.
- Dominio principal `gapssa.es`.
- `gapssa.es`: web pública · `crm.gapssa.es`: EspoCRM ·
  `erp.gapssa.es`: FacturaScripts · `automatiza.gapssa.es`: n8n ·
  `staging.gapssa.es`: pruebas de la web.
- Entornos de prueba de CRM/ERP/n8n: protegidos y **no indexados**.
- Bases de datos aisladas, credenciales independientes por app.
- Comunicación entre apps mediante APIs y eventos, nunca escritura directa a
  BD ajena.
- Red privada Docker para BD y servicios internos.

En local hoy solo existe la red Docker de EspoCRM (`public`/`private` en
`compose.yml`) — ver [[05-infraestructura-y-operacion]].

## 7. Propiedad de datos del portal (detalle Next.js) [DOC]

| Dominio | Propietario |
|---|---|
| Identidad operativa y ficha del cliente | EspoCRM |
| Credenciales, sesiones, verificación de acceso | Aplicación web |
| Tratamientos y capacidad profesional | EspoCRM |
| Citas, estados y disponibilidad | EspoCRM |
| Cuestionarios y consentimientos | EspoCRM |
| Contenido editorial y traducciones | Payload CMS |
| Precios, impuestos y pagos | FacturaScripts (fase posterior) |
| Bloqueos y códigos temporales | Redis |
| Automatizaciones y notificaciones | n8n |

## 8. Antes de proponer una integración nueva

1. Comprueba primero si ya existe algo real (§1) — no diseñes sobre una pieza
   vacía como si estuviera implementada.
2. Verifica contra la tabla de fuentes de verdad de
   [[01-fuentes-de-verdad-y-reglas-negocio]] quién es el propietario del dato.
3. Aplica las reglas de integración de §5 (idempotencia, auditoría,
   reintentos sin duplicar).
4. Si la integración toca EspoCRM, revisa el modelo real de entidades en
   [[03-espocrm-modelo-y-extension-gcs]] antes de asumir nombres de campos.
5. Si toca el portal Next.js, revisa las reglas de auth/reservas en
   [[04-portal-web-reservas-plan]] — muchas ya tienen temporizaciones y
   límites exactos (p. ej. bloqueo de horario de 5 horas) que no deben
   reinventarse.
