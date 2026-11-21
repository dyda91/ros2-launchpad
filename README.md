# ROS 2 Launchpad

Laboratório de ROS 2 no navegador para iniciantes. O visitante inicia uma
sessão local, recebe um robô em um armazém, um terminal Linux real e um visor
2D, sem cadastro.

## Status

- **Etapa 1:** robô, armazém, simulação headless, `/cmd_vel`, `/odom` e
  watchdog — implementada e validada.
- **Etapa 2A:** sessão local única no navegador, terminal real e Canvas 2D —
  implementada e validada.
- **Etapa 2B local:** duas sessões simultâneas, progresso por sessão,
  reconexão de terminal/telemetria, TTL, inatividade, aviso e limpeza —
  implementada e validada.
- **Etapa 3:** missão guiada "Primeiro Turno", quatro desafios, inserção segura
  de comandos, validação da entrega e reinício — implementada e validada.
- **Piloto privado local:** entrada por convite, rootfs read-only, eventos de
  missão e templates de Caddy/host — implementado e validado localmente.
- **Piloto público:** DNS/TLS reais, rootless validado no host e isolamento
  reforçado — pendente.

## O que funciona

- Imagem Ubuntu 24.04.5 + ROS 2 Jazzy + Gazebo Sim 8.15.0, headless.
- Robô diferencial próprio, com duas rodas motrizes e caster passivo.
- Armazém de 8 × 6 m gerado de `content/world/armazem.yaml`.
- `/cmd_vel` e `/odom` reais; watchdog de 0,5 s.
- Página React/TypeScript/Vite em `http://localhost:8080`.
- Até duas sessões anônimas simultâneas criadas pelo clique em “Iniciar
  laboratório”, com containers, UDS, ROS graph e progresso próprios.
- Terminal xterm.js conectado a um PTY bash real dentro do container da
  sessão.
- Visor Canvas 2D com o mesmo `map.json` do simulador e pose real de `/odom`.
- Missão guiada em quatro desafios, com ação/observação/dica e conteúdo em YAML.
- Validação da entrega pelo `mission_monitor` real; passar pela zona em
  movimento não conclui.
- Reinício da missão que recria o container e volta à pose inicial.
- Encerramento que remove o container e libera a vaga.
- Reconexão automática do terminal e da telemetria; progresso restaurado ao
  recarregar a página.
- Expiração por 10 min de inatividade ou 30 min de TTL, com aviso 2 min antes
  e liberação automática da vaga.
- Piloto privado com convite de uso único, sem cadastro; pausa, retomada e
  encerramento por CLI.

O acesso local é em loopback. O piloto privado usa convite e pode ser exposto
por um Caddy no host; a validação pública com DNS/TLS reais continua pendente.
Não há cadastro, LiDAR, SLAM, Nav2 ou visor 3D.

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

## Início rápido — sessão e missão

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
terminal. O painel da missão aparece ao lado do visor e do terminal.

Para parar:

```bash
make down
```

Se o navegador fechar sem encerrar a sessão, a vaga é liberada pela
inatividade/TTL. Para forçar a limpeza:

```bash
make session-down
```

## O que testar no navegador

A missão começa no desafio 1. Use **Copiar** ou **Inserir no terminal** na
prévia do comando; pressione Enter no terminal. A inserção só é liberada
quando o shell está no prompt vazio.

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

O robô deve andar no Canvas e parar após o watchdog. Siga os desafios 2, 3 e 4
no painel. No desafio 4, a entrega só é confirmada quando o robô para dentro
da zona por 2 s. Use **Reiniciar missão** para recriar a sessão e voltar ao
desafio 1; **Encerrar sessão** libera a vaga.

O progresso fica guardado na API por sessão: recarregar a página restaura o
painel; **Reiniciar missão** zera o progresso e recria o container. A sessão
expira após 10 min sem atividade ou 30 min no total.

## Piloto privado

O piloto exige um convite. O código é entregue por canal privado, entra em
`/api/pilot/redeem` e vira um cookie de acesso; ele não aparece na URL nem nos
logs. O convite é consumido na primeira sessão.

```bash
make test-pilot          # convite, controle, rate limit e eventos
make pilot-up            # com as variáveis do host carregadas
make pilot-admin ARGS="invite --label guest-1 --ttl 7200"
make pilot-verify        # host, DNS, TLS e health
make pilot-acceptance    # aceite local com prazos curtos
make pilot-e2e PILOT_INVITE_CODE=...  # Playwright da entrada
```

