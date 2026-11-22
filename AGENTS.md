# AGENTS.md

## Estado atual

O repositório implementa as **Etapas 1, 2A, 2B local, 3 e o piloto privado
local** do ROS 2 Launchpad. Duas sessões anônimas simultâneas ficam em
`http://localhost:8080`, cada uma com container, ROS graph, terminal Linux
real, Canvas 2D e progresso próprios. No piloto, a entrada é por convite; o
host Ubuntu 24.04 com rootless, DNS/TLS e validação reforçada continua
pendente antes de publicar.

## Estrutura

```text
content/world/armazem.yaml                  fonte única da geometria
content/missions/primeiro-turno.yaml        conteúdo da missão guiada
docs/stage1-results.md                      evidências da Etapa 1
docs/stage2a-results.md                     evidências da Etapa 2A
docs/stage2b-results.md                     evidências da Etapa 2B local
docs/stage3-results.md                      evidências da Etapa 3
docs/stage4-results.md                      evidências da Etapa 4 local (4A–4D)
docs/pilot-runbook.md                       operação do piloto privado
docs/pilot-results.md                       evidências locais do piloto
deploy/                                     Caddyfile, env e systemd
scripts/                                    admin, preflight e verify do piloto
lab/ros_ws/src/launchpad_sim/               robô, mundo, watchdog e monitor
lab/ros_ws/src/launchpad_bringup/           launch headless
lab/image/Dockerfile                        imagem do laboratório
lab/image/agent/                            agente aiohttp, PTY, launch e /odom
apps/api/                                   FastAPI, sessão e proxy UDS
apps/runtime/                               controlador do Docker
apps/web/                                   React + TypeScript + Vite
specs/001-primeiro-turno/                   spec, plan e tasks
tests/integration/                          aceite real, piloto e staging
tests/e2e/                                  Playwright 2A, 2B, missão, piloto e host
compose.yaml                                lab, api e runtime
compose.pilot.yaml                          convite, estado e hardening
compose.pilot-staging.yaml                  staging isolado com TTL curto
Makefile                                    comandos reproduzíveis
```

## Convenções

- Interface, textos e documentação em português do Brasil.
- Identificadores de código em inglês; sem comentários no código.
- Python 3.12 nos containers; ROS 2 Jazzy; `ament_python`.
- A geometria do armazém tem uma única fonte: `content/world/armazem.yaml`.
  O SDF e o `map.json` são gerados por `generate_world.py` na imagem.
- O referencial da missão é `odom`; o robô nasce em `(0, 0, 0)`.
- `/cmd_vel` é a entrada do aluno. O watchdog publica em
  `/launchpad/_cmd_vel_safe`, ligado ao Gazebo.
- `/odom` é a fonte de pose e velocidade para o Canvas e para a validação.
  O Gazebo publica a pose de mundo em `/launchpad/_odom_world` e as rodas em
  `/launchpad/_odom_encoder`; o nó `odom_merge` combina pose de mundo com
  velocidade das rodas. As duas topics internas começam com `_` e ficam
  ocultas do `ros2 topic list` do aluno.
- O robô tem dois casters (traseiro e frontal); o frontal evita que o chassi
  incline sob aceleração/frenagem e que o LiDAR atinja o piso.
- O serviço `lab` é manual e serve à Etapa 1. Cada sessão web é um container
  efêmero criado pelo runtime a partir da mesma imagem, com nome
  `ros2-launchpad-session-<id>` e UDS própria.
- A API nunca recebe o socket do Docker. Somente `apps/runtime` o acessa.
- O navegador fala apenas com a API; não acessa runtime, UDS ou Docker.
- Não copiar, clonar nem importar código do projeto
  `ros2-warehouse-amr-simulator` ou de outros projetos pessoais.
- Não adicionar GUI, WSLg, X11, RViz, GPU ou publicação pública.
- Até duas sessões simultâneas (`MAX_SESSIONS=2`); a reserva é atômica e a
  terceira recebe `full`. Publicação TLS e piloto público exigem revisão.

## Comandos reais

