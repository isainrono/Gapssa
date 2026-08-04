.PHONY: config up down restart ps logs crm-logs health espocrm-export espocrm-backup

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
