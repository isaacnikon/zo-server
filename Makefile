SHELL := /bin/bash

DEPLOY_HOST ?= ubuntu@orc.webcap.site
DEPLOY_KEY ?= $(HOME)/.ssh/id_rsa1
DEPLOY_DIR ?= /home/ubuntu/zo-server
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

.PHONY: deploy deploy-sync deploy-up

deploy: deploy-sync deploy-up

deploy-sync:
	$(SSH) $(DEPLOY_HOST) 'mkdir -p $(DEPLOY_DIR)'
	$(RSYNC) ./ $(DEPLOY_HOST):$(DEPLOY_DIR)/

deploy-up:
	$(SSH) $(DEPLOY_HOST) 'cd $(DEPLOY_DIR) && mkdir -p runtime data/save && docker compose up -d --build'
