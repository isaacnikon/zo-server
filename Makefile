SHELL := /bin/bash

DEPLOY_HOST ?= ubuntu@orc.webcap.site
DEPLOY_KEY ?= $(HOME)/.ssh/id_rsa1
DEPLOY_DIR ?= /home/ubuntu/zo-server
DEPLOY_PRUNE_IMAGES ?= 1
DEPLOY_PRUNE_BUILD_CACHE ?= 1
DEPLOY_PRUNE_VOLUMES ?= 0
SSH := ssh -i $(DEPLOY_KEY)
RSYNC := rsync -az --delete -e "ssh -i $(DEPLOY_KEY)" \
	--exclude .git \
	--exclude .env \
	--exclude .claude \
	--exclude .mcp.json \
	--exclude node_modules \
	--exclude postgres-data \
	--exclude runtime \
	--exclude data/save \
	--exclude server.log \
	--exclude combat-probe-state.json \
	--exclude __pycache__ \
	--exclude scripts/__pycache__ \
	--exclude '*.pyc'

.PHONY: deploy deploy-sync deploy-up deploy-cleanup

deploy: deploy-sync deploy-up deploy-cleanup

deploy-sync:
	$(SSH) $(DEPLOY_HOST) 'mkdir -p $(DEPLOY_DIR)'
	$(RSYNC) ./ $(DEPLOY_HOST):$(DEPLOY_DIR)/

deploy-up:
	$(SSH) $(DEPLOY_HOST) 'set -e; \
		cd $(DEPLOY_DIR); \
		mkdir -p runtime runtime/data/save data/save postgres-data; \
		if docker network inspect traefik-public >/dev/null 2>&1; then \
			COMPOSE_FILES="-f compose.yaml -f compose.traefik.yaml"; \
		else \
			COMPOSE_FILES="-f compose.yaml"; \
		fi; \
		docker compose $$COMPOSE_FILES build zo-server portal; \
		docker compose $$COMPOSE_FILES up -d postgres; \
		docker compose $$COMPOSE_FILES run --rm flyway migrate; \
		docker compose $$COMPOSE_FILES run --rm --no-deps zo-server npm run db:import:all -w @zo/game-server; \
		docker compose $$COMPOSE_FILES up -d --remove-orphans postgres zo-server portal'

deploy-cleanup:
	$(SSH) $(DEPLOY_HOST) 'set -e; \
		if [ "$(DEPLOY_PRUNE_IMAGES)" = "1" ]; then docker image prune -f; fi; \
		if [ "$(DEPLOY_PRUNE_BUILD_CACHE)" = "1" ]; then docker builder prune -af; fi; \
		if [ "$(DEPLOY_PRUNE_VOLUMES)" = "1" ]; then docker volume prune -f; fi'
