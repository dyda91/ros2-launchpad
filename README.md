# ROS 2 Launchpad

Laboratório de ROS 2 no navegador para iniciantes. O visitante inicia uma
sessão local, recebe um robô em um armazém, um terminal Linux real e um visor
2D, sem cadastro.

## Status

- **Etapa 1:** robô, armazém, simulação headless, `/cmd_vel`, `/odom` e
  watchdog — implementada e validada.
- **Etapa 2A:** sessão local única no navegador, terminal real e Canvas 2D —
  implementada e validada.
- **Etapa 2B:** sessões simultâneas, reconexão, expiração e publicação —
  pendente.
- **Etapa 3:** missão guiada completa — pendente.

## O que funciona

- Imagem Ubuntu 24.04.5 + ROS 2 Jazzy + Gazebo Sim 8.15.0, headless.
- Robô diferencial próprio, com duas rodas motrizes e caster passivo.
- Armazém de 8 × 6 m gerado de `content/world/armazem.yaml`.
- `/cmd_vel` e `/odom` reais; watchdog de 0,5 s.
- Página React/TypeScript/Vite em `http://localhost:8080`.
- Sessão única criada pelo clique em “Iniciar laboratório”.
- Terminal xterm.js conectado a um PTY bash real dentro do container da
  sessão.
- Visor Canvas 2D com o mesmo `map.json` do simulador e pose real de `/odom`.
- Encerramento que remove o container e libera uma nova sessão na pose
  inicial.

O acesso é apenas local, em loopback. Não há cadastro, publicação, LiDAR,
SLAM, Nav2, visor 3D ou missão guiada nesta entrega.

## Pré-requisitos no WSL

- Windows 10/11 com WSL 2 e uma distribuição Ubuntu.
- Docker Engine e Compose funcionando dentro do WSL.
- Usuário com acesso ao socket do Docker.
- Python 3 no WSL para o script de aceite da Etapa 1 e a CLI.
- Pelo menos 8 GB de RAM no WSL e ~15 GB livres para as imagens.
- Nenhum requisito de GPU, WSLg, X11 ou RViz.
- Porta 8080 livre no loopback.

```bash
docker --version
docker compose version
docker info >/dev/null && echo "daemon ok"
python3 --version
```

## Início rápido — Etapa 2A

```bash
cd ~/ros2-launchpad
make build          # imagem do laboratório
make up             # imagens da API/runtime + aplicação em loopback
```

Abra no navegador do Windows:

```text
http://localhost:8080
```

Clique em **Iniciar laboratório** e aguarde o estado **Pronto**. O simulador é
iniciado automaticamente; não é necessário executar `ros2 launch` em outro
terminal.

Para parar:

```bash
make down
```

Se o navegador fechar sem encerrar a sessão:

```bash
make session-down
```

## O que testar no navegador

No terminal do laboratório:

```bash
ros2 topic list
```

Confirme `/cmd_vel` e `/odom`. Depois:

```bash
ros2 topic echo /odom
```

Pressione **Ctrl+C** e confirme que o prompt volta.

Mova o robô com o comando validado na Etapa 1:

```bash
timeout 3 ros2 topic pub --rate 10 /cmd_vel \
  geometry_msgs/msg/Twist "{linear: {x: 0.2}}"
```

O robô deve andar no Canvas e parar após o watchdog. Clique em **Encerrar
sessão** e inicie outra; a nova sessão começa na pose inicial.

## Aceite

```bash
make stage1    # regressão da Etapa 1
make stage2a   # Etapa 1 + integração 2A + Playwright
```

O `make stage2a`:

1. executa o aceite da Etapa 1;
2. para o laboratório manual;
3. sobe API e runtime em `127.0.0.1:8080`;
4. valida sessão, mapa, tópicos, isolamento e encerramento;
5. executa o Playwright real com terminal, Ctrl+C, movimento, Canvas e
   reinício.

Para rodar apenas o navegador automatizado:

```bash
make e2e
```

O Playwright usa Chromium headless em um container de teste com
`--network host` para alcançar o loopback do WSL.

## Resultados observados

Etapa 1: startup **5,85–6,61 s**, parada **0,400 s**, ~**67–70%** de um núcleo
e **~258 MiB** ociosa. Etapa 2A: sessão pronta em **7,26 s**, Playwright
**1 passed em 47,8–50,0 s**, sessão ociosa **73,81%** de um núcleo e **269,9 MiB**.

Detalhes:

- [`docs/stage1-results.md`](docs/stage1-results.md)
- [`docs/stage2a-results.md`](docs/stage2a-results.md)

## Arquitetura

```text
Navegador do Windows
  http://localhost:8080
        │
        ▼
  apps/api (FastAPI, 127.0.0.1:8080)
    - serve o build React/Vite
    - cookie HttpOnly, sessão única
    - proxy de terminal e telemetria
        ├── HTTP interno + token ──► apps/runtime (Docker socket)
        │                              └── cria/remove a sessão
        └── UDS /run/sessions/<id>/agent.sock
                                           │
                                           ▼
                             container de sessão (network none)
                               launchpad_agent (aiohttp em UDS)
                                 ├── ros2 launch
                                 ├── PTY bash
                                 └── rclpy /odom
```