```bash
make build                 # imagem do laboratório
make build-app             # imagens da API e do runtime
make up                    # constrói e sobe a aplicação em 127.0.0.1:8080
make down                  # para aplicação e remove todas as sessões
make session-down          # força a remoção das sessões e reinicia API/runtime
make stage1                # aceite completo da Etapa 1
make stage2a               # Etapa 1 + integração 2A + Playwright 2A
make stage2b               # Etapas 1 + integração 2B + Playwright 2B
make measure-2b            # mede duas sessões simultâneas
make stage3                # Etapa 1 + conteúdo/API + aplicação + Playwright
make e2e                   # Playwright completo (2A + missão)
make e2e-4a                # regressão de Tab/foco/condução da 4A
make test-mission          # schema e conteúdo da missão
make test-api              # restart com falha e retry
make test-session-capacity # capacidade, progresso, TTL e reconciliação
make test-pilot            # convite, controle, rate limit e eventos
make pilot-up              # API/runtime com convite e hardening
make pilot-down            # encerra o piloto e remove as sessões
make pilot-admin           # CLI de convites/controle (ARGS=...)
make pilot-verify          # pré-requisitos e HTTPS do host
make pilot-inspect         # inspeção real do isolamento das sessões
make pilot-acceptance      # aceite local de convite/pausa/fechamento
make pilot-e2e             # Playwright da tela de convite
make pilot-host-e2e        # Playwright externo, 3 contextos
make staging-up            # piloto isolado com TTL curto
make staging-admin         # CLI do staging
make staging-expiry        # expiração curta do staging
make staging-down          # limpa o staging
make test-world            # geometria e geração do mundo
make lab-up                # container manual da Etapa 1
make lab-shell             # shell no laboratório manual
make lab-logs              # logs do laboratório manual
make lab-down              # para e remove os containers do compose
```

URL local: `http://localhost:8080`. A interface é publicada apenas em
loopback; o runtime e a API interna não recebem portas públicas.

Dentro do laboratório manual (Etapa 1):

```bash
source /opt/ros/jazzy/setup.bash
source /ros_ws/install/setup.bash
ros2 launch launchpad_bringup lab.launch.py
```

Dentro do terminal do navegador, o ambiente já está carregado. O curso guia
seis módulos; os comandos abaixo são a referência da Etapa 1:

```bash
ros2 topic list
ros2 topic echo /odom
ros2 topic pub --rate 10 --times 30 /cmd_vel \
  geometry_msgs/msg/Twist "{linear: {x: 0.2}}"
```

A missão usa o monitor ROS para confirmar a entrega: pare dentro da zona por
2 s. A solução completa é opcional e fica na última dica; o progresso é por
sessão na API, sobrevive a recarregar a página e reinicia no reinício da
missão.

## Portão de verificação

Antes de concluir qualquer alteração:

```bash
make stage1
make stage2a
make stage2b
make e2e
make e2e-4a
make test-pilot
make pilot-acceptance
```

O aceite exige dados reais do simulador e do ROS 2, não mocks. Atualize
`specs/001-primeiro-turno/tasks.md`, `docs/stage1-results.md`,
`docs/stage2a-results.md` e `docs/stage3-results.md` com o que foi executado,
o que passou e o que permanece pendente.

## Runtime e segurança (Etapas 2A, 2B e 3)

- `apps/runtime` é o único componente com `/var/run/docker.sock`; ele cria,
  inspeciona e remove `ros2-launchpad-session-<id>`, com labels
  `launchpad.role=session`, `launchpad.project`, `launchpad.session` e
  `launchpad.managed`. O runtime filtra pelo próprio projeto.
- `apps/api` tem HTTP interno com `RUNTIME_TOKEN` e acesso à UDS da sessão;
  não tem Docker.
- `apps/web` fala apenas com a API, por HTTP e WebSocket.
- O agente da sessão roda como UID 1000, em `network none`, com
  `cap_drop: ALL`, `no-new-privileges`, 2 GiB, 2 CPUs e 256 PIDs; não tem
  socket Docker nem rede externa.
- A UDS fica em `/run/sessions/<id>/agent.sock`; o container monta apenas o
  próprio diretório em `/run/agent`. Cada sessão recebe `ROS_DOMAIN_ID` e
  `GZ_PARTITION` próprios.
