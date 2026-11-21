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

## Fase 2A — Sessão local (concluída)

| ID | Status | Tarefa | Verificação executada |
|---|---|---|---|
| T2A.1 | concluído | Adicionar agente aiohttp à imagem do lab; iniciar o launch automaticamente | `/state` = ready; `/odom` real; container `network none` |
| T2A.2 | concluído | Implementar PTY real em UDS: entrada, saída, resize, Ctrl+C | terminal real; Ctrl+C devolveu o prompt; Playwright |
| T2A.3 | concluído | Implementar telemetria `/odom` via rclpy e `/map` do simulador | pose real; `map.json` com `armazem/coleta` |
| T2A.4 | concluído | Implementar runtime controller com Docker socket e limites | container criado/removido; 2 GiB, 2 CPUs, 256 PIDs |
| T2A.5 | concluído | Implementar API FastAPI, cookie, sessão única, readiness e proxy WS | início sem login; `preparing`→`ready`; full no segundo navegador |
| T2A.6 | concluído | Implementar React/Vite, xterm.js e Canvas 2D | terminal, mapa, pose, movimento e parada |
| T2A.7 | concluído | Publicar apenas em loopback e validar `localhost` no Windows | `ss`: 127.0.0.1:8080; HTTP do Windows OK |
| T2A.8 | concluído | Encerrar sessão, remover container/UDS e iniciar outra na pose inicial | integração e Playwright; `run/sessions` vazio; pose ~0 |
| T2A.9 | concluído | Playwright real com terminal, Ctrl+C, Canvas, movimento, fim e reinício | 1 passed em 47,8–50,0 s; Canvas com pixels |
| T2A.10 | concluído | Regressão completa da Etapa 1 | `make stage1` OK após as mudanças |

### Evidências da Etapa 2A

```text
$ make stage2a
make stage1                         OK
tests/integration/stage2a...        OK
Playwright 1 passed (47.8–50.0s)         OK

sessão pronta após POST              7.26s
sessão ociosa                        73.81% de um núcleo, 269.9 MiB
API                                 43.12 MiB
runtime                             45.22 MiB
porta publicada                     127.0.0.1:8080
container da sessão                 network none, 2 GiB, 2 CPUs, 256 PIDs
socket Docker na sessão             ausente
interfaces da sessão                somente lo
segundo navegador                   full
encerrar + iniciar                  pose inicial ~(0,0)
Windows localhost/api/health        {"api":"ok","runtime":true,...}
```

## Fase 2B — Sessões, reconexão e expiração (pendente)

| ID | Status | Tarefa | Verificação planejada |
|---|---|---|---|
| T2B.1 | pendente | Múltiplas sessões simultâneas e limite configurável | dois contextos independentes |
| T2B.2 | pendente | Reconexão automática de terminal e telemetria | reload e queda de WS |
| T2B.3 | pendente | TTL, inatividade e limpeza automática | relógio acelerado/prazos curtos |
| T2B.4 | pendente | Falhas de inicialização e limpeza com retry | testes de caos |
| T2B.5 | pendente | Validação de isolamento para piloto público | rootless/VM, seccomp, auditoria |

## Fase 3 — Missão guiada (pendente)

| ID | Status | Tarefa | Verificação planejada |
|---|---|---|---|
| T3.1 | pendente | Arquivos de conteúdo da missão e schema | validação de schema; sem textos hardcoded |
| T3.2 | pendente | Quatro passos com ação/observação/dica e "Inserir comando" | teste de inserção sem execução |
| T3.3 | pendente | Validação final e tela de sucesso com gancho de LiDAR | rota real; entrega por pose e velocidade |
| T3.4 | pendente | Playwright real com terminal, Canvas, dois perfis e ciclo de vida | `make e2e` |
| T3.5 | pendente | Medições com 1 e 2 sessões, README final e revisão do diff | `docker stats`; `git diff --check` |

## Pendências conhecidas

- A Etapa 2A tem uma sessão única e não implementa reconexão, expiração ou
  publicação.
- Duas sessões simultâneas ainda não foram medidas; a Etapa 2B fará isso.
- O piloto público exige validação de isolamento além do Docker local.
- O aviso KDL do link raiz com inércia permanece; não afeta o aceite.
