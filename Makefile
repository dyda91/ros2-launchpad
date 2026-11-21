COMPOSE ?= docker compose
LAB ?= lab
APP_PORT ?= 8080
HOST_RUN_DIR ?= $(CURDIR)/run/sessions
RUNTIME_TOKEN ?= dev-local-runtime-token
E2E_IMAGE ?= ros2-launchpad-e2e:dev

.PHONY: help build build-app lab-up lab-down lab-shell lab-logs world test-world stage1 up down session-down e2e e2e-image stage2a clean

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
		'stage2a     executa o aceite completo da Etapa 2A' \
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
	-docker rm -f ros2-launchpad-session >/dev/null 2>&1 || true
	$(COMPOSE) down --remove-orphans
	rm -rf run/sessions/*

session-down:
	-docker rm -f ros2-launchpad-session >/dev/null 2>&1 || true
	rm -rf run/sessions/*
	$(COMPOSE) restart runtime api

e2e-image:
	docker build -t $(E2E_IMAGE) -f tests/e2e/Dockerfile tests/e2e

e2e: up e2e-image
	docker run --rm --network host --ipc host --shm-size=1g $(E2E_IMAGE)

stage2a: stage1
	$(COMPOSE) stop lab
	$(MAKE) up
	bash tests/integration/stage2a_acceptance.sh
	$(MAKE) e2e

clean:
	$(COMPOSE) down --remove-orphans
	rm -f lab/ros_ws/src/launchpad_sim/worlds/armazem.sdf \
		lab/ros_ws/src/launchpad_sim/config/map.json
	rm -rf run/sessions/*
