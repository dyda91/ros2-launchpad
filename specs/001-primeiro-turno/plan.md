# Plano técnico — Primeiro Turno

## Status

- **Etapa 1:** implementada.
- **Etapa 2A:** implementada.
- **Etapa 2B local:** implementada; publicação pública pendente.
- **Etapa 3:** implementada.
- **Piloto privado local:** implementado; validação em host/domínio pendente.

## Estrutura do monorepo

```text
ros2-launchpad/
├── AGENTS.md
├── README.md
├── compose.yaml
├── compose.pilot.yaml
├── compose.pilot-staging.yaml
├── deploy/
│   ├── Caddyfile
│   ├── pilot.env.example
│   └── systemd/
├── scripts/
│   ├── pilot-admin.sh
│   ├── pilot-preflight.sh
│   └── pilot-verify.sh
├── .env.example
├── Makefile
├── content/
│   ├── world/armazem.yaml
│   └── missions/primeiro-turno.yaml
├── lab/
│   ├── image/Dockerfile
│   └── ros_ws/src/
│       ├── launchpad_sim/
│       │   ├── launchpad_sim/generate_world.py
│       │   ├── launchpad_sim/cmd_vel_watchdog.py
│       │   ├── launchpad_sim/mission_monitor.py
│       │   ├── config/bridge.yaml
│       │   ├── urdf/robot.urdf.xacro
│       │   └── worlds/                # SDF gerado, não versionado
│       └── launchpad_bringup/
│           └── launch/lab.launch.py
├── apps/
│   ├── api/                    # FastAPI, sessão, proxy UDS, build do web
│   ├── runtime/                # Docker socket, criação/remoção da sessão
│   └── web/                    # React + TypeScript + Vite + xterm + Canvas
├── lab/image/agent/            # agente aiohttp, PTY, launch e /odom
├── specs/001-primeiro-turno/
├── tests/integration/
│   ├── test_world_geometry.py
│   ├── odom_probe.py
│   ├── route_probe.py
│   ├── stage1_acceptance.sh
│   ├── stage2a_acceptance.sh
│   ├── test_mission_content.py
│   ├── test_session_capacity.py
│   ├── test_session_restart_failure.py
│   ├── stage2b_acceptance.sh
│   └── stage2b_measure.sh
├── tests/e2e/                  # Playwright 2A, 2B e 3
├── docs/stage1-results.md
├── docs/stage2a-results.md
├── docs/stage2b-results.md
├── docs/stage3-results.md
├── docs/pilot-runbook.md
└── docs/pilot-results.md
```

A Etapa 2A adicionou `apps/api`, `apps/runtime`, `apps/web`,
`lab/image/agent` e `tests/e2e`. A Etapa 2B adicionou capacidade para duas
sessões, UDS e containers por ID, progresso no servidor, reconexão por offset,
TTL/inatividade e reconciliação. A Etapa 3 adicionou
`content/missions/primeiro-turno.yaml`, a missão guiada, o painel de desafios
e a inserção segura de comandos.

## Arquitetura da Etapa 1

```text
content/world/armazem.yaml
        │
        ├── generate_world.py ──► worlds/armazem.sdf
        │                    └──► config/map.json
        │
        └── mission_monitor ─────► /launchpad/mission_status

/opt/ros/jazzy + Gazebo Harmonic (container lab, sem GUI)
        │
launchpad_bringup/lab.launch.py
        ├── gz sim -r -s worlds/armazem.sdf
        ├── robot_state_publisher
        ├── ros_gz_sim create (um único launchpad_robot)
        ├── ros_gz_bridge
        ├── cmd_vel_watchdog
        └── mission_monitor
```

### Fluxo de controle

1. O aluno publica em `/cmd_vel` (`geometry_msgs/msg/Twist`).
2. `cmd_vel_watchdog` limita as velocidades e republica em
   `/launchpad/_cmd_vel_safe`.
3. O bridge leva o tópico seguro ao Gazebo (`/cmd_vel`).
4. O plugin `gz-sim-diff-drive-system` move as rodas e publica `/odom`.
5. O bridge leva `/odom` ao ROS 2.
6. `mission_monitor` lê `/odom`, aplica a zona do `map.json` e publica o
   status JSON em `/launchpad/mission_status`.

