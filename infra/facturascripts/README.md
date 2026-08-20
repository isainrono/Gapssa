# FacturaScripts aislado para GAPSSA

Instancia local de FacturaScripts con MySQL dedicado. No comparte redes,
volúmenes ni base de datos con EspoCRM, el portal o n8n. La interfaz solamente
se publica en `127.0.0.1:8082`.

La configuración de ejecución vive aquí. `extensions/facturascripts/` queda
reservado para el código fuente de plugins propios de GAPSSA; no contiene la
instalación ni los datos de producción.

## Arranque

Desde la raíz del repositorio:

```bash
docker compose --env-file infra/facturascripts/.env \
  -f infra/facturascripts/compose.yml up -d
```

Abrir <http://127.0.0.1:8082>. Las credenciales iniciales están en el archivo
local `infra/facturascripts/.env`, excluido de Git.

## Operación

```bash
# Estado
docker compose --env-file infra/facturascripts/.env \
  -f infra/facturascripts/compose.yml ps

# Logs
docker compose --env-file infra/facturascripts/.env \
  -f infra/facturascripts/compose.yml logs -f facturascripts

# Detener sin borrar datos
docker compose --env-file infra/facturascripts/.env \
  -f infra/facturascripts/compose.yml down

# Volver a iniciar
docker compose --env-file infra/facturascripts/.env \
  -f infra/facturascripts/compose.yml up -d
```

No ejecutar `down -v`: la opción `-v` elimina la base de datos y todos los
archivos persistentes de FacturaScripts.

## Persistencia y plugins

- `mysql-data` contiene la base de datos.
- `facturascripts-data` contiene la instalación viva, archivos, configuración
  y plugins instalados.
- `extensions/facturascripts/` contiene únicamente el código fuente versionado
  de plugins desarrollados para GAPSSA. Los plugins se empaquetarán e instalarán
  en FacturaScripts; no se monta esa carpeta sobre `Plugins/` porque ocultaría
  plugins gestionados por la propia aplicación.

FacturaScripts se actualiza desde `Administrador > Actualizador`. Según la
documentación oficial, la versión activa se conserva en el volumen, por lo que
cambiar o descargar de nuevo la imagen no actualiza por sí solo la aplicación.

## Copia de seguridad

Conservar conjuntamente el volcado SQL y una copia del volumen de la aplicación.
Ejemplo de volcado manual:

```bash
mkdir -p infra/facturascripts/backups
docker compose --env-file infra/facturascripts/.env \
  -f infra/facturascripts/compose.yml exec -T mysql \
  sh -c 'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction facturascripts' \
  > infra/facturascripts/backups/facturascripts.sql
```

El directorio `backups/` y todos los archivos `.env` locales están excluidos de
Git. Hay que probar periódicamente la restauración, no solamente generar copias.

## Publicación futura

Antes de publicar `erp.gapssa.es`, colocar FacturaScripts detrás de un proxy
HTTPS, mantener MySQL sin puertos publicados y definir una política de copias,
actualización y reversión. El puerto local no debe cambiarse a `0.0.0.0`.
