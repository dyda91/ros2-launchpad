# Simulador leve (`fastsim`)

## Objetivo

Permitir muito mais sessões simultâneas por servidor trocando o Gazebo por um
nó ROS 2 que publica os mesmos tópicos, sem mudar o curso, o terminal, a API
nem o visor. O Gazebo continua disponível como backend de referência.

## Motivação (linha de base medida)

Uma sessão ociosa com Gazebo usa cerca de 190% de CPU e 490 MiB. O `gz sim`
sozinho ocupa ~90% de CPU e 450 MiB; os nós Python (`odom_merge`, monitor,
watchdog, agente) somam o resto. Com 4 núcleos, isso limita o servidor a 2–3
sessões.

## Escopo

- Backend `SIM_BACKEND=fast`: um nó `fastsim` substitui `gz sim`,
  `ros_gz_bridge`, `create` e `odom_merge`.
- Seleção por variável de ambiente (`SIM_BACKEND`, padrão `gazebo`), repassada
  pelo runtime ao container da sessão; o `lab.launch.py` recebe o argumento
  `sim_backend`.
- Limites por sessão configuráveis (`SESSION_MEMORY`, `SESSION_CPUS`).
- Mesma interface para o aluno: `/cmd_vel` (via watchdog), `/odom`, `/scan`,
  `/clock`, `/tf`, `/launchpad/mission_status`.

## Fora do escopo

- Física realista (derrapagem, inércia, ruído): o modelo é cinemático com
  limites de aceleração e colisão geométrica.
- Compartilhar um processo ROS 2 entre usuários.
- Mudar o isolamento dos shells (continua um container por sessão).

## Modelo

| Elemento | Gazebo | `fastsim` |
|---|---|---|
| Tração | diff-drive, ±0,5 m/s, ±1,2 rad/s | cinemática diferencial, mesmos limites; aceleração 1,5 m/s² e 4 rad/s² |
| Pose | `/launchpad/_odom_world` a 50 Hz | integração a 25 Hz |
| Colisão | física ODE | retângulo do robô (0,46 × 0,415 m) contra caixas, racks, pilar e paredes; desliza ou para |
| LiDAR | `gpu_lidar` 360 raios, 10 Hz, 0,12–8,0 m | ray casting 2D com numpy; `+inf` acima do alcance, `-inf` abaixo |
| Relógio | `/clock` do Gazebo | `/clock` a 5 Hz, tempo de simulação igual ao tempo de parede |

## Critérios de aceite

1. `make test-fastsim` (testes unitários do núcleo geométrico e cinemático).
2. Os tópicos visíveis ao aluno são os mesmos; os tipos e `frame_id` coincidem;
   `/scan` tem 360 amostras e `angle_increment` igual ao do Gazebo.
3. O curso inteiro (`stage3.spec.ts`, 23 desafios) passa contra o backend
   rápido; o aceite em condução (`stage4-driving`) também.
4. Consumo medido por sessão e limite de sessões estimado com folga
   (`make load-test`), registrados em `docs/fastsim-results.md`.
5. O backend `gazebo` continua sendo o padrão e continua passando no portão.

## Riscos

- Calibração: os desafios de pose e scan foram calibrados no Gazebo, cuja
  velocidade real varia com a carga (fator de tempo real de 0,7 a 0,9 nas
  medições). O modelo ideal anda ~8–27% mais longe por comando; as tolerâncias
  do curso cobrem isso e o `stage3` valida.
- Aproximação: comportamentos finos do Gazebo (empurrar caixa, derrapar)
  não existem no modo rápido.