O watchdog publica zero a 20 Hz após 0,5 s sem comandos. Isso garante que o
robô pare mesmo que o aluno feche o terminal ou interrompa o `ros2 topic pub`.

## Robô

O robô é um diferencial simples, definido em `robot.urdf.xacro`:

| Item | Valor |
|---|---|
| Chassi | caixa 0,46 × 0,34 × 0,12 m, 6,0 kg |
| Rodas | cilindros raio 0,09 m, largura 0,035 m, 0,4 kg cada |
| Distância entre rodas | 0,38 m |
| Apoio passivo | esfera raio 0,03 m, 0,05 kg, atrito baixo |
| Altura do chassi | centro em 0,15 m; rodas tocam o piso |
| Atuadores | juntas contínuas `left_wheel_joint` e `right_wheel_joint` |
| Plugin | `gz::sim::systems::DiffDrive` |
| Limites | 0,5 m/s linear e 1,2 rad/s angular no Gazebo; 0,35 m/s e 0,9 rad/s no watchdog |

As inércias do chassi, das rodas e do caster são calculadas a partir das
primitivas e estão declaradas no URDF. O caster tem `mu1=mu2=0.01` para
deslizar como apoio passivo. As rodas têm atrito 1,0.

## Armazém

A fonte única é `content/world/armazem.yaml`:

- Piso de 8,0 × 6,0 m, paredes de 1,5 m de altura e 0,08 m de espessura.
- Robô em `(0,0)` com `yaw=0`; o referencial `odom` coincide com o mundo.
- Zona de coleta `coleta` em `(5,8, 3,2)`, 1,4 × 1,4 m.
- Três obstáculos: caixa, coluna cilíndrica e caixa lateral.
- Rota de referência: `(3,2, 0) → (3,2, 3,6) → (5,8, 3,6)`, com curvas à
  esquerda e à direita e folga mínima de 0,28 m.

O gerador valida limites, sobreposição com a zona e folga do spawn. O teste
`test_world_geometry.py` também percorre a rota em passos de 5 cm e confirma
a folga em relação aos obstáculos. Nenhum recurso remoto/Fuel é usado.

O SDF e o `map.json` são gerados no build da imagem e não são versionados.
A geração é determinística; o teste compara duas execuções byte a byte.

## Interfaces ROS 2

| Tópico | Tipo | Direção | Papel |
|---|---|---|---|
| `/cmd_vel` | `geometry_msgs/msg/Twist` | entrada | comando do aluno |
| `/launchpad/_cmd_vel_safe` | `geometry_msgs/msg/Twist` | interno | saída do watchdog |
| `/odom` | `nav_msgs/msg/Odometry` | saída | pose e velocidade reais |
| `/clock` | `rosgraph_msgs/msg/Clock` | saída | tempo do Gazebo |
| `/launchpad/mission_status` | `std_msgs/msg/String` | saída | status JSON da missão |

O bridge está em `config/bridge.yaml`. A missão expõe somente `/cmd_vel` e
`/odom` ao aluno; o tópico seguro é um detalhe interno documentado.

### Status da missão

```json
{
  "zone_id": "coleta",
  "in_zone": true,
  "speed_mps": 0.0,
  "angular_speed_rps": 0.0,
  "stopped_for_s": 2.0,
  "delivered": true,
  "pose": {"x": 5.706, "y": 3.5992}
}
```

A validação exige centro do robô dentro da zona com margem de 0,05 m,
`|v| ≤ 0,02 m/s`, `|ω| ≤ 0,05 rad/s` por 2,0 s contínuos. A margem e o tempo
são parâmetros do nó.

## Referenciais

- `odom` é o referencial canônico da missão e do mundo.
- O spawn é `(0,0,0)`; não há offset entre Gazebo e `/odom` na primeira
  missão.
- O Canvas da Etapa 2 aplicará escala e inversão do eixo Y da tela, sem
  alterar os dados de pose.
- O visor e a validação consomem o mesmo `map.json`.

