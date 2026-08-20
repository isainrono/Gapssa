# `apps/web` — portal, web pública y Payload CMS

Next.js 16 (App Router) + Payload CMS 3 embebido en la misma app, siguiendo
la arquitectura oficial de Payload 3 (se instala directamente dentro de un
proyecto Next.js — no como servidor aparte). BFF: esta app es la única capa
autorizada a hablar con EspoCRM, n8n y FacturaScripts
(`PLAN_DESARROLLO_WEB_PORTAL.md` §2). Fase 1 monta la base; no hay flujos de
negocio reales todavía.

## Decisión de arquitectura: una sola app, no `apps/cms` separada

`PROJECT_CONTEXT.md`/`PLAN_DESARROLLO_WEB_PORTAL.md` mencionan Payload como
una pieza propia, y el esqueleto original del repositorio incluye una
carpeta `apps/cms` vacía. Tras revisar la documentación oficial actual de
Payload (payloadcms.com/docs, agosto 2026): **Payload 3 se instala e integra
directamente dentro de una app Next.js existente** (paquete
`@payloadcms/next`, ruta `app/(payload)/...`), y es el patrón que la propia
Payload promueve activamente como reemplazo de la arquitectura Express
independiente de Payload 2. Por eso Payload vive dentro de `apps/web`
(`src/payload.config.ts` + `src/app/(payload)/`), y `apps/cms/` se deja
vacía a propósito (con un `README.md` explicándolo) en vez de forzar una
segunda app Next.js redundante.

Justificación frente a los criterios pedidos:

- **Desarrollo local**: un solo `next dev`, un solo puerto, un solo proceso
  — menos piezas que sincronizar que dos apps Next.js independientes.
- **Despliegue**: un solo build, un solo contenedor/servicio en producción
  (Fase 7), no dos despliegues coordinados.
- **Escalado**: Payload no tiene estado propio distinto del de Next.js
  (ambos son *stateless*, la persistencia vive en Postgres); escalar
  horizontalmente la app escala ambos a la vez. Si en el futuro el panel de
  administración necesitara escalar por separado del tráfico público, es
  una decisión de infraestructura (reverse proxy por ruta), no de código.
- **Autenticación administrativa**: la gestiona Payload igual que si fuera
  independiente (colección `Users`, `auth: true`); vivir en la misma app no
  la debilita — Payload sigue teniendo su propio sistema de sesión para
  `/admin`, separado del futuro sistema de auth del portal (`gapssa_auth`,
  Fase 3).
- **Migraciones**: las de Payload (`payload migrate`) actúan sobre
  `gapssa_cms` exclusivamente; no se mezclan con `gapssa_auth`/`gapssa_booking`
  (bases separadas, ver `infra/postgres/README.md`).
- **Comunicación con "apps/web"**: no aplica como problema — es la misma
  app. Las páginas públicas usan la Local API de Payload
  (`getPayload({ config })`) sin pasar por HTTP.

## Estrategia de consumo de `@gapssa/contracts`

Se consume como **workspace fuente**, no compilado: `@gapssa/contracts`
exporta TypeScript sin transpilar (`"main": "./src/index.ts"`), y
`next.config.ts` declara `transpilePackages: ['@gapssa/contracts']` para que
Next.js lo compile con su propio pipeline (mismo mecanismo que usa para el
código de `apps/web`). Alternativa descartada por ahora: compilar el
paquete a `dist/` con declaraciones — añadiría un paso de build y una
carpeta generada que sincronizar en cada cambio, sin necesidad real todavía
(un único consumidor, mismo monorepo, mismo `tsconfig` "Bundler"). Revisar
esta decisión si `@gapssa/contracts` gana consumidores fuera de Next.js/Node
con imports `.ts` nativos (p. ej. un futuro worker fuera del monorepo).

Import real de prueba: `src/components/server/ContractsBadge.tsx` importa
`GUEST_VERIFICATION_HOLD_MINUTES`/`APPROVAL_HOLD_HOURS` de
`@gapssa/contracts` y los renderiza; `ContractsBadge.test.tsx` comprueba que
el valor real llega hasta el render.

## Estructura

