# Tarefas — Primeiro Turno

Legenda: **concluído**, **pendente**, **bloqueado**. Toda tarefa concluída
tem uma verificação executada; resultados detalhados em
`docs/stage1-results.md`.

## Fase 0 — Especificação e base

| ID | Status | Tarefa | Verificação |
|---|---|---|---|
| T0.1 | concluído | Criar AGENTS.md, spec.md, plan.md, tasks.md, README, Makefile e compose | arquivos revisados; `make help` |
| T0.2 | concluído | Fixar digest da base e versões ROS/Gazebo | `docker compose build lab`; `dpkg-query`; `gz sim --version` |

## Fase 1 — Robô, armazém e aceite

| ID | Status | Tarefa | Verificação executada |
|---|---|---|---|
| T1.1 | concluído | Construir a imagem Ubuntu 24.04 + ROS 2 Jazzy + Gazebo Harmonic, sem GUI | `make build`; imagem 3,45 GB; Gazebo 8.15.0; sem `DISPLAY`/GPU |
| T1.2 | concluído | Modelar robô diferencial com chassi, duas rodas e caster | URDF carregado; `/joint_states`; deslocamento real; inércias declaradas |
| T1.3 | concluído | Criar YAML do armazém e gerador SDF/JSON | `make test-world` — 6 testes OK; geração determinística |
| T1.4 | concluído | Criar launch headless com um robô, bridges e `/clock` | `/cmd_vel`, `/odom`, `/clock`; um único `launchpad_robot` |
| T1.5 | concluído | Implementar watchdog de `/cmd_vel` | parada em 0,400 s; comando CLI de 3 s termina com `vx=0` |
| T1.6 | concluído | Implementar monitor de missão e reset | rota real até `(5,706, 3,599)`; entrega com 2,0 s parado |
| T1.7 | concluído | Criar script de aceite e registrar métricas | `make stage1` OK; startup 5,85–6,61 s; 66,8–70,2% CPU e ~258 MiB ocioso |

### Evidências da Etapa 1

```text
$ make test-world
Ran 6 tests ... OK

$ make stage1
startup_seconds=5.85–6.61
cmd_vel=geometry_msgs/msg/Twist
odom=nav_msgs/msg/Odometry
robots=launchpad_robot
pose zero ok
parada observada em 0.400 s
cli movement ok: 0.420–0.440 m, final vx=0.000000
entrega validada por pose e velocidade reais
ros2-launchpad-lab cpu=66.76% mem=258.6MiB / 2GiB
Memory=2147483648 NanoCpus=2000000000 PidsLimit=256 NetworkMode=none
robots_after_restart=launchpad_robot
=== ACEITE ETAPA 1: OK ===
```

## Fase 2 — Sessão, terminal e visor (pendente)

| ID | Status | Tarefa | Verificação planejada |
|---|---|---|---|
| T2.1 | pendente | Agente PTY em UDS: digitação, resize, histórico, Ctrl+C, replay | testes de PTY + navegador |
| T2.2 | pendente | Agente de telemetria `/odom` a 10 Hz e readiness | teste de taxa e conteúdo |
| T2.3 | pendente | Runtime controller com Docker socket e limites | criar/remover; inspecionar container |
| T2.4 | pendente | Ciclo de vida da API: cookie, estados, TTL, lotação, idempotência | testes de concorrência e limpeza |
| T2.5 | pendente | Web React/TS/Vite com xterm.js e Canvas 2D | testes de UI; mock apenas para desenvolvimento |
| T2.6 | pendente | Compose de desenvolvimento em loopback | `ss -ltn`; navegador do Windows em `localhost` |
| T2.7 | pendente | Isolamento com dois contextos e ciclo de vida E2E | Playwright + integração |

## Fase 3 — Missão guiada (pendente)

| ID | Status | Tarefa | Verificação planejada |
|---|---|---|---|
| T3.1 | pendente | Arquivos de conteúdo da missão e schema | validação de schema; sem textos hardcoded |
| T3.2 | pendente | Quatro passos com ação/observação/dica e "Inserir comando" | teste de inserção sem execução |
| T3.3 | pendente | Validação final e tela de sucesso com gancho de LiDAR | rota real; entrega por pose e velocidade |
| T3.4 | pendente | Playwright real com terminal, Canvas, dois perfis e ciclo de vida | `make e2e` |
| T3.5 | pendente | Medições com 1 e 2 sessões, README final e revisão do diff | `docker stats`; `git diff --check` |

## Pendências conhecidas

- A aplicação web não foi iniciada nesta entrega, por decisão de escopo.
- Duas sessões simultâneas ainda não foram medidas; a Etapa 2 fará isso.
- O piloto público exige validação de isolamento além do Docker local.
- O aviso KDL do link raiz com inércia permanece; não afeta o aceite.