## Configuração da imagem

- Base fixada por digest: `ros:jazzy-ros-base@sha256:3f3a...`.
- Ubuntu 24.04.5; ROS 2 Jazzy; Gazebo Sim 8.15.0 via vendor packages.
- Pacotes principais fixados: `ros-jazzy-ros-gz-sim` 1.0.25,
  `ros-jazzy-ros-gz-bridge` 1.0.25, `ros-jazzy-gz-sim-vendor` 0.0.13,
  `ros-jazzy-rmw-cyclonedds-cpp` 2.2.4, `ros-jazzy-robot-state-publisher`
  3.3.4, `ros-jazzy-xacro` 2.1.1.
- `RMW_IMPLEMENTATION=rmw_cyclonedds_cpp`; descoberta limitada a
  `LOCALHOST`; `GZ_IP=127.0.0.1`; `network_mode: none`.
- Build em duas etapas lógicas: instalação de pacotes e build do workspace
  com `colcon` dentro da imagem.
- Imagens observadas: lab 3,45 GB; API 264 MB; runtime 250 MB;
  Playwright 3,63 GB.

## Isolamento da Etapa 1

O container `lab`:

- roda como UID 1000;
- usa `network_mode: none` e só loopback;
- tem `cap_drop: ALL` e `no-new-privileges`;
- tem 2 GiB, 2 CPUs e 256 PIDs;
- não monta o socket do Docker;
- monta apenas `tests/` e `content/` em somente leitura.

A Etapa 2A passou a usar um container efêmero por sessão, UDS e agente
interno, mantendo o serviço `lab` apenas para a Etapa 1. O runtime é o único
componente com socket do Docker. O perfil local não é apresentado como pronto
para um piloto público: para shells anônimos, Docker sozinho não é uma
fronteira forte contra código arbitrário.


## Etapa 2A — sessão local implementada

```text
Navegador (Windows) ── HTTP/WS ──► 127.0.0.1:8080
                                      │
                                      ▼
                                   apps/api (FastAPI)
                                      ├── cookie e progresso por sessão
                                      ├── serve o build React/Vite
                                      ├── HTTP interno + token ──► apps/runtime
                                      └── UDS /run/sessions/<id>/agent.sock
                                                                  │
                                                                  ▼
                                                    container de sessão
                                                    network none, UID 1000
                                                    launchpad_agent (aiohttp)
                                                      ├── ros2 launch
                                                      ├── PTY bash
                                                      └── rclpy /odom
```

### Componentes e acesso

| Componente | Docker socket | Runtime HTTP | UDS | Rede externa |
|---|---:|---:|---:|---:|
| `apps/web` | não | não | não | via navegador/API |
| `apps/api` | **não** | sim, com token | sim, com token | rede interna |
| `apps/runtime` | **sim** | — | não | rede interna |
| `launchpad_agent` | **não** | não | sim | **não** |

O serviço `lab` da Etapa 1 continua sendo manual. A sessão 2A é um container
efêmero criado pelo runtime a partir da mesma imagem; não é o container `lab`.

### Inicialização, readiness e encerramento

- O navegador chama `POST /api/session`; a API cria cookie e chama o runtime.
- O runtime cria `ros2-launchpad-session` com `network none`, UID 1000,
  `cap_drop: ALL`, `no-new-privileges`, 2 GiB, 2 CPUs, 256 PIDs, apenas a UDS
  montada e um token de agente.
- O agente inicia `ros2 launch launchpad_bringup lab.launch.py`, assina
  `/odom` com `rclpy` e só reporta `ready` após a primeira odometria válida.
- A API faz polling do agente a cada 0,5 s, com timeout de 45 s; o navegador
  mostra “Preparando” e depois “Pronto”.
- O terminal só abre quando o estado é `ready`; o PTY é criado sob demanda.
- `DELETE /api/session` remove o container e a UDS; o runtime espera o
  container terminar. Uma nova sessão cria outro container e volta à pose
  inicial.
- Se o navegador fechar sem encerrar, a sessão permanece até a inatividade
  de 10 min ou o TTL de 30 min; `make session-down` e `make down` continuam
  disponíveis.