```
src/
  app/
    (payload)/    Rutas oficiales de Payload (admin, API REST/GraphQL) — no modificar el patrón sin revisar la documentación oficial
    (frontend)/[locale]/   Web pública e i18n (6 idiomas)
    api/health/    Health check propio (no confundir con la API de Payload)
  proxy.ts         Redirección "/" -> "/es" (convención Next.js 16.1+; reemplaza a middleware.ts). Fase 1: sin negociación de idioma todavía
  collections/     Colecciones de Payload (Users, PruebaContenido)
  components/
    client/        Componentes 'use client' (interactivos)
    server/        Componentes de servidor (por defecto, sin 'use client')
  server/          Código exclusivo de servidor: `import 'server-only'` en cada módulo,
                   falla el build si algo aquí se importa desde un componente cliente.
                   env.ts (variables validadas con zod), redis.ts (solo health check en Fase 1).
  lib/             Utilidades compartidas cliente+servidor (i18n, env.public.ts)
  payload.config.ts
```

## Variables de entorno

Ver `.env.example` en la raíz del monorepo (una sola fuente para todo el
proyecto). `src/server/env.ts` valida en el arranque:
`PAYLOAD_SECRET`, `DATABASE_URL_CMS`, `DATABASE_URL_AUTH`,
`DATABASE_URL_BOOKING`, `REDIS_URL`, `REDIS_KEY_PREFIX`, y las variables de
Fase 3 (`OTP_HMAC_SECRET` sin valor por defecto; `OTP_*`/`AUTH_*`/
`ARGON2_*`/`SMTP_*` con valores técnicos sugeridos configurables — ver
`docs/fase3-autenticacion.md` §7). Ninguna variable de servidor lleva el
prefijo `NEXT_PUBLIC_`; lo único público es `NEXT_PUBLIC_SITE_URL`
(`src/lib/env.public.ts`).

## Comandos

Ejecutar desde la raíz del monorepo (cargan `.env` automáticamente vía
`dotenv-cli`): `npm run dev`, `npm run build`, `npm run lint`,
`npm run typecheck`, `npm run test`, `npm run test:integration`,
`npm run test:e2e`.

Específicos de este workspace: `npm run generate:types -w @gapssa/web`
(regenera `src/payload-types.ts`), `npm run generate:importmap -w @gapssa/web`
(regenera `src/app/(payload)/admin/importMap.js`), `npm run payload -w @gapssa/web -- migrate`
(migraciones de Payload sobre `gapssa_cms`), `npm run auth:db:generate -w @gapssa/web`
/ `npm run auth:db:migrate -w @gapssa/web` (migraciones de Drizzle sobre
`gapssa_auth`, Fase 3), `npm run booking:db:generate -w @gapssa/web` /
`npm run booking:db:migrate -w @gapssa/web` (migraciones de Drizzle sobre
`gapssa_booking`, Fase 4A — ver `infra/postgres/README.md`). Los cuatro
comandos `*:db:*` necesitan `DATABASE_URL_AUTH`/`DATABASE_URL_BOOKING` en
el entorno — ejecútalos con `npx dotenv -e .env -- npm run ... -w @gapssa/web`
desde la raíz si no usas un gestor de entorno que ya las cargue.

## Política de roles (colección `users`, staff interno)

