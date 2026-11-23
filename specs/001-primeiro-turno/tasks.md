# Tarefas — Primeiro Turno

Legenda: **concluído**, **pendente**, **bloqueado**. Toda tarefa concluída
tem uma verificação executada; resultados detalhados em
`docs/stage1-results.md`, `docs/stage2a-results.md`, `docs/stage2b-results.md` e
`docs/stage3-results.md`.

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

## Fase 2B — Sessões, reconexão e expiração (local concluída)

| ID | Status | Tarefa | Verificação executada |
|---|---|---|---|
| T2B.1 | concluído | Até duas sessões simultâneas, reserva atômica e `full` no terceiro | integração; Playwright 2B; `test_session_capacity.py` |
| T2B.2 | concluído | Reconexão do terminal por offset e da telemetria | reload, fechamento forçado do WS e novo comando |
| T2B.3 | concluído | TTL, inatividade, aviso e limpeza automática | prazos 90/15/5 s; container removido e vaga liberada |
| T2B.4 | concluído | Reinício, falhas e reconciliação de órfãos | restart com mesma tag; `test_session_restart_failure.py`; retry de startup |
| T2B.5 | pendente | Publicação TLS e validação de isolamento para piloto público | rootless/VM, seccomp, auditoria |
| T2B.6 | concluído | Progresso no servidor por sessão e restauração no reload | `PUT /api/session/progress`; Playwright 2B |
| T2B.7 | concluído | Containers/UDS/ROS domain/GZ partition por sessão | nome único, labels, UDS por ID, dois domínios |

### Evidências da Etapa 2B

```text
make stage2b (completo)              OK
Playwright 2B                        2 passed (1.2 min)
make measure-2b                      A 7.90 s; B 6.85 s; 2 ativas; max=2
sessão ociosa                        ~270 MiB; 63-65% de um núcleo
make test-session-capacity           8/8 OK
make test-api                        2/2 OK
make stage1                          OK; startup 6.79 s
make e2e                             3 passed (2.3 min)
terceiro navegador                   full, sem container
inatividade                          aviso, expired, container removido
reconexão do terminal                WS fechado, reconectado, comando OK
reinício                             mesma tag, passo 1, pose x≈0
encerramento                         dois containers e UDS removidos
```

## Fase 4 — Piloto privado (local concluído)

| ID | Status | Tarefa | Verificação executada |
|---|---|---|---|
| T4.1 | concluído | Entrada por convite sem cadastro, código aleatório e hash | `test_pilot_store.py`; Playwright piloto |
| T4.2 | concluído | Cookie de acesso, consumo único, `full` sem consumir convite | `stage_pilot_acceptance.sh` |
| T4.3 | concluído | Pausa, retomada e fechamento por CLI | aceite local; sessões ativas preservadas |
| T4.4 | concluído | Caddy/HTTPS, Compose, env e systemd de referência | `caddy validate`; arquivos revisados |
| T4.5 | concluído | Rootfs read-only, tmpfs, ulimits e AppArmor configurável | sessão real `ready`; `docker inspect` |
| T4.6 | concluído | Eventos de missão sem conteúdo do terminal | aceite com `events`; sem termo terminal |
| T4.7 | pendente | Validação em host Ubuntu 24.04 com rootless, DNS e TLS | depende do host/domínio |
| T4.8 | pendente | WebSocket `wss://` pelo Caddy real e comparação CPU/RAM | depende do host/domínio |
| T4.9 | concluído | Playwright externo com 3 convites, lotação, retry, usado e revogado | `host-pilot.spec.ts` local aprovado |
| T4.10 | concluído | Staging isolado com projeto/estado/sockets/porta próprios e TTL curto | `make staging-expiry` OK |
| T4.11 | concluído | Verificação TLS com hostname, SAN, emissor e validade; AAAA opcional | scripts ajustados; teste real pendente de host |

### Evidências do piloto local

```text
make test-pilot                     5/5 OK
make pilot-acceptance               OK
make pilot-e2e                      2 passed
make pilot-host-e2e local            1 passed
make staging-expiry                 OK
sessão read-only                    ready; Gazebo + /odom
docker inspect                      readonly, network none, cap_drop, sem Docker
caddy validate                      Valid configuration
eventos                             invite/session/step/quiz; sem terminal
```

## Fase 3 — Missão guiada (concluída)

