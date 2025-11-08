APP_NAME := core-spring
PY_SERVICE := deli
PROFILE ?= dev
TAG := latest

# ---------- BUILD ----------
.PHONY: build
build:
	@echo "🐳 Building all services..."
	docker compose build

# ---------- RUN ----------
.PHONY: run
run:
	@echo "🚀 Starting all containers..."
	docker compose up -d

.PHONY: logs
logs:
	@echo "📜 Tailing backend logs..."
	docker compose logs -f backend

# ---------- STOP / CLEAN ----------
.PHONY: stop
stop:
	docker compose down

.PHONY: clean
clean:
	docker compose down -v --remove-orphans
	docker system prune -f

# ---------- REBUILD ----------
.PHONY: rebuild
rebuild:
	docker compose build --no-cache
	docker compose up -d --force-recreate

# ---------- INDIVIDUAL ----------
.PHONY: backend worker db
backend:
	docker compose up -d backend

worker:
	docker compose up -d worker

db:
	docker compose up -d db

# ---------- UTILITIES ----------
.PHONY: ps
ps:
	docker compose ps

.PHONY: reset
reset:
	@echo "💣 Full cleanup (containers, volumes, images)..."
	docker compose down -v --remove-orphans
	docker image prune -f
	docker volume prune -f

# ---------- INFRA ----------
.PHONY: infra-up infra-down infra-regression
infra-up:
        @./infra/scripts/stack.sh up

infra-down:
        @./infra/scripts/stack.sh down

infra-regression:
        @./infra/scripts/stack.sh regression
