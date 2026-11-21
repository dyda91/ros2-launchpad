# AGENTS.md

## Estado atual

O repositório implementa as **Etapas 1, 2A e 3** do ROS 2 Launchpad. A Etapa
2B (sessões simultâneas, reconexão, expiração e publicação) permanece
especificada, mas não implementada.

A sessão local única fica em `http://localhost:8080`, com terminal Linux real,
Canvas 2D, ROS 2 real e a missão guiada "Primeiro Turno". Não há cadastro.

## Estrutura

```text
content/world/armazem.yaml                  fonte única da geometria
content/missions/primeiro-turno.yaml        conteúdo da missão guiada
docs/stage1-results.md                      evidências da Etapa 1
docs/stage2a-results.md                     evidências da Etapa 2A
docs/stage3-results.md                      evidências da Etapa 3
lab/ros_ws/src/launchpad_sim/               robô, mundo, watchdog e monitor
lab/ros_ws/src/launchpad_bringup/           launch headless
lab/image/Dockerfile                        imagem do laboratório
lab/image/agent/                            agente aiohttp, PTY, launch e /odom
apps/api/                                   FastAPI, sessão e proxy UDS
apps/runtime/                               controlador do Docker
apps/web/                                   React + TypeScript + Vite
specs/001-primeiro-turno/                   spec, plan e tasks
tests/integration/                          aceite real da Etapa 1 e 2A
tests/e2e/                                  Playwright
compose.yaml                                lab, api e runtime
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
- O serviço `lab` é manual e serve à Etapa 1. A sessão web é um container
  efêmero criado pelo runtime a partir da mesma imagem.
- A API nunca recebe o socket do Docker. Somente `apps/runtime` o acessa.
- O navegador fala apenas com a API; não acessa runtime, UDS ou Docker.
- Não copiar, clonar nem importar código do projeto
  `ros2-warehouse-amr-simulator` ou de outros projetos pessoais.
- Não adicionar GUI, WSLg, X11, RViz, GPU ou publicação pública.
- Uma sessão simultânea nesta entrega; não implementar 2B sem revisão.

## Comandos reais

```bash
make build                 # imagem do laboratório
make build-app             # imagens da API e do runtime
make up                    # constrói e sobe a aplicação em 127.0.0.1:8080
make down                  # para aplicação e remove a sessão
make session-down          # força a remoção da sessão ativa
make stage1                # aceite completo da Etapa 1
make stage2a               # Etapa 1 + integração 2A + Playwright 2A
make stage3                # Etapa 1 + conteúdo/API + aplicação + Playwright
make e2e                   # Playwright completo (2A + missão)
make test-mission          # schema e conteúdo da missão
make test-api              # restart com falha e retry
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

Dentro do terminal do navegador, o ambiente já está carregado. A missão guia
os quatro desafios; os comandos abaixo são a referência da Etapa 1:

```bash
ros2 topic list
ros2 topic echo /odom
timeout 3 ros2 topic pub --rate 10 /cmd_vel \
  geometry_msgs/msg/Twist "{linear: {x: 0.2}}"
```

A missão usa o monitor ROS para confirmar a entrega: pare dentro da zona por
2 s. A solução completa é opcional e fica na última dica; o progresso é em
memória e reinicia ao recarregar a página.

## Portão de verificação

Antes de concluir qualquer alteração:

```bash
make stage1
make stage2a
make e2e
```

O aceite exige dados reais do simulador e do ROS 2, não mocks. Atualize
`specs/001-primeiro-turno/tasks.md`, `docs/stage1-results.md`,
`docs/stage2a-results.md` e `docs/stage3-results.md` com o que foi executado,
o que passou e o que permanece pendente.

## Runtime e segurança (Etapas 2A e 3)

- `apps/runtime` é o único componente com `/var/run/docker.sock`; ele cria,
  inspeciona e remove `ros2-launchpad-session`.
- `apps/api` tem HTTP interno com `RUNTIME_TOKEN` e acesso à UDS da sessão;
  não tem Docker.
- `apps/web` fala apenas com a API, por HTTP e WebSocket.
- O agente da sessão roda como UID 1000, em `network none`, com
  `cap_drop: ALL`, `no-new-privileges`, 2 GiB, 2 CPUs e 256 PIDs; não tem
  socket Docker nem rede externa.
- A UDS fica em `/run/sessions/<id>/agent.sock`; o container monta apenas o
  próprio diretório em `/run/agent`.
- O reinício da missão remove e recria o container; a UI descarta telemetria
  por geração e trata falha de criação com nova tentativa.
- Cookie `HttpOnly`, `SameSite=Lax`; validação de `Origin`; token do agente
  não é exposto ao shell.
- `HOST_RUN_DIR` é passado pelo Makefile para o runtime e deve ser um caminho
  absoluto no host.
- O perfil local não é um piloto público. Para shells anônimos, Docker
  sozinho não é uma fronteira forte; rootless/VM/seccomp/AppArmor e auditoria
  são requisitos da Etapa 2B.

## Limitações atuais

- Uma sessão por vez; um segundo navegador recebe `full`.
- Sem reconexão automática, TTL, inatividade ou limpeza automática (Etapa 2B).
- Se o navegador fechar sem clicar em “Encerrar sessão”, use
  `make session-down` ou `make down`.
- Sem publicação, cadastro, LiDAR, SLAM, Nav2 ou visor 3D.
- O progresso da missão é em memória e reinicia ao recarregar a página.
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
