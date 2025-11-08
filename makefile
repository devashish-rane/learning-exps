CORE_PORT ?= 8080
PRODUCER_PORT ?= 8082
UI_PORT ?= 3000
DEFAULT_SERVICE ?= core-service

.PHONY: up down build rebuild logs ps clean test reset

up:
	@echo "🚀 Starting UI -> Core -> Producer chain..."
	docker compose up -d

build:
	@echo "🛠️ Building all images"
	docker compose build

rebuild:
	@echo "🔁 Rebuilding images without cache"
	docker compose build --no-cache
	docker compose up -d --force-recreate

logs:
	@echo "📜 Tailing logs for $(SERVICE) (set SERVICE=name to override)"
	docker compose logs -f $(if $(SERVICE),$(SERVICE),$(DEFAULT_SERVICE))

ps:
	docker compose ps

down:
	@echo "🛑 Stopping all services"
	docker compose down

clean:
	@echo "🧹 Removing containers, volumes, and dangling resources"
	docker compose down -v --remove-orphans
	docker system prune -f

reset: clean

# Simple integration test: waits briefly, hits Core which in turn calls Producer
 test:
	@echo "🧪 Running UI/Core/Producer smoke test"
	sleep 3
	@curl -sf -H "X-Correlation-Id: make-test" "http://localhost:${CORE_PORT}/api/user/demo" | jq '.' 2>/dev/null || curl -sf -H "X-Correlation-Id: make-test" "http://localhost:${CORE_PORT}/api/user/demo"
	@echo "✅ Core responded"