Apenas `apps/runtime` recebe `/var/run/docker.sock`. A API não tem Docker. O
navegador não acessa runtime, UDS ou Docker. O container da sessão roda como
UID 1000, com `cap_drop: ALL`, `no-new-privileges`, 2 GiB, 2 CPUs, 256 PIDs,
sem rede externa e sem socket Docker. Ele monta somente o próprio diretório de
UDS em `/run/agent`.

O serviço `lab` continua sendo o laboratório manual da Etapa 1. A sessão web
usa um container efêmero criado a partir da mesma imagem.

## Etapa 1 — laboratório manual

```bash
make lab-up
make lab-shell
```

Dentro do container:

```bash
source /opt/ros/jazzy/setup.bash
source /ros_ws/install/setup.bash
ros2 launch launchpad_bringup lab.launch.py
```

Em outro terminal do WSL:

```bash
docker compose exec lab bash -lc \
  'source /opt/ros/jazzy/setup.bash; source /ros_ws/install/setup.bash; \
   ros2 topic list'
```

O laboratório manual não inicia o simulador automaticamente; o launch é
manual. A sessão da Etapa 2A é diferente: o agente inicia o launch dentro do
container efêmero.

Testes da geometria e da simulação:

```bash
make test-world
make stage1
```

## Comandos

```bash
make build       # imagem do laboratório
make build-app   # imagens da API e do runtime
make up          # aplicação em 127.0.0.1:8080
make down        # para tudo e remove a sessão
make session-down # força a remoção da sessão e reinicia API/runtime
make stage1      # aceite da Etapa 1
make stage2a     # aceite da Etapa 2A
make e2e         # Playwright
make lab-up      # laboratório manual
make lab-shell   # shell no laboratório manual
make lab-logs    # logs do laboratório manual
make lab-down    # para e remove os containers do compose
```

O Makefile define `HOST_RUN_DIR` como `$(CURDIR)/run/sessions` e o passa ao
runtime. Se o repositório for movido, use `make` a partir do novo caminho. Para
subir com Compose diretamente, defina `HOST_RUN_DIR` como caminho absoluto.

## Estrutura

```text
content/world/armazem.yaml                  fonte única da geometria
lab/ros_ws/src/launchpad_sim/               URDF, gerador, watchdog e monitor
lab/ros_ws/src/launchpad_bringup/           launch headless
lab/image/Dockerfile                        imagem do laboratório
lab/image/agent/                            agente da sessão (aiohttp/PTY/ROS)
apps/api/                                   FastAPI e proxy UDS
apps/runtime/                               controlador do Docker
apps/web/                                   React + TypeScript + Vite
specs/001-primeiro-turno/                   spec, plan e tasks
tests/integration/                          aceite real
tests/e2e/                                  Playwright
docs/                                       resultados medidos
```

## Falhas comuns

**“Laboratório em uso”**

A entrega tem uma sessão por vez. Encerre a sessão no outro navegador ou use
`make session-down`.

**Sessão presa após fechar o navegador**

```bash
make session-down
```

Isso remove o container e reinicia API/runtime. A expiração automática fica
para a Etapa 2B.

**Aplicação não responde em 8080**

```bash
docker compose ps
docker compose logs --tail=100 api runtime
ss -ltn | grep 8080
```

Verifique se outra aplicação usa a porta. O `make up` publica somente
`127.0.0.1:8080`.

**Playwright não consegue abrir a página**

O teste precisa de Docker e da aplicação em `127.0.0.1:8080`. Rode
`make up` antes ou use `make stage2a`. A imagem oficial do Playwright é
grande e pode demorar na primeira execução.

**Permissão no socket Docker**

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

Faça isso apenas com autorização; é uma mudança no sistema.

**O simulador não inicia na sessão**

Veja os logs do agente:

```bash
docker logs ros2-launchpad-session
docker compose logs --tail=100 runtime api
```

O agente grava o launch em `/tmp/lab_launch.log` dentro da sessão.

**Aviso KDL sobre inércia no link raiz**

É um aviso conhecido do `robot_state_publisher`; o aceite e o controle
funcionam.

**O acesso pelo navegador do Windows não abre**

O WSL em NAT encaminha `localhost`. Confira:

```bash
curl http://127.0.0.1:8080/api/health
powershell.exe -NoProfile -Command \
  "(Invoke-WebRequest -UseBasicParsing http://localhost:8080/api/health).Content"
```

## Limitações desta entrega

- Uma sessão simultânea; o segundo navegador recebe “Laboratório em uso”.
- Sem reconexão automática, expiração, TTL ou limpeza por inatividade.
- Sem publicação pública, TLS, cadastro, LiDAR, SLAM, Nav2, visor 3D ou missão
  guiada.
- O perfil local não é um piloto público. O isolamento para shells anônimos
  exige validação adicional (rootless/VM, seccomp/AppArmor, auditoria).
- O teste Playwright usa `--network host` no WSL; isso é artefato de teste.

Consulte [`specs/001-primeiro-turno/spec.md`](specs/001-primeiro-turno/spec.md),
[`plan.md`](specs/001-primeiro-turno/plan.md) e
[`tasks.md`](specs/001-primeiro-turno/tasks.md).
