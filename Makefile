COMPOSE ?= docker compose
LAB ?= lab
APP_PORT ?= 8080
HOST_RUN_DIR ?= $(CURDIR)/run/sessions
RUNTIME_TOKEN ?= dev-local-runtime-token
E2E_IMAGE ?= ros2-launchpad-e2e:dev
PILOT_COMPOSE ?= -f compose.yaml -f compose.pilot.yaml
MAX_SESSIONS ?= 2
SESSION_TTL_SECONDS ?= 1800
SESSION_IDLE_SECONDS ?= 600
SESSION_WARNING_SECONDS ?= 120
SESSION_MONITOR_SECONDS ?= 2
SESSION_ROS_DOMAIN_ID ?= 42

.PHONY: help build build-app lab-up lab-down lab-shell lab-logs world test-world test-mission test-api test-session-capacity test-pilot stage1 up down session-down sessions-clean e2e e2e-image e2e-2a e2e-2b e2e-3 stage2a stage2b stage3 stage2a-clean stage2b-clean measure-2b pilot-up pilot-down pilot-admin pilot-verify pilot-acceptance pilot-e2e clean

help:
	@printf '%s\n' \
		'build       constrói a imagem do laboratório' \
		'build-app   constrói as imagens da API e do runtime' \
		'lab-up      sobe o container do laboratório (Etapa 1)' \
		'lab-shell   abre um shell dentro do laboratório' \
		'lab-logs    acompanha logs do container' \
		'world       gera o SDF e o mapa a partir de content/world/armazem.yaml' \
		'test-world  executa testes de geometria do mundo' \
		'stage1      executa o aceite completo da Etapa 1' \
		'up          constrói e sobe API + runtime em 127.0.0.1:8080' \
		'down        para aplicação e remove a sessão' \
		'session-down força a remoção da sessão' \
		'e2e         executa Playwright contra a aplicação local' \
		'test-mission valida o conteúdo da missão' \
		'test-api    testa falha/retry do restart da sessão' \
		'stage2a     executa o aceite completo da Etapa 2A' \
		'stage2b     executa o aceite multi-sessão, reconexão e expiração' \
		'stage3      executa o aceite da missão Primeiro Turno' \
		'measure-2b  mede dois simuladores simultâneos' \
		'test-pilot  testa convites, controle e eventos do piloto' \
		'pilot-up    sobe API/runtime com convite e hardening' \
		'pilot-down  para o piloto e remove as sessões' \
		'pilot-admin executa o CLI de convites/controle' \
		'pilot-verify valida pré-requisitos e HTTPS do piloto' \
		'pilot-acceptance testa convite, pausa e fechamento localmente' \
		'clean       remove containers e artefatos gerados'

build:
	$(COMPOSE) build $(LAB)

build-app:
	$(COMPOSE) build api runtime

lab-up: build
	$(COMPOSE) up -d $(LAB)

lab-down:
	$(COMPOSE) down --remove-orphans

lab-shell:
	$(COMPOSE) exec $(LAB) bash -l

lab-logs:
	$(COMPOSE) logs -f $(LAB)

world:
	python3 lab/ros_ws/src/launchpad_sim/launchpad_sim/generate_world.py \
		--config content/world/armazem.yaml \
		--world-out lab/ros_ws/src/launchpad_sim/worlds/armazem.sdf \
		--map-out lab/ros_ws/src/launchpad_sim/config/map.json

test-world: lab-up
	$(COMPOSE) exec -T $(LAB) bash -lc \
		'LAUNCHPAD_ROOT=/ python3 /tests/integration/test_world_geometry.py -v'

stage1: lab-up test-world
	bash tests/integration/stage1_acceptance.sh

