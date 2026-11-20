# ROS 2 Launchpad

Laboratório de ROS 2 no navegador para iniciantes. O escopo deste repositório
nesta entrega é a **Etapa 1**: robô diferencial, armazém, simulação headless e
interfaces ROS 2 reais. A aplicação web (Etapa 2) e a missão guiada (Etapa 3)
ainda não foram iniciadas.

## O que funciona

- Imagem Ubuntu 24.04 + ROS 2 Jazzy + Gazebo Harmonic.
- Robô diferencial com duas rodas motrizes, caster passivo, massas, inércias
  e colisões.
- Armazém gerado a partir de `content/world/armazem.yaml`, com piso, paredes,
  três obstáculos e zona de coleta.
- Launch headless com um único robô em `(0,0,0)`.
- `/cmd_vel` e `/odom` funcionando; watchdog de 0,5 s.
- Validação da missão por pose e velocidade reais.
- Script de aceite completo com métricas.

## Pré-requisitos no WSL

- Windows 10/11 com WSL 2 e uma distribuição Ubuntu.
- Docker Engine e Docker Compose instalados no WSL, com o daemon funcionando.
- Usuário no grupo `docker` (ou permissão equivalente ao socket).
- Repositório no filesystem Linux, por exemplo `~/ros2-launchpad`.
- Python 3 no WSL para o script de aceite (sem pacotes adicionais).
- Pelo menos 8 GB de RAM e ~10 GB livres para a imagem e o cache do Docker.
- Nenhum requisito de GPU, WSLg, X11 ou RViz.

Verifique:

```bash
docker --version
docker compose version
docker info >/dev/null && echo "daemon ok"
id | grep docker
```

## Construir e subir

```bash
cd ~/ros2-launchpad
cp .env.example .env
make build
make lab-up
```

A imagem fixa a base `ros:jazzy-ros-base` por digest e as versões principais
dos pacotes ROS. O build baixa as dependências na primeira vez; a imagem final
observada tem 3,45 GB.

## Validação da Etapa 1

```bash
make test-world
make stage1
```

`make stage1` recria o container, inicia o simulador, valida tópicos e tipos,
confere a pose inicial, move o robô, verifica a parada, executa um comando CLI
de duração limitada, percorre a rota até a zona, mede recursos e reinicia para
confirmar que a pose volta ao início.

Resultado esperado (2026-11-20; startup e CPU variam entre execuções):

```text
startup_seconds=5.85–6.61
cmd_vel=geometry_msgs/msg/Twist
odom=nav_msgs/msg/Odometry
robots=launchpad_robot
pose zero ok
parada observada em 0.400 s
cli movement ok: 0.420–0.440 m, final vx=0.000000
entrega validada por pose e velocidade reais
=== ACEITE ETAPA 1: OK ===
```

Detalhes em [`docs/stage1-results.md`](docs/stage1-results.md).

## Comandos manuais

Shell no laboratório:

```bash
make lab-shell
```

Dentro do container:

```bash
source /opt/ros/jazzy/setup.bash
source /ros_ws/install/setup.bash

ros2 launch launchpad_bringup lab.launch.py
```

Em outro terminal:

```bash
docker compose exec lab bash -lc \
  'source /opt/ros/jazzy/setup.bash; source /ros_ws/install/setup.bash; \
   ros2 topic list'
```

Descobrir as interfaces:

```bash
ros2 topic type /cmd_vel
ros2 topic type /odom
ros2 interface show geometry_msgs/msg/Twist
ros2 interface show nav_msgs/msg/Odometry
ros2 topic echo /odom --once
```

Primeiro movimento com duração limitada:

```bash
timeout 3 ros2 topic pub --rate 10 /cmd_vel \
  geometry_msgs/msg/Twist "{linear: {x: 0.2}}"
```

O `timeout` encerra o publisher após 3 s. O watchdog zera o comando após 0,5 s
sem mensagens. Para confirmar:

```bash
python3 /tests/integration/odom_probe.py --mode sample
python3 /tests/integration/odom_probe.py --mode move \
  --speed 0.2 --duration 2.0
```

Percorrer a rota até a zona de coleta:

```bash
python3 /tests/integration/route_probe.py
```

Reiniciar a simulação e voltar à pose inicial:

```bash
docker compose restart lab
docker compose exec -d lab bash -lc \
  'source /opt/ros/jazzy/setup.bash; source /ros_ws/install/setup.bash; \
   ros2 launch launchpad_bringup lab.launch.py > /tmp/lab_launch.log 2>&1'
```

Parar tudo:

```bash
make lab-down
```

## URL local e navegador do Windows

A Etapa 1 não publica porta. Quando a Etapa 2 for implementada, o perfil de
desenvolvimento publicará **somente em loopback**, em
`http://localhost:5173` (Vite) e o perfil de produção em
`http://localhost:8080`.

O WSL 2 em modo NAT permite abrir serviços em loopback pelo navegador do
Windows usando `localhost`. Não será necessário habilitar WSLg, X11 ou GPU.

## Roteiro de demonstração (Etapa 1)

1. `make lab-up` e `make lab-shell`.
2. `ros2 launch launchpad_bringup lab.launch.py`.
3. Em outro terminal: `ros2 topic list`, `ros2 topic type /cmd_vel` e
   `ros2 topic type /odom`.
4. `ros2 topic echo /odom --once` e observe a pose inicial `(0,0)`.
5. Execute o comando de 3 s e observe que o robô anda e para.
6. Rode `route_probe.py` e veja a entrega na zona.
7. Reinicie o container e confirme a pose inicial novamente.

## Testes e arquivos principais

```text
content/world/armazem.yaml                  fonte única da geometria
lab/ros_ws/src/launchpad_sim/               URDF, gerador, watchdog, monitor
lab/ros_ws/src/launchpad_bringup/           launch
lab/image/Dockerfile                        imagem do laboratório
tests/integration/test_world_geometry.py    testes de geometria
tests/integration/odom_probe.py             movimento e parada
tests/integration/route_probe.py            rota e entrega
tests/integration/stage1_acceptance.sh      aceite completo
docs/stage1-results.md                      medições e evidências
```

## Falhas comuns

**`permission denied` ao acessar `/var/run/docker.sock`**

Adicione o usuário ao grupo `docker` e abra um novo shell:

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

Isso altera o sistema; faça apenas com autorização.

**Daemon do Docker não está rodando**

No WSL com systemd:

```bash
sudo systemctl status docker
sudo systemctl start docker
```

**A imagem não constrói por versão de pacote**

As versões ROS estão fixadas no Dockerfile com a data do repositório. Se o
espelho não tiver exatamente essas versões, remova o `=versão` correspondente
e registre a versão resolvida com `dpkg-query`. Não altere a base sem
atualizar a documentação.

**O Gazebo não inicia ou reclama de display**

A simulação é headless (`-s`). Não defina `DISPLAY`, não use WSLg e não tente
abrir a GUI do Gazebo. Verifique `/tmp/lab_launch.log`.

**Nenhum tópico aparece**

Confirme que o launch está rodando e que o shell carregou ROS e o workspace:

```bash
source /opt/ros/jazzy/setup.bash
source /ros_ws/install/setup.bash
ros2 topic list
```

**O robô não para**

Verifique se o watchdog está vivo:

```bash
ros2 node list | grep cmd_vel_watchdog
ros2 topic echo /launchpad/_cmd_vel_safe --once
```

O tópico `/cmd_vel` deve ser usado pelo aluno; o tópico seguro é interno.

**Robô duplicado ou estado antigo**

```bash
make lab-down
docker compose up -d --force-recreate lab
```

O script `make stage1` já faz uma recriação limpa.

**Aviso KDL sobre inércia no link raiz**

É um aviso conhecido do `robot_state_publisher`. O modelo funciona e o aceite
passa; a pose não é afetada.

## Limitações desta entrega

- Sem aplicação web, terminal no navegador, sessões ou Canvas.
- Sem LiDAR, SLAM, Nav2, visor 3D ou publicação.
- O isolamento por sessão será implementado na Etapa 2; o container atual é
  um laboratório local, não um serviço público.
- Duas sessões simultâneas ainda não foram medidas.

Consulte [`specs/001-primeiro-turno/spec.md`](specs/001-primeiro-turno/spec.md),
[`plan.md`](specs/001-primeiro-turno/plan.md) e
[`tasks.md`](specs/001-primeiro-turno/tasks.md).