| ID | Status | Tarefa | Verificação executada |
|---|---|---|---|
| T3.1 | concluído | Criar `content/missions/primeiro-turno.yaml` e validação de schema | `make test-mission` 5/5 |
| T3.2 | concluído | Quatro desafios com ação, observação, dicas graduais e respostas | Playwright percorre os quatro |
| T3.3 | concluído | Prévia + Copiar sempre; Inserir só com prompt vazio; sem Enter automático | testes com texto digitado e `ros2 topic echo` em execução |
| T3.4 | concluído | Capturar pose de referência no desafio 3; deslocamento novo e parada | pose após o comando, sem depender do shell |
| T3.5 | concluído | Validar entrega apenas por `delivered` do monitor; solução com pose explícita | rota calibrada; passagem em movimento não conclui |
| T3.6 | concluído | Layout largo/intermediário/estreito e três áreas na mesma tela | Playwright mede bounding boxes nos três tamanhos |
| T3.7 | concluído | Reiniciar por recriação do container; telemetria antiga; falha e retry | Playwright + `test_session_restart_failure.py` |
| T3.8 | concluído | Playwright da missão: passagem em movimento, parada, sucesso, gancho e reinício | `stage3.spec.ts` 2 passed |
| T3.9 | concluído | Regressão completa e documentação | `make stage1`, `make stage2a`, `make e2e` |

### Evidências da Etapa 3

```text
make stage1                         OK; startup 6.28 s
make stage2a                        OK; integração 2A; Playwright 2A 1 passed (48.6 s)
make e2e                            3 passed (2.4 min)
make test-mission                   5/5 OK
make test-api                       2/2 OK

passagem pela zona em movimento      in_zone=true, delivered=false, v>0.02
parada dentro da zona                delivered=true após 2 s
reinício                             passo 1, pose x≈0
falha do novo container              erro na UI + tentativa novamente
texto no prompt / echo em execução   Inserir desabilitado; Copiar disponível
layout 1600 / 1280 / 800 px          três colunas / desafio acima / empilhado
```

## Pendências conhecidas

- A validação do piloto no host real (rootless, DNS/TLS, Caddy, wss e
  comparação CPU/RAM) permanece pendente.
- A publicação pública com TLS, autenticação de visitantes e isolamento
  reforçado (rootless/VM, seccomp, AppArmor e auditoria) permanece pendente.
- O progresso da missão é por sessão e reinicia no reinício da missão; ele
  não sobrevive à expiração nem ao reinício da API/runtime.
- A solução completa da missão é opcional e calibrada para a pose após o
  desafio 3.
- O aviso KDL do link raiz com inércia permanece; não afeta o aceite.

## Fase 5 — Etapa 4 local (4A–4D concluídas, 4E pendente)

| ID | Status | Tarefa | Verificação executada |
|---|---|---|---|
| T5.1 | concluído | Reproduzir perda de condução no navegador | teste de Inserir falhou antes da correção |
| T5.2 | concluído | Comparar xterm focado, shell direto e cadeia ROS | sequência direta e `/odom` OK; watchdog/bridge sem latch |
| T5.3 | concluído | Foco explícito ao inserir, botão Focar terminal e foco preservado em cliques do workspace | `stage4-driving.spec.ts` |
| T5.4 | concluído | Ctrl+C, publicação contínua e comando seguinte | `stage4-driving.spec.ts` |
| T5.5 | concluído | Sequência completa na mesma sessão, ré relativa à frente | Playwright com `/odom` |
| T5.6 | concluído | Manter condução após avançar e após a entrega | Playwright stage4 + stage3 atualizado |
| T5.10 | concluído | Regressão de Stage 1/2A/2B/3 e 4A após a correção de foco | `make stage2b`, `make e2e`, `make e2e-4a`, integração 2A |
| T5.7 | concluído | 4B: aula à esquerda em ~40%, visor e terminal à direita | `stage2a.spec.ts` e `make e2e` |
| T5.8 | concluído | 4C: curso v2 com seis módulos e Tab validado | `test-mission` 6/6; `stage4-driving` |
| T5.9 | concluído | 4D: LiDAR real, sensores headless e obstáculos | `/scan` real; camada no Canvas |
| T5.12 | concluído | 4F: curso v3, nove módulos e 23 desafios verificáveis (command, answer, quiz, pose, scan, delivery) | `test-mission` 22/22; `make e2e-3` 3/3 com os 23 desafios no simulador real |
| T5.13 | concluído | 4F: progresso v3 e eventos `task_entered`/`task_done`/`answer_wrong` sem comandos nem respostas | `test-session-capacity`, `test-pilot` |
| T5.14 | concluído | 4F: specs e2e adaptados ao curso v3 (`course-helpers.ts`) | `make e2e` 4/4, `make e2e-4a` 8/8, `make e2e-2b` 2/2 |
| T5.11 | pendente | 4E: teste com iniciante e host externo | depende de pessoa/host |
