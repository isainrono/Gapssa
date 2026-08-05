.PHONY: config up down restart ps logs crm-logs health espocrm-export espocrm-backup \
	gcs-lock gcs-relock gcs-deps gcs-deps-check gcs-build gcs-test gcs-install \
	gcs-uninstall gcs-rebuild gcs-status gcs-lint gcs-clean gcs-package

GCS_DIR = extensions/espocrm-google-calendar-sync
GCS_MODULE = $(GCS_DIR)/files/custom/Espo/Modules/GoogleCalendarSync
GCS_VERSION = $(shell sed -n 's/.*"version": "\([^"]*\)".*/\1/p' $(GCS_DIR)/manifest.json | head -1)
GCS_ZIP = $(GCS_DIR)/build/google-calendar-sync-$(GCS_VERSION).zip
GCS_SRC_DOCS = entrega-google-calendar-sync
GCS_DIST = dist/google-calendar-sync-$(GCS_VERSION)

# Orden garantizado bajo `make -j`.
#
# GNU Make no ofrece forma de exigir orden entre los prerrequisitos de un mismo
# objetivo: bajo -j se lanzan a la vez. Ni siquiera los prerrequisitos
# order-only sirven, porque ordenan prerrequisito↔objetivo, no prerrequisitos
# entre sí. `.NOTPARALLEL:` sin argumentos resolvería el caso, pero serializa
# TODO el Makefile, incluidos objetivos ajenos a la extensión.
#
# Alternativa elegida: `gcs-package` no declara prerrequisitos y encadena los
# pasos en su receta con sub-make. Cada línea de receta termina antes de que
# empiece la siguiente, también con -j, y el alcance queda limitado a este
# flujo. Los objetivos sueltos siguen pudiendo paralelizarse.

# Composer y PHP se ejecutan en contenedores: no hacen falta en el host.
COMPOSER = docker run --rm -v "$(CURDIR)/$(GCS_MODULE)":/app -w /app \
	-u $(shell id -u):$(shell id -g) -e COMPOSER_HOME=/tmp/composer composer:2

config:
	docker compose config

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose restart

ps:
	docker compose ps

logs:
	docker compose logs --tail=100

crm-logs:
	docker compose logs --tail=100 espocrm espocrm-daemon espocrm-websocket

health:
	docker compose exec espocrm bin/command app-check

# Copia al repositorio las personalizaciones creadas desde el administrador.
espocrm-export:
	docker compose cp espocrm:/var/www/html/custom/Espo/Custom/. extensions/espocrm/custom/Espo/Custom/

# Genera un respaldo comprimido de la base de datos de EspoCRM.
espocrm-backup:
	./scripts/backup-espocrm-db.sh

# ---- Extensión Google Calendar Sync ----

# Genera o actualiza composer.lock desde composer.json. Requiere red.
# Solo hay que ejecutarlo al crear el lock o al cambiar las dependencias.
gcs-lock:
	$(COMPOSER) update --no-dev --prefer-dist --no-progress --with-all-dependencies
	$(COMPOSER) validate --strict --no-check-publish
	@echo "composer.lock generado. Recuerda: se versiona; vendor/ no."

# Refresca SOLO la firma de composer.lock, sin cambiar ninguna versión.
# Úsalo cuando cambien metadatos de composer.json (name, description...) y el
# lock quede marcado como desincronizado. Requiere red.
gcs-relock:
	$(COMPOSER) update --lock --no-install
	@echo "composer.lock refirmado; las versiones bloqueadas no han cambiado."

# Instala las dependencias EXACTAS de composer.lock. Falla si el lock no existe
# o está desincronizado respecto a composer.json.
gcs-deps:
	@test -f $(GCS_MODULE)/composer.lock || \
		{ echo "ERROR: falta composer.lock. Ejecuta 'make gcs-lock' una vez."; exit 1; }
	@$(COMPOSER) validate --strict --no-check-publish --no-check-all || \
		{ echo ""; \
		  echo "ERROR: composer.lock no coincide con composer.json."; \
		  echo "       Si han cambiado las DEPENDENCIAS:  make gcs-lock"; \
		  echo "       Si solo cambiaron METADATOS (name, description...):  make gcs-relock"; \
		  exit 1; }
	$(COMPOSER) install --no-dev --prefer-dist --no-progress
	@echo "Dependencias instaladas desde composer.lock."

