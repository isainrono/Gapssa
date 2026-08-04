# Gapssa

Monorepositorio para la web, CRM, ERP e integraciones de Gapssa. Las decisiones
funcionales y técnicas validadas se encuentran en `PROJECT_CONTEXT.md`.

## Requisitos locales

- Docker Desktop
- Docker Compose v2 o posterior
- `make` (opcional; todos los comandos se pueden ejecutar con Docker Compose)

## Inicio rápido: EspoCRM

1. Copiar `.env.example` como `.env` y sustituir las contraseñas de ejemplo.
2. Validar la configuración:

   ```bash
   docker compose config
   ```

3. Descargar e iniciar los servicios:

   ```bash
   docker compose up -d
   ```

4. Comprobar el estado:

   ```bash
   docker compose ps
   docker compose logs --tail=100 espocrm
   ```

5. Abrir <http://localhost:8081>.

Para detener el entorno conservando todos los datos:

```bash
docker compose down
```

> No ejecutar `docker compose down --volumes` salvo que se quiera borrar de
> forma deliberada toda la instalación y la base de datos local.

## Servicios actuales

| Servicio | Acceso desde macOS | Persistencia |
|---|---|---|
| EspoCRM | <http://localhost:8081> | Volúmenes Docker |
| WebSocket de EspoCRM | `ws://localhost:8083` | Comparte datos con EspoCRM |
| MariaDB | Solo red privada Docker | Volumen Docker |

