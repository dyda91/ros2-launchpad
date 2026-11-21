# Resultados da Etapa 2A

> Resultados históricos desta etapa. A Etapa 3 posterior adicionou a missão
guiada, o painel de desafios e o reinício; consulte `docs/stage3-results.md`.

Data: 2026-11-21 (horário local da sessão de desenvolvimento).

## Escopo validado

Sessão local única, aberta pelo navegador em `http://localhost:8080`, com:

- React + TypeScript + Vite servidos pela FastAPI;
- xterm.js conectado a um PTY real no container da sessão;
- Canvas 2D alimentado pelo `map.json` gerado para o simulador;
- telemetria real de `/odom`;
- comando ROS 2 digitado no terminal alterando a pose real;
- Ctrl+C devolvendo o prompt;
- encerramento que remove o container e permite iniciar outra sessão na pose
  inicial.

O navegador usado no teste automatizado foi o Chromium headless do Playwright
em WSL. O acesso por `localhost` a partir do Windows foi verificado com
`Invoke-WebRequest`, retornando `{"api":"ok","runtime":true,"session":"idle"}`.

## Ambiente

O hardware e as versões são os mesmos da Etapa 1:

- Windows 11, WSL 2.7.3, Ubuntu 26.04 no host;
- imagem do laboratório Ubuntu 24.04.5, ROS 2 Jazzy, Gazebo Sim 8.15.0;
- Docker 29.1.3, Compose 5.2.0, cgroup v2;
- imagem do lab: 3,45 GB;
- imagem da API: 264 MB;
- imagem do runtime: 250 MB;
- imagem do Playwright: 3,63 GB.

## Componentes

```text
Navegador em 127.0.0.1:8080
        │
        ▼
API FastAPI (porta interna 8000)
  - cookie HttpOnly
  - uma sessão por vez
  - proxy de terminal e telemetria
        │
        ├── HTTP interno com token ──► runtime (Docker socket)
        │                                  └── cria/remove a sessão
        │
        └── UDS /run/sessions/<id>/agent.sock
                                           │
                                           ▼
                              container de sessão (network none)
                                agent aiohttp em UDS
                                  ├── ros2 launch
                                  ├── PTY bash
                                  └── rclpy /odom
```

O runtime é o único componente com acesso ao socket do Docker. A API não tem
esse socket. O agente dentro do laboratório não tem rede externa, não tem
socket do Docker e só escuta na UDS.

## Resultados medidos

| Verificação | Resultado |
|---|---|
| `make stage1` após as mudanças | **OK** |
| `make stage2a` | **OK** |
| Teste de integração da sessão | **OK** |
| Playwright (terminal, Ctrl+C, movimento, Canvas, encerrar/reiniciar) | **1 passed em 47,8–50,0 s** |
| Sessão pronta após `POST /api/session` | **7,26 s** |
| Mapa servido | `armazem`, zona `coleta` |
| Tópicos no shell da sessão | `/cmd_vel` e `/odom` |
| Tipos ROS | `geometry_msgs/msg/Twist`, `nav_msgs/msg/Odometry` |
| Container da sessão | `network none`, 2 GiB, 2 CPUs, 256 PIDs |
| Socket Docker dentro da sessão | ausente |
| Interfaces da sessão | somente `lo` |
| CPU/RAM da sessão ociosa | **73,81%** de um núcleo, **269,9 MiB** |
| CPU/RAM da API | 14,97%, 43,12 MiB |
| CPU/RAM do runtime | 15,14%, 45,22 MiB |
| Porta publicada | somente `127.0.0.1:8080` |
| Encerrar sessão | container e `run/sessions/<id>` removidos |
| Nova sessão | pose inicial ~`(0,0)`, mapa e terminal disponíveis |
| Segundo navegador sem cookie | `full` (verificado manualmente) |
| Acesso do Windows a `localhost` | HTTP 200 com saúde ok |
| Sessão após o teste | `idle`, sem container |

A CPU é relativa a um núcleo. A sessão ociosa inclui Gazebo, bridge, watchdog,
monitor, robot_state_publisher e o agente. O teste Playwright também confere
que o Canvas contém pixels desenhados, além de verificar a pose real exposta
pelo visor.

## Comandos executados

```bash
make stage1
make stage2a
```

O `make stage2a` executa, em ordem:

```bash
make stage1
docker compose stop lab
make up
bash tests/integration/stage2a_acceptance.sh
make e2e
```

Aceite manual no navegador:

```bash
make up
# abrir http://localhost:8080
```

Dentro do terminal do navegador:

```bash
ros2 topic list
ros2 topic echo /odom
# Ctrl+C
timeout 3 ros2 topic pub --rate 10 /cmd_vel \
  geometry_msgs/msg/Twist "{linear: {x: 0.2}}"
```

Encerrar a sessão pelo botão e iniciar outra; a nova sessão começa na pose
inicial.

Verificações auxiliares:

```bash
ss -ltn | grep 8080
docker inspect ros2-launchpad-session --format \
  '{{.HostConfig.NetworkMode}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}}'
docker exec -u 1000 ros2-launchpad-session bash -lc \
  'test ! -e /var/run/docker.sock; ip -brief addr'
```

## Observações

- O `make stage1` continua passando; o launch, o mundo, o robô, o mapa e o
  watchdog da Etapa 1 não foram alterados.
- O aviso KDL do link raiz com inércia permanece e não afeta o aceite.
- O serviço `lab` continua sendo o laboratório manual da Etapa 1; a sessão
  web usa um container efêmero criado pelo runtime a partir da mesma imagem.
- O container de sessão não monta `/tests`, `/content` nem o repositório; só a
  própria UDS.
- A sessão é única. Um segundo navegador recebe `full`.
- Sem reconexão automática, expiração por inatividade ou publicação pública
  nesta entrega.
- Se o navegador fechar sem encerrar, a sessão permanece até
  `make session-down` ou `make down`.
- O teste Playwright roda em container com `--network host` para alcançar
  `127.0.0.1:8080`; isso é um artefato de teste local, não faz parte da
  aplicação.
