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
	$(SSH) $(DEPLOY_HOST) 'cd $(DEPLOY_DIR) && mkdir -p runtime data/save && docker compose up -d --build --remove-orphans'

deploy-cleanup:
	$(SSH) $(DEPLOY_HOST) 'set -e; \
		if [ "$(DEPLOY_PRUNE_IMAGES)" = "1" ]; then docker image prune -f; fi; \
		if [ "$(DEPLOY_PRUNE_BUILD_CACHE)" = "1" ]; then docker builder prune -af; fi; \
		if [ "$(DEPLOY_PRUNE_VOLUMES)" = "1" ]; then docker volume prune -f; fi'
