# Resultados da Etapa 1

Data: 2026-11-20 (horário local da sessão de desenvolvimento).

## Ambiente

| Item | Valor |
|---|---|
| Windows | Windows 11 Home 10.0.26100.9711 |
| WSL | 2.7.3.0, modo NAT |
| Distribuição WSL | Ubuntu 26.04 LTS, kernel 6.6.114.1, x86_64 |
| Host | Intel Xeon E5-2666 v3, 20 vCPUs, 15,8 GB de RAM |
| WSL | 7,7 GiB de RAM, 2 GiB de swap |
| Disco | 1 TB, ~938 GB livres no início |
| Docker | 29.1.3; Compose 5.2.0; cgroup v2/systemd |
| Imagem | Ubuntu 24.04.5, ROS 2 Jazzy, Gazebo Sim 8.15.0 |
| Imagem do lab | 3,45 GB |

O repositório está no filesystem Linux (`/home/pc/ros2-launchpad`, ext4), não
em `/mnt/c`.

## Dependências resolvidas

| Pacote | Versão |
|---|---|
| `ros-jazzy-ros-gz-sim` | 1.0.25-1noble.20261105.125630 |
| `ros-jazzy-ros-gz-bridge` | 1.0.25-1noble.20261105.093704 |
| `ros-jazzy-gz-sim-vendor` | 0.0.13-1noble.20261031.125555 |
| `ros-jazzy-rmw-cyclonedds-cpp` | 2.2.4-1noble.20261105.063358 |
| `ros-jazzy-robot-state-publisher` | 3.3.4-1noble.20261105.103958 |
| `ros-jazzy-xacro` | 2.1.1-1noble.20261025.230251 |
| `ros-jazzy-teleop-twist-keyboard` | 2.4.1-1noble.20261105.090256 |
| Gazebo Sim | 8.15.0 |

## Limites do container

```text
Memory=2147483648 (2 GiB)
NanoCpus=2000000000 (2 CPUs)
PidsLimit=256
NetworkMode=none
CapDrop=["ALL"]
SecurityOpt=["no-new-privileges:true"]
```

O container roda como UID 1000 e monta apenas `tests/` e `content/` em somente leitura.

## Resultados medidos

| Métrica | Resultado |
|---|---|
| Startup até a primeira mensagem de `/odom` | **5,85–6,61 s** em três execuções |
| CPU ocioso (amostras após a entrega) | **66,76–70,19%** de um núcleo |
| RAM ocioso | **258,6 MiB** |
| CPU durante movimento (5 amostras) | 124,66%, 70,86%, 72,93%, 90,29%, 68,63% |
| RAM durante movimento | 291,8 MiB no pico; 258,4 MiB ao final |
| Deslocamento com 0,2 m/s por 2 s | **0,490 m** |
| Latência de parada após o último comando | **0,400 s** |
| Comando CLI de 3 s | deslocamento 0,420–0,440 m; `vx=0,000000` ao final |
| Entrega na zona | pose final `(5,706, 3,599)`, 2,0 s parado, `delivered=true` |
| Reinício | pose inicial ~`(0,0,0)`; um único `launchpad_robot` |
| Testes de geometria | 6/6 OK |

A porcentagem de CPU do `docker stats` é relativa a um núcleo; 100% equivale
a um núcleo saturado. O valor ocioso inclui Gazebo, bridge, watchdog, monitor
e robot_state_publisher.

## Comandos executados

```bash
make build
make test-world
make stage1
```

O script de aceite executa, entre outras ações:

```bash
docker compose up -d --force-recreate lab
docker compose exec -d lab bash -lc \
  'source /opt/ros/jazzy/setup.bash; source /ros_ws/install/setup.bash; \
   ros2 launch launchpad_bringup lab.launch.py > /tmp/lab_launch.log 2>&1'
ros2 topic list
ros2 topic type /cmd_vel
ros2 topic type /odom
timeout 3 ros2 topic pub --rate 10 /cmd_vel \
  geometry_msgs/msg/Twist "{linear: {x: 0.2}}"
python3 /tests/integration/odom_probe.py --mode move --speed 0.2 --duration 2.0
python3 /tests/integration/route_probe.py
docker stats --no-stream
docker compose restart lab
```

## Evidências textuais

```text
$ make test-world
Ran 6 tests in 0.028s
OK

$ make stage1
startup_seconds=5.85 (execuções: 5.85–6.61)
cmd_vel=geometry_msgs/msg/Twist
odom=nav_msgs/msg/Odometry
robots=launchpad_robot
pose zero ok
parada observada em 0.400 s
cli movement ok: 0.420–0.440 m, final vx=0.000000
entrega validada por pose e velocidade reais
ros2-launchpad-lab cpu=66.76% mem=258.6MiB / 2GiB (12.62%)
Memory=2147483648 NanoCpus=2000000000 PidsLimit=256 NetworkMode=none
robots_after_restart=launchpad_robot
=== ACEITE ETAPA 1: OK ===
```

## Observações e pendências

- O log contém apenas o aviso conhecido do KDL sobre o link raiz `base_link`
  ter inércia. A pose e o controle não foram afetados.
- A simulação é headless (`gz sim -r -s`), sem `DISPLAY`, WSLg, X11, RViz ou
  GPU.
- Duas sessões simultâneas não foram medidas nesta etapa. A Etapa 2 deverá
  repetir as medições com o agente e a web.
- O limite do WSL é 7,7 GiB; se a medição de duas sessões ficar apertada, será
  necessário autorização para alterar `.wslconfig`.
- O perfil local não deve ser considerado pronto para um piloto público sem a
  validação de isolamento descrita no plano.