O host recomendado é uma VM Ubuntu Server 24.04 com Docker rootless, Caddy 2,
DNS e 80/443. O Caddyfile, env, systemd e hardening estão em `deploy/` e
`compose.pilot.yaml`. Consulte [`docs/pilot-runbook.md`](docs/pilot-runbook.md).

A trilha de eventos do piloto registra desafio, dicas, quiz, solução e entrega,
sem conteúdo do terminal ou comandos.

## Aceite

```bash
make stage1      # regressão da Etapa 1
make stage2a     # Etapa 1 + integração 2A + Playwright 2A
make stage2b     # Etapa 1 + integração 2B + Playwright 2B
make measure-2b  # mede duas sessões simultâneas
make test-mission # schema e conteúdo da missão
make test-api    # falha do novo container e retry
make test-session-capacity # capacidade, progresso, TTL e reconciliação
make test-pilot  # convites, controle, rate limit e eventos
make pilot-up    # API/runtime com convite e hardening
make pilot-down  # encerra o piloto e remove as sessões
make pilot-admin # CLI de convites/controle
make pilot-verify # pré-requisitos e HTTPS do host
make pilot-acceptance # aceite local do piloto
make e2e         # Playwright completo: 2A + Primeiro Turno
make stage3      # Etapa 1 + conteúdo/API + aplicação + Playwright
```

O `make e2e` valida terminal, Canvas, layout responsivo, os quatro desafios,
inserção com texto já digitado, `ros2 topic echo` em execução, passagem pela
zona em movimento, conclusão após a parada, reinício com pose e painel
restaurados e a falha de reinício com nova tentativa.

O `make stage2b` usa prazos curtos (TTL 90 s, inatividade 15 s, aviso 5 s) e
valida duas sessões isoladas, terceiro navegador `full`, progresso, reload,
reconexão do terminal e expiração. Ele é separado do `make e2e`, que mantém os
prazos normais.

O Playwright usa Chromium headless em um container de teste com
`--network host` para alcançar o loopback do WSL.

## Resultados observados

Etapa 1: startup **6,25–6,28 s** na rodada final, parada **0,400 s**,
~**67–70%** de um núcleo e **~258 MiB** ociosa. Etapa 2A: sessão pronta em
**7,26 s**, Playwright 2A **1 passed em ~48 s**, sessão ociosa **73,81%** de um
núcleo e **269,9 MiB**. Etapa 2B: duas sessões prontas em **7,90 s** e
**6,85 s**; ~**270 MiB** e **63–65%** de um núcleo cada; Playwright 2B
**2 passed em 1,2 min**. Etapa 3: `make e2e` **3 passed em 2,2–2,3 min**; entrega
validada pelo monitor real. Piloto privado local: `make test-pilot` **5/5**,
`make pilot-acceptance` **OK** e `make pilot-e2e` **2 passed**.

Detalhes:

- [`docs/stage1-results.md`](docs/stage1-results.md)
- [`docs/stage2a-results.md`](docs/stage2a-results.md)
- [`docs/stage2b-results.md`](docs/stage2b-results.md)
- [`docs/stage3-results.md`](docs/stage3-results.md)
- [`docs/pilot-runbook.md`](docs/pilot-runbook.md)
- [`docs/pilot-results.md`](docs/pilot-results.md)

## Arquitetura

```text
Navegador do Windows
  http://localhost:8080
        │
        ▼
  apps/api (FastAPI, 127.0.0.1:8080)
    - serve o build React/Vite
    - cookie HttpOnly e progresso por sessão
    - GET /api/mission, POST /api/session/restart, touch e progress
    - convite do piloto, pausa/close e eventos JSONL sem terminal
    - proxy de terminal (com resume) e telemetria (com lifecycle)
        ├── HTTP interno + token ──► apps/runtime (Docker socket)
        │                              └── cria/recria/remove a sessão
        └── UDS /run/sessions/<id>/agent.sock
                                           │
                                           ▼
                             container de sessão (network none)
                               launchpad_agent (aiohttp em UDS)
                                 ├── ros2 launch
                                 ├── PTY bash + estado do prompt
                                 ├── rclpy /odom
                                 └── rclpy /launchpad/mission_status
```

