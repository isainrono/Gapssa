# `apps/cms` — intencionadamente vacía

Payload CMS no vive aquí. La arquitectura oficial actual de Payload 3 se
instala directamente dentro de una app Next.js existente, no como servidor
independiente — por eso Payload está embebido en `apps/web`
(`apps/web/src/payload.config.ts`, `apps/web/src/app/(payload)/`).

Ver la justificación completa (desarrollo local, despliegue, escalado,
autenticación administrativa, migraciones, comunicación con `apps/web`) en
`apps/web/README.md` §"Decisión de arquitectura".

Esta carpeta se conserva vacía (con su `.gitkeep` original) en vez de
eliminarse, para no contradecir la estructura de monorepo descrita en
`PROJECT_CONTEXT.md` §15.6 sin una decisión explícita del propietario del
proyecto.
