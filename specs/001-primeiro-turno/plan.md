# Plano técnico — Primeiro Turno

## Status

- **Etapa 1:** implementada.
- **Etapa 2:** planejada.
- **Etapa 3:** planejada.

## Estrutura do monorepo

```text
ros2-launchpad/
├── AGENTS.md
├── README.md
├── compose.yaml
├── .env.example
├── Makefile
├── content/world/armazem.yaml
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
├── specs/001-primeiro-turno/
├── tests/integration/
│   ├── test_world_geometry.py
│   ├── odom_probe.py
│   ├── route_probe.py
│   └── stage1_acceptance.sh
└── docs/stage1-results.md
```

Etapas futuras adicionarão `apps/api`, `apps/runtime`, `apps/web`,
`content/missions` e `tests/e2e`, conforme a especificação.

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
- Imagem observada: 3,45 GB.

## Isolamento da Etapa 1

O container `lab`:

- roda como UID 1000;
- usa `network_mode: none` e só loopback;
- tem `cap_drop: ALL` e `no-new-privileges`;
- tem 2 GiB, 2 CPUs e 256 PIDs;
- não monta o socket do Docker;
- monta apenas `tests/` e `content/` em somente leitura.

A Etapa 2 mudará para um container por sessão, UDS e agente interno. O
runtime será o único componente com socket do Docker. O perfil local não será
apresentado como pronto para um piloto público: para shells anônimos, Docker
sozinho não é uma fronteira forte contra código arbitrário.

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
- O aceite usa o simulador real, não telemetria simulada.

## Contratos futuros (Etapas 2 e 3)

- API FastAPI: `POST/GET/DELETE /api/session`, `POST /api/session/restart`,
  `GET /api/mission`, `WS /ws/terminal`, `WS /ws/telemetry`.
- Runtime restrito: criação, remoção, reset, saúde e capacidade de containers.
- Agente da sessão: PTY em UDS, telemetria de `/odom`, reset e status.
- Frontend React + TypeScript + Vite, xterm.js e Canvas 2D.
- Cookie `HttpOnly`, `SameSite=Lax`, validação de `Origin` e segredo de sessão
  no servidor.
- TTL 30 min, inatividade 10 min, `MAX_SESSIONS` configurável (padrão 2).

## Riscos e decisões pendentes

- A memória do WSL é 7,7 GiB; a Etapa 2 deve medir uma e duas sessões antes de
  elevar o limite. Alterar `.wslconfig` exige autorização.
- O tempo de inicialização de 5,85–6,61 s é aceitável para o perfil local; o alvo
  de UX da Etapa 2 será medido com o agente e a web.
- O aviso KDL do link raiz com inércia é conhecido e não afeta a simulação.
- O uso de CPU ocioso é ~0,67 núcleo; a Etapa 2 deve medir duas sessões e
  ajustar o passo de física se necessário.