Apenas `apps/runtime` recebe `/var/run/docker.sock`. A API não tem Docker. O
navegador não acessa runtime, UDS ou Docker. O container da sessão roda como
UID 1000, com `cap_drop: ALL`, `no-new-privileges`, 2 GiB, 2 CPUs, 256 PIDs,
sem rede externa e sem socket Docker. Ele monta somente o próprio diretório de
UDS em `/run/agent`. Cada sessão tem `ROS_DOMAIN_ID` e `GZ_PARTITION` próprios,
nome de container e labels exclusivos.

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
make down        # para tudo e remove as sessões
make session-down # força a remoção das sessões e reinicia API/runtime
make stage1      # aceite da Etapa 1
make stage2a     # aceite da Etapa 2A
make stage2b     # aceite da Etapa 2B local
make measure-2b  # medição de duas sessões
make stage3      # aceite da missão Primeiro Turno
make e2e         # Playwright completo (2A + missão)
make test-mission # conteúdo da missão
make test-api    # restart com falha e retry
make test-session-capacity # capacidade, progresso, TTL e reconciliação
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
content/missions/primeiro-turno.yaml        conteúdo da missão guiada
lab/ros_ws/src/launchpad_sim/               URDF, gerador, watchdog e monitor
lab/ros_ws/src/launchpad_bringup/           launch headless
lab/image/Dockerfile                        imagem do laboratório
lab/image/agent/                            agente da sessão (aiohttp/PTY/ROS)
apps/api/                                   FastAPI e proxy UDS
apps/runtime/                               controlador do Docker
apps/web/                                   React + TypeScript + Vite
apps/web/src/components/MissionPanel.tsx    painel dos quatro desafios
compose.pilot.yaml                          convite, estado e hardening
specs/001-primeiro-turno/                   spec, plan e tasks
tests/integration/                          aceite real
tests/e2e/                                  Playwright
deploy/                                     Caddy, env e systemd do piloto
scripts/                                    admin, preflight e verify do piloto
docs/                                       resultados medidos
```

## Falhas comuns

**“As duas vagas estão em uso”**

A entrega permite duas sessões simultâneas. Encerre uma sessão em outro
navegador ou aguarde a inatividade/TTL; para forçar, use `make session-down`.

**Sessão presa após fechar o navegador**

```bash
make session-down
```

Isso remove todas as sessões e reinicia API/runtime. Sem o comando, a vaga é
liberada pela inatividade de 10 min ou pelo TTL de 30 min.

**A entrega não conclui**

A entrega só conta com `delivered=true`: o robô precisa ficar parado dentro da
zona por 2 s. Passar pela zona em movimento não conclui. O painel mostra se
está fora, em movimento na zona ou parado.

**O botão “Inserir no terminal” está desabilitado**

Ele só libera quando o shell está no prompt com a linha vazia. Se houver texto
digitado ou um `ros2 topic echo` em execução, use **Copiar** ou Ctrl+C; não há
Ctrl+U automático.

**O reinício falhou**

A interface mostra a falha e permite nova tentativa. Se o ambiente ficar preso,
use `make session-down` ou `make down`.

**Recarregar perdeu o progresso**

O progresso é guardado na API por sessão. Verifique se a sessão ainda está
`ready`; depois de expirar ou reiniciar o container, o progresso começa do
primeiro desafio.

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
docker ps -a --filter label=launchpad.role=session
docker logs <nome-do-container-ros2-launchpad-session-id>
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

- Duas sessões simultâneas; o terceiro navegador recebe “Laboratório cheio”.
- A reconexão de terminal/telemetria e a expiração por inatividade/TTL fazem
  parte da 2B local.
- Sem publicação pública, TLS real, cadastro, LiDAR, SLAM, Nav2 ou visor 3D.
- O piloto privado tem convite e templates de host; o aceite em domínio público
  depende de DNS, TLS e rootless reais.
- O progresso da missão sobrevive a recarregar, mas reinicia no reinício da
  missão e ao reiniciar API/runtime.
- A solução completa é opcional e calibrada para a pose após o desafio 3.
- O perfil local não é um piloto público. O isolamento para shells anônimos
  exige validação adicional (rootless/VM, seccomp/AppArmor, auditoria).
- O teste Playwright usa `--network host` no WSL; isso é artefato de teste.

Consulte [`specs/001-primeiro-turno/spec.md`](specs/001-primeiro-turno/spec.md),
[`plan.md`](specs/001-primeiro-turno/plan.md) e
[`tasks.md`](specs/001-primeiro-turno/tasks.md).
