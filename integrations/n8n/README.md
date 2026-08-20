# n8n aislado para GAPSSA

Instancia local de n8n con PostgreSQL dedicado. No comparte redes, volúmenes ni
base de datos con los servicios principales de GAPSSA. La interfaz solo se
publica en `127.0.0.1:5678`.

## Requisitos

- Docker Desktop o Docker Engine
- Docker Compose v2

## Arranque

Ejecutar desde la raíz del repositorio:

```bash
docker compose --env-file integrations/n8n/.env \
  -f integrations/n8n/compose.yml up -d
```

Abrir <http://127.0.0.1:5678> y crear el usuario propietario en la pantalla
inicial de n8n.

## Operación

```bash
# Estado
docker compose -f integrations/n8n/compose.yml ps

# Logs
docker compose -f integrations/n8n/compose.yml logs -f n8n

# Detener sin borrar datos
docker compose -f integrations/n8n/compose.yml down

# Volver a iniciar
docker compose -f integrations/n8n/compose.yml up -d
```

No ejecutar `down -v`: la opción `-v` elimina los volúmenes persistentes.

## Actualización

1. Revisar las notas de versión y actualizar la etiqueta de la imagen de n8n
   en `compose.yml`.
2. Crear una copia de seguridad.
3. Ejecutar:

```bash
docker compose -f integrations/n8n/compose.yml pull
docker compose -f integrations/n8n/compose.yml up -d
```

## Copia de seguridad

Los datos importantes están en PostgreSQL y las credenciales quedan cifradas
con `N8N_ENCRYPTION_KEY`. Para una restauración válida hay que conservar tanto
el volcado de PostgreSQL como esa clave. El archivo `.env` es local y está
excluido de Git por el `.gitignore` de la raíz.

Ejemplo de volcado manual:

```bash
mkdir -p integrations/n8n/backups
docker compose -f integrations/n8n/compose.yml exec -T postgres \
  pg_dump -U n8n -d n8n > integrations/n8n/backups/n8n.sql
```

## Publicación futura

Antes de exponer n8n en Internet se debe colocar detrás de un proxy HTTPS,
actualizar `N8N_WEBHOOK_URL` y `N8N_EDITOR_BASE_URL`, y volver a activar las
cookies seguras. La base de datos no debe publicarse en el host.
