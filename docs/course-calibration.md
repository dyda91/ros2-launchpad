# Calibração do curso prático (v3)

Medições feitas em 2026-11-23 no servidor Ubuntu 26.04 (4 núcleos, 7 GiB,
sem GPU), com o laboratório manual (`make lab-up` + `ros2 launch
launchpad_bringup lab.launch.py`) e os mesmos comandos que o aluno digita:
`ros2 topic pub --rate 10 --times N /cmd_vel geometry_msgs/msg/Twist ...`.
A pose e a leitura frontal vêm de `tests/integration/course_probe.py`
(`/odom` + menor leitura válida do `/scan` em ±10° da frente), 1,2 s depois
de o comando terminar.

## Fatos conferidos no grafo

- Nós: `/cmd_vel_watchdog`, `/mission_monitor`, `/odom_merge`,
  `/robot_state_publisher`, `/ros_gz_bridge`.
- `ros2 topic info -v /odom`: um publicador, `odom_merge`.
- `header.frame_id` de `/odom`: `odom`; `child_frame_id`: `base_link`.
- `/scan`: 360 amostras, `range_max` 8.0; distribuição `jazzy`.

## Translação (0,3 m/s)

| Comando | Medido (m) | Nominal v·N/10 |
|---|---|---|
| `--times 30`, `x: 0.3`, do spawn | 0,920 / 0,947 / 0,979 | 0,90 |
| `--times 15`, `x: -0.3` | 0,441 / 0,518 / 0,493 | 0,45 |
| `--times 10`, `x: 0.2` | 0,277 | 0,20 |
| `--times 66`, `x: 0.3` | 2,04 / 1,82 | 1,98 |
| `--times 46`, `x: 0.3` | 1,40 / 1,26 | 1,38 |

A translação fica perto de v × (N/10 + 0,5) menos a aceleração; a dispersão
entre execuções é de ±6%.

## Rotação

| Comando | Medido (°) | Nominal ω·N/10 |
|---|---|---|
| `--times 15`, `z: 0.8` | 94,7 / 80,1 | 68,8 |
| `--times 20`, `z: 0.8` | 117,5 / 106,5 | 91,7 |
| `--times 10`, `z: -0.5` | 38,4 | 28,6 |
| `--times 40`, `z: 0.9` | 221,4 | 206,3 |
| `--times 5`, `z: 0.5` | 28,1 | 14,3 |

O giro real fica **acima** do nominal, não abaixo: o watchdog mantém o último
comando por 0,5 s depois que as mensagens param, e ω × (N/10 + 0,5) explica
a maior parte. A dispersão é de ~±7° em um giro de 90°. Por isso o curso usa
alvos absolutos com tolerância (yaw 90° ± 15°, regiões) e ensina a corrigir
com comandos curtos e lentos (`z: 0.2`, `--times 2`).

## Rota aberta da entrega

A mesma sequência fixa de 11 comandos, a partir do spawn, terminou em
(4,42; 5,13) em uma execução, após raspar na caixa C, e em (6,30; 3,91) na
outra; nenhuma entrou na zona. A solução da entrega é, portanto, uma
sequência de referência com instrução para medir e corrigir, e o Playwright
conduz em malha fechada.

## Ajustes no conteúdo decorrentes

- Faixa A: x ∈ [0,8; 1,6], y ∈ [−0,3; 0,3]. O desenho original
  (x até 1,8, y ±0,45) ficava a 0,21 m da caixa A e a 0,15 m da parede sul;
  o teste de conteúdo exige 0,29 m.
- Yaw 90° ± 15°: `--times 15` a 0,8 rad/s cai dentro da tolerância nas
  medições, mas pode precisar de um ajuste fino.
- Faixa B: x ∈ [0,2; 1,8], y ∈ [1,6; 2,4]; a dica sugere `--times` perto de
  65 a 0,3 m/s.
- LiDAR: a caixa C só entra no setor de ±10° com o robô entre x ≈ 0,4 e
  1,6; a dica orienta mirar no meio da faixa B.
- Entrega: o corredor acima da coluna B exige y ≥ ~3,5 (topo da coluna em
  3,25 mais a meia largura de 0,21 m); a estratégia usa y ≈ 3,6.
