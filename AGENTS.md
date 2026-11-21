# AGENTS.md

## Estado atual

O repositório implementa a **Etapa 1** e a **Etapa 2A** do ROS 2 Launchpad.
A Etapa 2B (sessões simultâneas, reconexão, expiração e publicação) e a Etapa
3 (missão guiada completa) estão especificadas, mas não implementadas.

A Etapa 2A é uma sessão local única, acessível em `http://localhost:8080`,
com terminal Linux real, Canvas 2D e ROS 2 real. Não há cadastro.

## Estrutura

```text
content/world/armazem.yaml                  fonte única da geometria
docs/stage1-results.md                      evidências da Etapa 1
docs/stage2a-results.md                     evidências da Etapa 2A
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
- Uma sessão simultânea nesta entrega; não implementar 2B/3 sem revisão.

## Comandos reais

```bash
make build                 # imagem do laboratório
make build-app             # imagens da API e do runtime
make up                    # constrói e sobe a aplicação em 127.0.0.1:8080
make down                  # para aplicação e remove a sessão
make session-down          # força a remoção da sessão ativa
make stage1                # aceite completo da Etapa 1
make stage2a               # Etapa 1 + integração 2A + Playwright
make e2e                   # Playwright contra a aplicação local
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

Dentro do terminal do navegador (Etapa 2A), o ambiente já está carregado:

```bash
ros2 topic list
ros2 topic echo /odom
timeout 3 ros2 topic pub --rate 10 /cmd_vel \
  geometry_msgs/msg/Twist "{linear: {x: 0.2}}"
```

## Portão de verificação

Antes de concluir qualquer alteração:

```bash
make stage1
make stage2a
```

O aceite exige dados reais do simulador e do ROS 2, não mocks. Atualize
`specs/001-primeiro-turno/tasks.md`, `docs/stage1-results.md` e
`docs/stage2a-results.md` com o que foi executado, o que passou e o que
permanece pendente.

## Runtime e segurança na Etapa 2A

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
- Cookie `HttpOnly`, `SameSite=Lax`; validação de `Origin`; token do agente
  não é exposto ao shell.
- `HOST_RUN_DIR` é passado pelo Makefile para o runtime e deve ser um caminho
  absoluto no host.
- O perfil local não é um piloto público. Para shells anônimos, Docker
  sozinho não é uma fronteira forte; rootless/VM/seccomp/AppArmor e auditoria
  são requisitos da Etapa 2B.

## Limitações da Etapa 2A

- Uma sessão por vez; um segundo navegador recebe `full`.
- Sem reconexão automática, TTL, inatividade ou limpeza automática.
- Se o navegador fechar sem clicar em “Encerrar sessão”, use
  `make session-down` ou `make down`.
- Sem publicação, cadastro, LiDAR, SLAM, Nav2, visor 3D ou missão guiada.
- A sessão em si não monta `/tests`, `/content` nem o repositório.

## Avisos conhecidos

- O KDL avisa que o link raiz `base_link` tem inércia. O Gazebo e o controle
  funcionam; o aviso não altera pose ou velocidade.
- Com `network none`, o transporte do Gazebo pode avisar sobre IP preferido.
  `GZ_IP=127.0.0.1` mantém o funcionamento local.
- O Playwright usa `--network host` no teste para alcançar o loopback do WSL.
  Isso é artefato de teste, não faz parte da aplicação.
