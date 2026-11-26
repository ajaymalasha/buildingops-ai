# BuildingOps AI — developer commands. Run `make help` for the list.

API := apps/api
WEB := apps/web

.DEFAULT_GOAL := help
.PHONY: help setup env install db-bootstrap migrate seed dev dev-api dev-web api-types \
        check lint typecheck test lint-api typecheck-api test-api lint-web typecheck-web test-web \
        format build-web e2e

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# --- First-time setup ---------------------------------------------------------------------

setup: env install db-bootstrap migrate seed ## Everything needed for a first run
	@echo "\nReady. Start both apps with: make dev"

env: ## Create .env (with a generated AUTH_SECRET) and link it into the web app
	@if [ ! -f .env ]; then \
		sed "s|^AUTH_SECRET=.*|AUTH_SECRET=$$(openssl rand -base64 32)|" .env.example > .env; \
		echo "Created .env"; \
	else echo ".env already exists"; fi
	@ln -sf ../../.env $(WEB)/.env.local

install: ## Install API and web dependencies
	cd $(API) && uv sync
	cd $(WEB) && pnpm install

db-bootstrap: ## Create the database roles and databases (needs a Postgres superuser)
	./infra/postgres/bootstrap.sh

migrate: ## Apply database migrations
	cd $(API) && uv run alembic upgrade head

seed: ## Load demo organizations, accounts, master data and a year of operations
	cd $(API) && uv run buildingops seed

# --- Running ------------------------------------------------------------------------------

dev: ## Run the API (:8000) and the web app (:3000) together
	@$(MAKE) -j2 dev-api dev-web

dev-api: ## Run the API with reload
	cd $(API) && uv run uvicorn buildingops.main:app_factory --factory --reload --port 8000

dev-web: ## Run the web app
	cd $(WEB) && pnpm dev

build-web: ## Production build of the web app
	cd $(WEB) && pnpm build

# --- Keeping the two apps in step ---------------------------------------------------------

api-types: ## Regenerate the OpenAPI document and the web app's typed client
	cd $(API) && uv run buildingops openapi --output openapi.json
	cd $(WEB) && pnpm gen:api

# --- Checks (the same ones CI runs) -------------------------------------------------------

check: lint typecheck test ## Run every check

lint: lint-api lint-web ## Lint both apps
typecheck: typecheck-api typecheck-web ## Type-check both apps
test: test-api test-web ## Test both apps

lint-api:
	cd $(API) && uv run ruff check . && uv run ruff format --check .

typecheck-api:
	cd $(API) && uv run mypy

test-api:
	cd $(API) && uv run pytest

lint-web:
	cd $(WEB) && pnpm lint && pnpm format:check

typecheck-web:
	cd $(WEB) && pnpm typecheck

test-web:
	cd $(WEB) && pnpm test

e2e: ## End-to-end tests in a real browser, on their own database and ports
	BUILDINGOPS_DATABASES=buildingops_e2e ./infra/postgres/bootstrap.sh
	cd $(WEB) && pnpm e2e

format: ## Format both apps
	cd $(API) && uv run ruff format . && uv run ruff check --fix .
	cd $(WEB) && pnpm format