Dos roles cerrados (`USER_ROLES` en `src/collections/access/roles.ts`):
`admin` (gestiona usuarios y configuración) y `editor` (gestiona
contenido, nunca usuarios ni configuración). Endurecido en la revisión de
Fase 1: un usuario autenticado de la colección `users` con `role`
`undefined`, `null`, vacío, o cualquier valor fuera de esos dos, **no** se
trata como autorizado en ningún sitio — ni entra en `/admin`
(`isAdminOrEditor`), ni puede leer siquiera su propia ficha
(`isAdminOrReadingSelf`) — un documento antiguo o corrupto sin `role`
válido queda tan bloqueado como un anónimo. Cubierto por pruebas unitarias
en `src/collections/access/roles.test.ts` (22 casos: cada rol, cada valor
de `role` inválido, y "editor solo lee su propia ficha" vs. "admin lee
cualquiera").

El primer usuario del sistema se crea con el endpoint oficial de Payload
`POST /api/users/first-register` (no `POST /api/users`, que exige ya un
admin autenticado) y queda forzado a `role=admin` sin importar lo que
envíe el formulario (`collections/hooks/protectAdminRole.ts`); un segundo
intento de `first-register` con usuarios ya existentes se rechaza (403).

### Protección del último administrador — y su límite conocido

`collections/hooks/protectAdminRole.ts` impide degradar o eliminar al
último `admin` restante. Desde el endurecimiento de Fase 1 esto usa un
bloqueo real a nivel de fila (`SELECT ... FOR UPDATE` sobre las filas
`role = 'admin'`, dentro de la misma transacción Postgres que abre
`update`/`delete` de Payload — no un `count` suelto, que sí tendría una
carrera real bajo el aislamiento READ COMMITTED por defecto de Postgres
entre dos peticiones concurrentes degradando a los dos únicos
administradores a la vez). Verificado con una prueba de concurrencia real
(`Promise.all` sobre dos peticiones simultáneas) en
`tests/integration/hardening.int.test.ts`, reproducida además revirtiendo
temporalmente el bloqueo para confirmar que el test falla sin él.

**Límite que sigue existiendo, documentado a propósito:** la garantía
depende de que Payload abra una transacción real para la operación
(`initTransaction`, el comportamiento por defecto de `update`/`delete` que
este proyecto no desactiva). Si en el futuro algo invocara estos hooks
fuera de una transacción (`disableTransaction: true`, o una vía que no
pase por las operaciones estándar de colección de Payload), el bloqueo
cae de vuelta a una conexión no transaccional y deja de proteger de
verdad. No es un requisito bloqueante para Fase 1 (la vía actual siempre
pasa por una transacción real), pero si esa vía llega a existir, revisar
esta ficha antes de producción.

## Pruebas de integración (`tests/integration/`)

Suite reproducible contra un servidor Next/Payload real y una base de
datos Postgres **aislada y efímera** (nunca `gapssa_cms`, la de
desarrollo): `tests/integration/global-setup.ts` crea una base
`gapssa_cms_test_<aleatorio>` en el mismo servidor `apps-db`, arranca su
propio `next dev` (necesario para que Payload sincronice el esquema
automáticamente contra una base vacía — no `next start`, que exigiría un
build y migraciones aparte) en un puerto libre distinto de 3000 y con una
carpeta de build separada (`NEXT_DIST_DIR`, ver `next.config.ts`, para no
chocar con un `npm run dev` de desarrollo ya en marcha), y lo apaga y
**borra la base de datos entera** al terminar — en un `teardown` que
Vitest ejecuta siempre, incluso si una aserción falla a media suite, así
que ningún test necesita limpiar "a mano" lo que crea.

Cubre (30 casos, `tests/integration/hardening.int.test.ts`): bootstrap del
primer usuario y rechazo del segundo `first-register`; usuarios anónimos
sin acceso a `users` (listar/leer/crear/actualizar/eliminar, todo 403);
un editor autenticado limitado a su propia ficha y a gestionar contenido,
nunca usuarios ni su propio `role`; protección del último administrador,
incluida la carrera concurrente descrita arriba; y contenido
publicado/borrador visible según rol. Verifica además que ninguna
respuesta incluya `salt`/`hash`/`password`/`resetPasswordToken`.

Requisitos: `docker compose up -d apps-db redis` (Postgres y Redis reales,
igual que para `npm run dev`; nunca toca EspoCRM ni sus contenedores), y
ejecutar `npm run test:integration` **desde la raíz del monorepo** (carga
`.env` vía `dotenv-cli`, igual que `npm run dev`/`test:e2e` — ejecutarlo
directamente dentro de `apps/web` sin esas variables falla rápido con un
mensaje explícito, `global-setup.ts`).

## Fase 3 — Autenticación del portal (`gapssa_auth`)

Arquitectura completa, decisiones, esquema, flujos, controles de
seguridad, vinculación con EspoCRM (adaptador simulado) y decisiones
pendientes: `docs/fase3-autenticacion.md`. Resumen de dónde vive el
código:

- `src/server/auth/db/`: esquema Drizzle (`schema.ts`), cliente
  (`client.ts`), migraciones (`migrate.ts` + `../../drizzle/auth/migrations/`).
- `src/server/auth/`: `password.ts` (Argon2id), `session.ts` (cookies,
  rotación, revocación), `csrf.ts` (doble envío), `otpService.ts` (OTP en
  Redis con transición atómica vía Lua), `rateLimit.ts`, `mailer.ts`
  (SMTP real o transporte de desarrollo), `repository.ts`, `guardian.ts`
  (tutores, máx. 2, bloqueo de fila), `espoLink.ts` (adaptador simulado —
  **nunca** llama a la instancia real de EspoCRM), `audit.ts` (escritura
  validada en `auth_audit_log`), `dal.ts` (protección de `/mi-cuenta`).
- `src/app/api/auth/*`: rutas API (registro, verificación, login, logout,
  recuperación/restablecimiento de contraseña, sesiones, tutores,
  independencia, solicitud de eliminación de cuenta).
- `src/app/(frontend)/[locale]/mi-cuenta/*`: páginas del portal privado.
- `src/components/client/auth/*`: formularios y componentes cliente.

`Payload` (colección `users`) sigue siendo exclusivo del staff interno de
`/admin` — nunca reutilizada para clientes del portal, que viven en
`ClientAccount` (`gapssa_auth`), una base de datos y un ciclo de vida
completamente separados.

## Pendiente (no implementado todavía)

Catálogo de tratamientos operativo, flujo de reservas,
cuestionarios/consentimientos completos, `PendingGuestIdentity`,
`CSolicitudCancelacion`, hook de sincronización EspoCRM, llamadas reales al
adaptador de vinculación EspoCRM — todo según `docs/contratos-portal-v1.md`
(revisión 4, aprobada) y `docs/fase3-autenticacion.md`, sujeto a nueva
aprobación antes de implementarse.

## Deuda técnica — SSR y revalidación (Fase 2, revisión 2)

Todo `(frontend)/[locale]` se sirve con `export const dynamic =
'force-dynamic'` (`app/(frontend)/[locale]/layout.tsx`): cada visita
pública ejecuta SSR por petición contra Postgres vía la Local API de
Payload, sin caché ni revalidación. Es una decisión deliberada para cerrar
Fase 2 (el contenido es editable desde `/admin` en cualquier momento y una
página estática sin revalidación mostraría contenido obsoleto), **no** se
cambia en esta revisión, pero queda documentada como deuda a estudiar antes
de escalar tráfico real:

- **Caché/revalidación bajo demanda vía hooks de Payload**: estudiar
  `revalidatePath`/`revalidateTag` de Next.js disparado desde un
  `afterChange`/`afterDelete` de las colecciones públicas (`tratamientos`,
  `familias-tratamiento`, `testimonios`, `galeria`, `paginas-legales`,
  globals de contenido) en vez de `force-dynamic` en todo el árbol.
- **Consultas innecesarias a Postgres por cada visita**: con
  `force-dynamic`, una página que nadie ha editado desde la última visita
  repite la misma consulta igualmente — sin caché, no hay forma de
  distinguir "contenido sin cambios" de "hay que releer".
- **Actualización editorial sin rebuild**: cualquier alternativa a
  `force-dynamic` debe seguir permitiendo publicar un cambio desde `/admin`
  y verlo reflejado en la web pública sin ejecutar `next build` — la
  revalidación bajo demanda cumple esto; la exportación estática con
  rebuild manual, no.
- **Agotamiento del pool de Postgres al pre-renderizar en masa**: el
  catálogo son 6 idiomas × 57 tratamientos (más familias, páginas legales,
  etc.). Sustituir `force-dynamic` por generación estática
  (`generateStaticParams`) sin más forzaría ~342 renders concurrentes en
  build/ISR compitiendo por el mismo pool de conexiones de
  `@payloadcms/db-postgres` — hay que dimensionar el pool o limitar la
  concurrencia de generación antes de intentarlo, no asumir que "menos
  páginas dinámicas" es automáticamente más barato.

No cambiar esta arquitectura sin pruebas que demuestren la alternativa
funcionando en publicación, actualización e invalidación (no solo en
lectura) — mismo criterio que
`PLAN_DESARROLLO_WEB_PORTAL.md` §20 ("Definición de terminado").