# Comprueba que vendor/ está completo, coincide con el lock y es autónomo.
gcs-deps-check:
	docker run --rm -v "$(CURDIR)/$(GCS_DIR)":/app -w /app composer:2 \
		php tools/check-dependencies.php files/custom/Espo/Modules/GoogleCalendarSync

# Empaqueta el ZIP desde las dependencias exactas y verifica el resultado.
gcs-build:
	./$(GCS_DIR)/build.sh

# Ejecuta las pruebas contra el contenido del último ZIP construido.
gcs-test: gcs-build

# Genera la carpeta de entrega en dist/, lista para llevar a otro entorno.
#
# Fuente (versionada)   -> entrega-google-calendar-sync/*.md  (usan {versión})
# Resultado (ignorado)  -> dist/google-calendar-sync-{versión}/
#
# Sin prerrequisitos a propósito: la receta encadena los pasos con sub-make para
# garantizar el orden también bajo `make -j` (ver nota de paralelismo arriba).
# Toda la validación de versión y rutas vive en package.sh, no aquí: así Make
# nunca interpola la versión dentro de código shell.
gcs-package:
	@$(MAKE) --no-print-directory gcs-deps
	@$(MAKE) --no-print-directory gcs-build
	@./$(GCS_DIR)/package.sh

# Borra vendor/ y el ZIP generado (todo es reproducible desde el lock).
gcs-clean:
	rm -rf $(GCS_MODULE)/vendor $(GCS_DIR)/build

# Valida la sintaxis de todos los PHP de la extensión con el PHP del contenedor.
gcs-lint:
	docker compose cp $(GCS_DIR) espocrm:/tmp/gcs-src
	docker compose exec espocrm bash -c 'find /tmp/gcs-src -name "*.php" -print0 | xargs -0 -n1 php -l && rm -rf /tmp/gcs-src'

# Instala (o actualiza) la extensión en el contenedor y reconstruye.
#
# Sin prerrequisitos a propósito: bajo `make -j` se lanzarían en paralelo y
# gcs-build podría empezar antes de que gcs-deps termine de poblar vendor/.
# La receta los encadena con sub-make, que sí garantiza el orden. Composer se
# ejecuta una sola vez, dentro de gcs-deps.
gcs-install:
	@$(MAKE) --no-print-directory gcs-deps
	@$(MAKE) --no-print-directory gcs-build
	docker compose cp $(GCS_ZIP) espocrm:/tmp/gcs-extension.zip
	docker compose exec espocrm bin/command extension --file=/tmp/gcs-extension.zip
	docker compose exec espocrm bin/command app-check

# Desinstala la extensión (no borra datos; ver docs/UNINSTALL.md).
gcs-uninstall:
	docker compose exec espocrm bin/command extension -u --name="Google Calendar Sync"

# Rebuild + limpieza de caché de EspoCRM.
gcs-rebuild:
	docker compose exec espocrm bin/command rebuild

# Estado: cuenta, scheduled job y últimos jobs de push.
#
# EspoCRM usa borrado lógico: todas las entidades llevan la columna `deleted`.
# Sin `deleted = 0` aparecerían como activos los trabajos programados que una
# actualización de la extensión eliminó, dando una lectura falsa del estado.
gcs-status:
	docker compose exec espocrm-db sh -c 'mariadb -u$$MARIADB_USER -p$$MARIADB_PASSWORD $$MARIADB_DATABASE -e \
		"SELECT name, type, status, calendar_id, last_sync_at, LEFT(COALESCE(last_error,\"\"),120) AS last_error \
		   FROM gcs_account WHERE deleted = 0; \
		 SELECT name, status, scheduling, last_run_at FROM scheduled_job \
		   WHERE job = \"GcsPushSweep\" AND deleted = 0; \
		 SELECT id, name, status, executed_at FROM job \
		   WHERE (name LIKE \"%GcsPush%\" OR class_name LIKE \"%GcsPush%\") AND deleted = 0 \
		   ORDER BY id DESC LIMIT 10; \
		 SELECT COUNT(*) AS vinculos_activos FROM gcs_event_link WHERE deleted = 0;"'