up: build build-app
	mkdir -p $(HOST_RUN_DIR)
	chmod 0775 $(HOST_RUN_DIR)
	HOST_RUN_DIR=$(HOST_RUN_DIR) RUNTIME_TOKEN=$(RUNTIME_TOKEN) \
		MAX_SESSIONS=$(MAX_SESSIONS) \
		SESSION_TTL_SECONDS=$(SESSION_TTL_SECONDS) \
		SESSION_IDLE_SECONDS=$(SESSION_IDLE_SECONDS) \
		SESSION_WARNING_SECONDS=$(SESSION_WARNING_SECONDS) \
		SESSION_MONITOR_SECONDS=$(SESSION_MONITOR_SECONDS) \
		SESSION_ROS_DOMAIN_ID=$(SESSION_ROS_DOMAIN_ID) \
		$(COMPOSE) up -d api runtime
	@set -e; \
	for attempt in $$(seq 1 40); do \
		if curl -fsS "http://127.0.0.1:$(APP_PORT)/api/health" >/dev/null 2>&1; then \
			printf 'aplicação pronta em http://localhost:%s\n' "$(APP_PORT)"; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	printf 'aplicação não respondeu; veja docker compose logs api runtime\n' >&2; \
	exit 1

down:
	-ids=$$(docker ps -aq --filter label=launchpad.role=session); \
		if [ -n "$$ids" ]; then docker rm -f $$ids >/dev/null; fi
	$(COMPOSE) down --remove-orphans
	rm -rf run/sessions/*

session-down:
	$(MAKE) sessions-clean
	$(COMPOSE) restart runtime api

sessions-clean:
	-ids=$$(docker ps -aq --filter label=launchpad.role=session); \
		if [ -n "$$ids" ]; then docker rm -f $$ids >/dev/null; fi
	rm -rf run/sessions/*

e2e-image:
	docker build -t $(E2E_IMAGE) -f tests/e2e/Dockerfile tests/e2e

e2e: up e2e-image stage2a-clean
	docker run --rm --network host --ipc host --shm-size=1g $(E2E_IMAGE) \
		npx playwright test stage2a.spec.ts stage3.spec.ts

e2e-2a: up e2e-image stage2a-clean
	docker run --rm --network host --ipc host --shm-size=1g $(E2E_IMAGE) npx playwright test stage2a.spec.ts

e2e-3: up e2e-image stage2a-clean
	docker run --rm --network host --ipc host --shm-size=1g $(E2E_IMAGE) npx playwright test stage3.spec.ts

stage2a-clean:
	$(MAKE) sessions-clean
	$(COMPOSE) restart runtime api >/dev/null
	sleep 2

stage2b-clean:
	$(MAKE) sessions-clean
	$(COMPOSE) restart runtime api >/dev/null
	sleep 2

stage2a: stage1
	$(COMPOSE) stop lab
	$(MAKE) sessions-clean
	$(MAKE) up
	bash tests/integration/stage2a_acceptance.sh
	$(MAKE) e2e-2a

stage2b: stage1
	$(COMPOSE) stop lab
	$(MAKE) sessions-clean
	$(MAKE) up MAX_SESSIONS=2 SESSION_TTL_SECONDS=90 \
		SESSION_IDLE_SECONDS=15 SESSION_WARNING_SECONDS=5 \
		SESSION_MONITOR_SECONDS=1
	bash tests/integration/stage2b_acceptance.sh
	$(MAKE) e2e-2b

e2e-2b: e2e-image
	docker run --rm --network host --ipc host --shm-size=1g $(E2E_IMAGE) \
		npx playwright test stage2b.spec.ts

measure-2b: sessions-clean
	$(MAKE) up
	bash tests/integration/stage2b_measure.sh

pilot-up: build build-app
	mkdir -p run/sessions run/pilot
	chmod 0775 run/sessions run/pilot
	HOST_RUN_DIR=$(HOST_RUN_DIR) RUNTIME_TOKEN=$(RUNTIME_TOKEN) \
		MAX_SESSIONS=$(MAX_SESSIONS) \
		SESSION_TTL_SECONDS=$(SESSION_TTL_SECONDS) \
		SESSION_IDLE_SECONDS=$(SESSION_IDLE_SECONDS) \
		SESSION_WARNING_SECONDS=$(SESSION_WARNING_SECONDS) \
		SESSION_MONITOR_SECONDS=$(SESSION_MONITOR_SECONDS) \
		SESSION_ROS_DOMAIN_ID=$(SESSION_ROS_DOMAIN_ID) \
		SESSION_READ_ONLY=$(SESSION_READ_ONLY) \
		SESSION_APPARMOR=$(SESSION_APPARMOR) \
		PUBLIC_ORIGINS=$(PUBLIC_ORIGINS) \
		COOKIE_SECURE=$(COOKIE_SECURE) \
		DOCKER_SOCKET=$(DOCKER_SOCKET) \
		$(COMPOSE) $(PILOT_COMPOSE) up -d api runtime
	@set -e; \
	for attempt in $$(seq 1 40); do \
		if curl -fsS "http://127.0.0.1:$(APP_PORT)/api/health" >/dev/null 2>&1; then \
			printf 'piloto pronto em http://localhost:%s\n' "$(APP_PORT)"; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	printf 'piloto não respondeu; veja docker compose logs api runtime\n' >&2; \
	exit 1

pilot-down:
	-ids=$$(docker ps -aq --filter label=launchpad.role=session); \
		if [ -n "$$ids" ]; then docker rm -f $$ids >/dev/null; fi
	$(COMPOSE) down --remove-orphans
	rm -rf run/sessions/*

pilot-admin:
	bash scripts/pilot-admin.sh $(ARGS)

pilot-e2e: e2e-image
	docker run --rm --network host --ipc host --shm-size=1g \
		-e PILOT_INVITE_CODE="$(PILOT_INVITE_CODE)" $(E2E_IMAGE) \
		npx playwright test pilot.spec.ts

pilot-verify:
	bash scripts/pilot-preflight.sh
	bash scripts/pilot-verify.sh

pilot-acceptance: build-app
	$(MAKE) sessions-clean
	PUBLIC_ORIGINS=http://127.0.0.1:8080,http://localhost:8080 \
		COOKIE_SECURE=false SESSION_READ_ONLY=true SESSION_APPARMOR= \
		$(MAKE) pilot-up
	PUBLIC_ORIGINS=http://127.0.0.1:8080,http://localhost:8080 \
		COOKIE_SECURE=false SESSION_READ_ONLY=true SESSION_APPARMOR= \
		bash tests/integration/stage_pilot_acceptance.sh
	$(MAKE) pilot-down

stage3: stage1 test-mission test-api
	$(COMPOSE) stop lab
	$(MAKE) sessions-clean
	$(MAKE) up
	bash tests/integration/stage2a_acceptance.sh
	$(MAKE) e2e

clean:
	$(MAKE) down
	rm -f lab/ros_ws/src/launchpad_sim/worlds/armazem.sdf \
		lab/ros_ws/src/launchpad_sim/config/map.json

test-mission: build-app
	docker run --rm \
		-v "$(CURDIR)/content:/content:ro" \
		-v "$(CURDIR)/tests:/tests:ro" \
		-v "$(CURDIR)/apps/api:/app" \
		-w /app ros2-launchpad-api:dev \
		python /tests/integration/test_mission_content.py -v

test-api: build-app
	docker run --rm \
		-v "$(CURDIR)/tests:/tests:ro" \
		-v "$(CURDIR)/apps/api:/app" \
		-w /app ros2-launchpad-api:dev \
		python /tests/integration/test_session_restart_failure.py -v

test-session-capacity: build-app
	docker run --rm \
		-v "$(CURDIR)/tests:/tests:ro" \
		-v "$(CURDIR)/apps/api:/app" \
		-w /app ros2-launchpad-api:dev \
		python /tests/integration/test_session_capacity.py -v

test-pilot: build-app
	docker run --rm \
		-v "$(CURDIR)/tests:/tests:ro" \
		-v "$(CURDIR)/apps/api:/app" \
		-w /app ros2-launchpad-api:dev \
		python /tests/integration/test_pilot_store.py -v