### Contratos da Etapa 2A

```text
POST   /api/session       202 preparing | 409 full | 503 error
GET    /api/session       idle | preparing | ready | full | error | expired
POST   /api/session/touch 204 | 409
PUT    /api/session/progress 204 | 400 | 409
DELETE /api/session       204
GET    /api/map           map.json (409 antes de ready)
GET    /api/health        api, runtime, ativas e limite
WS     /ws/terminal       JSON input/output/resize, autenticado por cookie
WS     /ws/telemetry      state/pose a 10 Hz, autenticado por cookie
```

```text
POST   /v1/sessions       {session_id, agent_token} -> {uds_path,...}
DELETE /v1/sessions/{id}
GET    /v1/capacity
GET    /v1/sessions
GET    /v1/sessions/{id}
POST   /v1/reconcile
Authorization: Bearer RUNTIME_TOKEN
```

O agente expõe `GET /state`, `GET /map`, `WS /terminal` e `WS /telemetry` em
`/run/agent/agent.sock`, exigindo `X-Agent-Token`. A UDS é o único canal de
dados do container com `network none`.

### Resultados

- Sessão pronta em 7,26 s após o `POST`.
- Playwright 1 passed em 47,8–50,0 s, incluindo Ctrl+C, movimento, Canvas e
  encerrar/reiniciar.
- Sessão ociosa: 73,81% de um núcleo e 269,9 MiB; API 43,12 MiB; runtime
  45,22 MiB.
- Apenas `127.0.0.1:8080` publicado; a partir do Windows,
  `http://localhost:8080/api/health` respondeu com saúde ok.
- `make stage1` continua passando.


## Etapa 2B — sessões simultâneas implementada

### Arquitetura

```text
Navegador A ── cookie A ──┐
Navegador B ── cookie B ──┤
                          ▼
                      apps/api
               ├── lock de capacidade (2)
               ├── progresso por sessão
               ├── TTL/inatividade/aviso
               └── UDS /run/sessions/<id>/agent.sock
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
container ros2-launchpad-session-<A>  container <B>
UDS, agente, ROS domain e GZ próprios UDS, agente, ROS domain e GZ próprios
```

- A API reserva a vaga sob `asyncio.Lock` antes de chamar o runtime; o runtime
  repete a checagem. IDs, tokens, UDS, nomes e labels são exclusivos.
- Cada container recebe `ROS_DOMAIN_ID` e `GZ_PARTITION` próprios. A sessão
  continua em `network none`, UID 1000, sem Docker e com os limites da 2A.
- O progresso é validado e mantido na API por sessão; o painel o envia em
  cada mudança relevante e o restaura no carregamento.
- O terminal usa buffer circular de 128 KiB e offsets. A reconexão envia
  `since`; o agente responde `stream_start` + trecho faltante, ou `reset` +
  últimos 128 KiB. A telemetria reconecta e publica eventos de ciclo de vida.
- `_maintenance` expira inatividade/TTL, checa a saúde do agente, remove
  containers e libera vagas. API/runtime reconciliam órfãos na inicialização.
- Reiniciar mantém tag e vaga, mas recria container, token, pose e progresso.

### Contratos

```text
MAX_SESSIONS=2
SESSION_TTL_SECONDS=1800
SESSION_IDLE_SECONDS=600
SESSION_WARNING_SECONDS=120
SESSION_MONITOR_SECONDS=2
SESSION_ROS_DOMAIN_ID=42

POST   /api/session/touch
PUT    /api/session/progress
WS     /ws/terminal?since=<bytes>
WS     /ws/telemetry   pose, mission e lifecycle
POST   /v1/reconcile
GET    /v1/sessions
```

### Resultados

- Integração: duas sessões, terceiro `full`, progresso isolado, aviso,
  expiração, nova sessão, reinício e limpeza — OK.
- Playwright 2B: 2 passed em 1,2 min.
- Duas sessões prontas em 7,90 s e 6,85 s; ~270 MiB e 63–65% de um núcleo
  cada, ociosas.
