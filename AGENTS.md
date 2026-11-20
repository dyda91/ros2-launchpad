# AGENTS.md

## Estado atual

Este repositório implementa **somente a Etapa 1** do ROS 2 Launchpad: robô,
armazém, simulação headless e interfaces ROS 2. A aplicação web (Etapa 2) e a
missão guiada (Etapa 3) estão especificadas, mas não implementadas.

## Objetivo do produto

Laboratório de ROS 2 no navegador, em português do Brasil, para iniciantes,
sem cadastro. O visitante recebe uma sessão anônima temporária com robô,
terminal Linux e a missão "Primeiro Turno". O escopo atual tem um robô, um
armazém e uma missão.

## Estrutura

```text
content/world/armazem.yaml                  fonte única da geometria do armazém
docs/stage1-results.md                      medições e evidências da Etapa 1
lab/ros_ws/src/launchpad_sim/               URDF, mundo gerado, watchdog e monitor
lab/ros_ws/src/launchpad_bringup/           launch headless
lab/image/Dockerfile                        imagem Ubuntu 24.04 + ROS 2 Jazzy + Gazebo
specs/001-primeiro-turno/                   spec, plan e tasks
tests/integration/                          aceite e probes ROS 2 reais
compose.yaml                                perfil local isolado
Makefile                                    comandos reproduzíveis
```

## Convenções

- Interface, textos e documentação em português do Brasil.
- Identificadores de código em inglês; sem comentários no código.
- Python 3.12 dentro do container; ROS 2 Jazzy; `ament_python`.
- A geometria do armazém tem uma única fonte: `content/world/armazem.yaml`.
  O SDF e o `map.json` são gerados por `generate_world.py`.
- O referencial da missão é `odom`; o robô nasce em `(0, 0, 0)`.
- `/cmd_vel` é a entrada do aluno. O watchdog publica em
  `/launchpad/_cmd_vel_safe`, que é o tópico ligado ao Gazebo.
- `/odom` é a fonte de pose e velocidade para o visor e para a validação.
- Não copiar, clonar nem importar código do projeto
  `ros2-warehouse-amr-simulator` ou de outros projetos pessoais.
- Não adicionar dependências de GUI, WSLg, X11, RViz ou GPU.
- Não iniciar a aplicação web antes da Etapa 2.

## Comandos reais

```bash
make build                 # constrói a imagem
make lab-up                # sobe o container
make lab-shell             # shell no laboratório
make test-world            # testes de geometria e geração
make stage1                # aceite completo da Etapa 1
make lab-logs              # logs do container
make lab-down              # para e remove o container
```

Dentro do container:

```bash
source /opt/ros/jazzy/setup.bash
source /ros_ws/install/setup.bash
ros2 launch launchpad_bringup lab.launch.py
ros2 topic list
ros2 topic type /cmd_vel
ros2 topic type /odom
ros2 topic echo /odom --once
timeout 3 ros2 topic pub --rate 10 /cmd_vel \
  geometry_msgs/msg/Twist "{linear: {x: 0.2}}"
python3 /tests/integration/odom_probe.py --mode move --speed 0.2 --duration 2.0
python3 /tests/integration/route_probe.py
```

Reiniciar a simulação e voltar à pose inicial:

```bash
docker compose restart lab
docker compose exec -d lab bash -lc \
  'source /opt/ros/jazzy/setup.bash; source /ros_ws/install/setup.bash; \
   ros2 launch launchpad_bringup lab.launch.py > /tmp/lab_launch.log 2>&1'
```

## Portão de verificação

Antes de concluir qualquer alteração:

```bash
make test-world
make stage1
```

O aceite exige dados reais do simulador, não apenas mocks. Atualize
`specs/001-primeiro-turno/tasks.md` e `docs/stage1-results.md` com o que foi
executado, o que passou e o que permanece pendente.

## Isolamento e segurança na Etapa 1

O container `lab` roda como UID 1000, sem rede (`network none`), com
`cap_drop: ALL`, `no-new-privileges`, 2 GiB de RAM, 2 CPUs e 256 PIDs. Ele não
monta o socket do Docker, não recebe portas e acessa apenas `/tests` e `/content` em
somente leitura. A Etapa 2 adicionará um container por sessão e UDS.

## Avisos conhecidos

- O KDL avisa que o link raiz `base_link` tem inércia. O Gazebo e a simulação
  funcionam; o aviso não altera a pose nem o controle.
- Com `network none`, o transporte do Gazebo pode avisar sobre IP preferido.
  `GZ_IP=127.0.0.1` mantém o funcionamento local.
