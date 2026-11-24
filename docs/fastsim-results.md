# Simulador leve (`fastsim`) — resultados

Medições feitas em um servidor de 4 núcleos e 7,1 GiB de RAM, sem GPU, com o
Docker local. Os números são deste host; em outro hardware, repita
`make load-test`.

## O que mudou

`SIM_BACKEND=fast` troca `gz sim`, `ros_gz_bridge`, `create` e `odom_merge` por
um único processo (`fastsim`) que hospeda três nós ROS 2: `fastsim` (cinemática,
colisão, LiDAR, `/odom`, `/scan`, `/clock`), `cmd_vel_watchdog` e
`mission_monitor`. Os tópicos, tipos e `frame_id` visíveis ao aluno são os
mesmos; `ros2 node list` mostra `/fastsim`, `/cmd_vel_watchdog`,
`/mission_monitor`, `/launchpad_session_agent` e `/robot_state_publisher`.
O Gazebo continua sendo o padrão (`SIM_BACKEND=gazebo`).

Otimizações aplicadas a partir do perfil de CPU:

1. `/odom` a 20 Hz, `/scan` a 10 Hz e `/clock` a 5 Hz, em um único timer.
2. Watchdog e monitor no mesmo processo, trocando mensagens por chamadas
   diretas (sem passar pelo DDS).
3. Nós sem serviços de parâmetros e sem `rosout`: o executor do rclpy
   reconstrói a lista de entidades a cada despertar, e esse custo dominava
   (~27% de CPU para ~70 despertares por segundo).
4. O agente da sessão assina `/odom`, `/scan` e `/launchpad/mission_status` em
   modo bruto e só decodifica o que um navegador conectado pede
   (`launchpad_agent/cdr.py`, testado por `make test-agent-cdr`).

## Consumo por sessão ociosa (com telemetria e terminal conectados)

| Versão | CPU por sessão | RAM por sessão |
|---|---:|---:|
| Gazebo | ~190% | ~490 MiB |
| `fastsim`, primeira versão | 48% | 179 MiB |
| + agente bruto e processo único | 39% | 114 MiB |
| + timer único e nós leves | 22% | 112 MiB |

Ganho sobre o Gazebo: cerca de 9 vezes em CPU e 4 vezes em RAM.

## Fidelidade

Os mesmos seis cenários de comando (`dynamics_probe.py`) foram executados nos
dois backends. O Gazebo registrado em `tests/fixtures/gazebo_dynamics.json`
andou 8–39% menos que o modelo ideal, porque o fator de tempo real dele ficou
entre 0,7 e 0,9 com a CPU saturada; o `fastsim` anda no tempo real. O curso
completo (23 desafios, `stage3.spec.ts`) passa nos dois backends.

## Carga (`make load-test`)

Cada sessão simulada abre sessão, terminal e telemetria como o navegador, e no
perfil ativo executa `ros2 topic list`, `ros2 topic echo --once /odom`,
`ros2 topic pub --times 30 /cmd_vel ...` e `ros2 topic echo /scan` por 4 s.

| Sessões | Perfil | CPU média do host | Pico | Carga (load1) | RAM do host | `topic list` p50 / p95 |
|---:|---|---:|---:|---:|---:|---|
| 4 | ocioso | 32% | 43% | 2,6 | 2,0 GiB | — |
| 8 | ativo, comando a cada ~6 s | 49% | 78% | 5,3 | 3,0 GiB | 0,8 s / 2,2 s |
| 16 | ativo, comando a cada ~6 s | 82% | 100% | 12,6 | 4,1 GiB | 2,1 s / 5,4 s |
| 24 | ativo, comando a cada ~20 s | 86% | 100% | 24,6 | 5,0 GiB | 4,9 s / 14 s |

Com 16 e 24 sessões o host satura: o `echo_once` passa de 11 s no p95 e há
comandos que estouram 60 s. A RAM não limita (~130–150 MiB por sessão).

## Limite de sessões com folga

O custo é de cerca de 0,2 núcleo por sessão (ociosa, com telemetria) mais
rajadas de ~0,4 s de CPU por comando `ros2` do aluno. Mantendo a CPU média
abaixo de ~65% para absorver as rajadas:

| Critério | Sessões simultâneas |
|---|---:|
| Recomendado (CPU média ≤ 65%, `topic list` p95 ≤ 3 s) | **12** |
| Teto com latência degradada | 16 |
| Teto só com sessões ociosas | ~20 |
| Gazebo, mesmo servidor | 2 |

Use `MAX_SESSIONS=12` com `SIM_BACKEND=fast` neste servidor. O limite escala
com os núcleos: cerca de 3 sessões recomendadas por núcleo.

## Outros limites encontrados

- A criação de sessões é serializada no runtime (~1,8 s cada); uma rajada de
  12 entradas simultâneas faz a última esperar ~22 s. O timeout do cliente da
  API agora cresce com `MAX_SESSIONS` (antes, a 9ª criação simultânea recebia
  503).
- O runtime aloca `ROS_DOMAIN_ID` de 42 a 101, no máximo 60 sessões por host.
- Cada `ros2` CLI do aluno sobe um processo Python com DDS; é o custo que o
  simulador não elimina.

## Pendências

- Medir em um host de produção; os valores acima são deste servidor.
- Estreitar o lock do runtime para criar sessões em paralelo.
- A calibração dos desafios de pose e scan continua baseada no Gazebo; o
  `fastsim` é ideal (tempo real, sem ruído) e fica dentro das tolerâncias do
  curso, mas não reproduz derrapagem nem empurrar caixas.