- `make e2e` continua 3 passed em 2,3 min; `make stage1` OK em 6,79 s.
- `make test-session-capacity` 8/8 e `test_session_restart_failure` 2/2.

## Piloto privado implementado localmente

### Arquitetura

```text
Navegador ── HTTPS ──► Caddy (host)
                         │ 127.0.0.1:8080
                         ▼
                     API (convite/controle)
                         │ UDS + HTTP interno
                         ▼
                     runtime ── Docker rootless
                         │
                         ▼
                     sessão (network none)
```

- O convite é resgatado por formulário e vira cookie opaco; o código não
  aparece na URL nem nos logs.
- O estado fica em `run/pilot` (produção `/var/lib/launchpad/pilot`) com
  permissões restritas.
- `compose.pilot.yaml` ativa convite, `run/pilot`, `COOKIE_SECURE` e
  `SESSION_READ_ONLY`; o Caddy é do host.
- O runtime aceita `read_only`, tmpfs limitados, `ulimits` e AppArmor
  configurável via `SESSION_*`.
- Eventos JSONL são derivados do progresso; não incluem terminal.

### Contratos

```text
GET  /api/pilot/status
POST /api/pilot/redeem
GET  /api/session  inclui pilot_state
POST /api/session  exige convite se não houver sessão
```

```text
pilot-admin invite/list/revoke/pause/resume/close/events
make pilot-up|pilot-down|pilot-admin|pilot-verify|pilot-acceptance
```

### Resultados locais

- `make test-pilot`: 5/5.
- `make pilot-acceptance`: OK.
- `make pilot-e2e`: 2 passed.
- Sessão read-only: Gazebo e `/odom` prontos; container sem rede/capabilities.
- Caddyfile validado.
- Host público: pendente de DNS, TLS e rootless reais.

## Etapa 3 — Primeiro Turno implementada

### Fluxo

```text
content/missions/primeiro-turno.yaml
        │
        ▼
GET /api/mission ──► MissionPanel (conteúdo genérico, 4 desafios)
        │
        ├── Quiz e previsão: respostas curtas no painel
        ├── Movimento: pose de referência + deslocamento + parada
        └── Entrega: delivered do mission_monitor
                              ▲
                              │
/odom + /launchpad/mission_status ──► launchpad_agent ──► WS telemetry
```

### Desafios e conclusão

1. Tópicos: `ros2 topic list` e pergunta curta sobre `/cmd_vel` e `/odom`.
2. Odometria: amostra de `/odom`; x/y relativos à origem de `odom`; neste
   cenário a origem foi alinhada à origem do mapa; yaw explicado como cálculo
   do quaternion.
3. Movimento: previsão correta, comando de 0,2 m/s por 3 s, pose de referência
   capturada com prompt vazio, deslocamento novo ≥ 0,15 m e parada ≤ 0,02 m/s.
4. Entrega: comandos ajustáveis, solução opcional calibrada a partir de
   x≈0,44, y≈0, z≈0, conclusão somente por `delivered` após 2 s parado.

### Inserção segura

O agente usa um marcador de prompt no bash e acompanha entrada/saída do PTY.
O terminal reporta `prompt`, `lineEmpty` e `running`. A UI mostra prévia e
**Copiar** sempre; **Inserir no terminal** só é habilitado quando o shell está
no prompt vazio. Não há Ctrl+U automático; o texto é enviado sem Enter e o
aluno pressiona Enter. Texto já digitado e comandos contínuos bloqueiam a
inserção.

### Layout

- Desktop largo (> 1500 px): missão, visor e terminal em três colunas.
- Largura intermediária: desafio acima de visor + terminal.
- Telas estreitas: empilhamento.
- O Playwright verifica os três arranjos por bounding boxes.

### Reinício e falhas

- `POST /api/session/restart` remove e recria o container/UDS; o progresso é
  reiniciado e a nova sessão começa na pose inicial, mantendo a tag e a vaga.
- A UI ignora telemetria da geração antiga, desabilita o botão durante a
  operação e descarta estado do painel.
- Se a criação falhar, a API retorna erro; a UI mostra falha e permite nova
  tentativa (`test_session_restart_failure.py` + Playwright com 503).