- O reinício da missão remove e recria o container mantendo vaga e tag; a UI
  descarta telemetria por geração, zera o progresso e trata falha com nova
  tentativa.
- O progresso da missão é validado e guardado na API por sessão.
- No piloto, `PILOT_ENABLED` exige convite para novas sessões; convites são
  hashes, consumidos uma vez, e o estado fica em `run/pilot` com modo 0700.
- `PILOT_STATE_DIR` é montado na API; `PILOT_TRUST_FORWARDED` só pode ser
  habilitado atrás do Caddy local.
- Eventos do piloto são JSONL derivados do progresso e não incluem conteúdo do
  terminal, comandos, códigos de convite ou IP em claro.
- TTL 1800 s, inatividade 600 s, aviso 120 s e monitor 2 s são configuráveis;
  criar, interagir e tocar contam como atividade; telemetria não conta.
- O piloto pode rodar com `SESSION_READ_ONLY=true`, tmpfs, ulimits e
  `SESSION_APPARMOR`; o host deve ser rootless.
- O staging usa projeto, porta, estado, sockets e labels próprios
  (`launchpad.project=staging`); não deve compartilhar o mesmo `run/sessions`.
- `tests/e2e/host-pilot.spec.ts` é externo e não faz administração; convites,
  pausa e fechamento usam o CLI no host.
- Cookie `HttpOnly`, `SameSite=Lax`; validação de `Origin`; token do agente
  não é exposto ao shell.
- `HOST_RUN_DIR` é passado pelo Makefile para o runtime e deve ser um caminho
  absoluto no host.
- O perfil local não é um piloto público. Para shells anônimos, Docker
  sozinho não é uma fronteira forte; rootless/VM/seccomp/AppArmor e auditoria
  continuam requisitos antes da publicação.
- O piloto privado espera host Ubuntu 24.04 com Docker rootless, Caddy 2,
  DNS e 80/443; `make pilot-verify` e o runbook descrevem o aceite.
- DNS, TLS/WSS externos, isolamento efetivo e métricas de CPU/RAM do host
  continuam pendentes até a execução em um servidor real.

## Limitações atuais

- Duas sessões por vez; o terceiro navegador recebe `full`.
- Reconexão automática de terminal e telemetria; TTL, inatividade e limpeza
  automática fazem parte da 2B local.
- Se o navegador fechar sem clicar em “Encerrar sessão”, a vaga é liberada
  por inatividade/TTL; `make session-down`/`make down` continuam disponíveis.
- Sem publicação pública, TLS real, cadastro, SLAM, Nav2 ou visor 3D.
- O LiDAR `gpu_lidar` roda headless no WSL sem GPU dedicada; o custo no host
  real e o teste com iniciante continuam pendentes.
- O piloto privado tem entrada por convite e templates de Caddy/host; a
  validação em domínio público continua pendente.
- O progresso da missão sobrevive a recarregar a página, mas reinicia no
  reinício da missão e ao reiniciar API/runtime.
- O visor é dividido em planta 2D e visão em primeira pessoa por raycasting
  do mapa, sem câmera Gazebo.
- O terminal tem foco explícito ao inserir, botão **Focar terminal**,
  **Ctrl+C** e **Ctrl+Shift+E**; Tab, condução, LiDAR e o curso de seis módulos
  são cobertos por `stage4-driving.spec.ts`, `stage3.spec.ts` e
  `stage2a.spec.ts`.
- A solução completa da missão é opcional e calibrada para a pose após o
  desafio 3.
- A sessão em si não monta `/tests`, `/content` nem o repositório.

## Avisos conhecidos

- O KDL avisa que o link raiz `base_link` tem inércia. O Gazebo e o controle
  funcionam; o aviso não altera pose ou velocidade.
- Com `network none`, o transporte do Gazebo pode avisar sobre IP preferido.
  `GZ_IP=127.0.0.1` mantém o funcionamento local.
- O Playwright usa `--network host` no teste para alcançar o loopback do WSL.
  Isso é artefato de teste, não faz parte da aplicação.
