COMPOSE ?= docker compose
LAB ?= lab

.PHONY: help build lab-up lab-down lab-shell lab-logs world test-world stage1 clean

help:
	@printf '%s\n' \
		'build      constrói a imagem do laboratório' \
		'lab-up     sobe o container do laboratório' \
		'lab-shell  abre um shell dentro do laboratório' \
		'lab-logs   acompanha logs do container' \
		'world      gera o SDF e o mapa a partir de content/world/armazem.yaml' \
		'test-world executa testes de geometria do mundo' \
		'stage1     executa o aceite completo da Etapa 1' \
		'lab-down   para e remove o container' \
		'clean      remove container e artefatos gerados'

build:
	$(COMPOSE) build $(LAB)

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

clean:
	$(COMPOSE) down --remove-orphans
	rm -f lab/ros_ws/src/launchpad_sim/worlds/armazem.sdf \
		lab/ros_ws/src/launchpad_sim/config/map.json