- O progresso é persistido na API por sessão desde a Etapa 2B; recarregar
  restaura o painel, enquanto reiniciar zera o progresso.

### Conteúdo e solução

O conteúdo fica em `content/missions/primeiro-turno.yaml`. A solução completa
opcional usa três comandos de uma linha, calibrados no simulador real:

```bash
timeout 16.5 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.35}}"
timeout 2.85 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{angular: {z: 0.8}}"
timeout 10.0 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.35}}"
```

O Playwright passa pela zona em movimento, interrompe com Ctrl+C, confirma a
parada de 2 s, a tela de sucesso, o gancho e o reinício com painel/pose
restaurados.

## Testes

- `make test-world`: geração determinística, limites, folga da rota, zona e
  ausência de recursos remotos.
- `odom_probe.py`: lê `/odom`, publica `/cmd_vel` por tempo limitado e verifica
  deslocamento e parada.
- `route_probe.py`: controla o robô por waypoints reais e verifica a entrega
  pelo status do monitor.
- `stage1_acceptance.sh`: reinicia o container, inicia o launch, valida
  tópicos/tipos, robô único, pose inicial, movimento, parada, CLI, entrega,
  limites e reinício limpo.
- `stage2a_acceptance.sh`: valida sessão, readiness, mapa, tópicos ROS,
  isolamento, encerramento e nova sessão na API real.
- `tests/e2e/stage2a.spec.ts`: Playwright real com terminal, Ctrl+C, movimento,
  Canvas, layout responsivo, encerramento e reinício.
- `tests/e2e/stage3.spec.ts`: quatro desafios, inserção segura, passagem em
  movimento, entrega, reinício e falha de restart.
- `test_mission_content.py`: schema, respostas, comandos e gancho.
- `test_session_restart_failure.py`: limpeza antiga + falha do novo container +
  retry.
- `test_session_capacity.py`: duas vagas, reserva atômica, progresso isolado,
  TTL, inatividade, aviso e reconciliação.
- `stage2b_acceptance.sh`: API real com duas sessões, terceiro `full`,
  progresso, expiração, reinício e limpeza.
- `tests/e2e/stage2b.spec.ts`: dois contextos, terceiro `full`, reload,
  reconexão de terminal e expiração.
- `stage2b_measure.sh`: tempo de prontidão, containers, memória e CPU.
- `test_pilot_store.py`: convite, hash, consumo, controle, rate limit e eventos.
- `stage_pilot_acceptance.sh`: fluxo HTTP local do piloto.
- `tests/e2e/pilot.spec.ts`: entrada por convite e sessão válida.
- `tests/e2e/host-pilot.spec.ts`: três contextos, convite inválido/usado/
  revogado, terceira sessão `full`, retry após liberar vaga, `wss` e reconexão.
- `make staging-expiry`: projeto `ros2-launchpad-staging`, porta 18080,
  `run/staging`, labels `launchpad.project=staging` e TTL curto.
- `tests/integration/stage_staging_expiry.sh`: expiração curta no staging
  isolado por `launchpad.project=staging`.
- O aceite usa o simulador real, não telemetria simulada.

## Pendências de publicação

- Publicação pública com TLS, autenticação de visitantes e proteção contra
  abuso.
- Validação de isolamento de shells anônimos com rootless/VM, seccomp,
  AppArmor e auditoria.

## Riscos e decisões pendentes

- O piloto privado ainda depende de um host Ubuntu 24.04 com rootless, Caddy e
  DNS. A validação local não substitui o aceite no host.

- A memória do WSL é 7,7 GiB; duas sessões foram medidas em ~270 MiB cada.
  Elevar o limite exige nova medição e autorização para alterar `.wslconfig`.
- O startup final das Etapas 1/2A ficou em 6,25–6,28 s; a missão 3 usa a mesma
  sessão.
- O aviso KDL do link raiz com inércia é conhecido e não afeta a simulação.
- Cada sessão ociosa usa ~0,63–0,65 núcleo e ~270 MiB. Duas sessões
  simultâneas ficaram estáveis no WSL.
