# Especificação — Primeiro Turno

## Status

- **Etapa 1:** implementada e validada em 2026-11-20.
- **Etapa 2:** especificada; não implementada.
- **Etapa 3:** especificada; não implementada.

## Produto

O ROS 2 Launchpad é um laboratório de ROS 2 no navegador, em português do
Brasil, para pessoas sem experiência em robótica. Sem cadastro ou login, o
visitante inicia uma sessão anônima temporária com um robô, um terminal Linux
e a missão guiada "Primeiro Turno".

O objetivo da missão é conduzir um robô móvel até a zona de coleta do armazém
e parar dentro dela. A hipótese de produto é que um iniciante conclua a
experiência em cerca de 10 minutos; a hipótese será validada com usuários.

## Persona e jornada

- Pessoa iniciante, sem conhecimento prévio de ROS 2.
- Abre a página, lê o desafio e clica em "Iniciar laboratório".
- Recebe um ambiente preparado e vê três áreas: desafio, visor e terminal.
- Descobre os canais do robô, lê a odometria, faz um primeiro movimento curto
  e completa a entrega na zona de coleta.
- Termina com uma confirmação e uma pergunta sobre como o robô poderia
  detectar obstáculos, como gancho para uma futura missão de LiDAR.

## Escopo

Incluído: um robô diferencial, um armazém, uma missão, simulação headless,
interfaces ROS 2 reais, sessão anônima temporária, terminal, visor 2D,
reinício, expiração e isolamento por sessão.

Fora de escopo nesta entrega: cadastro, curso completo, múltiplas missões,
LiDAR, SLAM, Nav2, visor 3D, publicação, GPU, WSLg, X11, RViz e GUI do Gazebo.

## Requisitos funcionais

- **R1** Sessão anônima vinculada a um cookie `HttpOnly`, sem login.
- **R2** Ciclo de vida com estados `preparing`, `ready`, `full`,
  `disconnected` e `expired`; estado interno de erro para falhas.
- **R3** Cada sessão tem shell, simulador, ROS graph e UDS próprios.
- **R4** PTY real com digitação, saída contínua, resize, histórico, Ctrl+C e
  reconexão.
- **R5** Visor Canvas 2D carrega o mapa uma vez e recebe pose/velocidade
  limitadas (10 Hz).
- **R6** `/cmd_vel` e `/odom` são as interfaces da missão, com tipos
  verificados no ambiente real.
- **R7** O robô para automaticamente quando os comandos cessam, com tempo de
  expiração definido e testado.
- **R8** Reiniciar a missão restaura a pose e o progresso sem deixar a
  instância anterior em execução.
- **R9** Expirar ou encerrar libera a vaga; requisições concorrentes não
  criam sessões duplicadas.
- **R10** O backend autoriza terminal, telemetria e controles com o segredo
  da sessão vinculado ao navegador.
- **R11** A aplicação é separada do componente que opera o runtime; somente
  este último acessa o socket do Docker.
- **R12** A interface e os textos são em pt-BR; textos, dicas e parâmetros
  ficam em `content/`.

## Referenciais e unidades

- Referencial da missão: `odom`.
- O robô nasce em `(0, 0, 0)` e o eixo `x` aponta para a frente inicial.
- `yaw` positivo é anti-horário; unidades em metros e radianos.
- A zona de coleta e os obstáculos são definidos no mesmo YAML que gera o
  cenário; o visor consome o JSON derivado desse YAML.

## Etapa 1 — robô e armazém

### Entregáveis

- Robô móvel diferencial com duas rodas motrizes e apoio passivo.
- Chassi e rodas modelados com primitivas, massas, inércias e colisões.
- Armazém compacto com piso, paredes, obstáculos e zona de coleta.
- Geração do cenário e do mapa a partir de `content/world/armazem.yaml`.
- Launch headless que sobe o mundo, insere um único robô em pose definida e
  configura os bridges ROS 2/Gazebo.
- Watchdog de `/cmd_vel` com expiração de 0,5 s e limites de velocidade.
- Monitor da missão usando pose e velocidade reais de `/odom`.

### Critérios de aceite da Etapa 1

- `make build` constrói a imagem com Ubuntu 24.04, ROS 2 Jazzy e Gazebo
  Harmonic, sem GUI, GPU ou WSLg.
- `make test-world` valida a geometria, a geração determinística e a rota.
- `make stage1` inicia o simulador headless e confirma:
  - `/cmd_vel` é `geometry_msgs/msg/Twist`;
  - `/odom` é `nav_msgs/msg/Odometry`;
  - existe um único `launchpad_robot`;
  - uma amostra inicial fica em `(0, 0, 0)` dentro da tolerância;
  - um comando de 0,2 m/s por 2 s desloca o robô e ele para em até 0,5 s após
    o fim dos comandos;
  - um comando CLI de duração limitada também termina com o robô parado;
  - a rota real até a zona é validada por pose e velocidade;
  - reiniciar a execução volta à pose inicial sem robô duplicado.
- Tempo de inicialização, CPU e RAM são registrados em
  `docs/stage1-results.md`.

### Evidência

A Etapa 1 foi aprovada em 2026-11-20. Startup observado: **5,85–6,61 s** em três
execuções. Parada observada após o comando:
**0,400 s**. Consumo ocioso: **66,8–70,2% de um núcleo** e **~258 MiB**.
Consumo durante movimento: pico de **124,7%** e **~292 MiB**. Consulte `docs/stage1-results.md` para os comandos e amostras.

## Etapa 2 — sessão, terminal e visor

### Critérios de aceite planejados

- Abrir a página no navegador do Windows via `localhost`, iniciar sessão e
  executar `ros2 topic list` e um movimento no terminal; o visor reflete a
  pose real em até 1 s.
- Dois perfis de navegador têm robôs independentes; o comando de um visitante
  não afeta o robô do outro.
- Recarregar reconecta à mesma sessão; reiniciar restaura pose e progresso;
  expirar libera a vaga; lotação é exibida.
- Shell não-root, com limites de CPU, RAM e PIDs, sem socket do Docker, sem
  rede externa, sem arquivos do host e sem acesso a outra sessão.
- O perfil de desenvolvimento publica apenas em loopback.

## Etapa 3 — missão guiada

### Critérios de aceite planejados

- Três áreas visíveis: desafio atual, visor e terminal.
- Quatro passos com ação, observação e dica opcional; "Inserir comando"
  insere sem executar.
- A última etapa oferece a solução completa em dica opcional.
- A entrega é validada por pose dentro da zona e velocidade baixa por 2,0 s
  contínuos, com dados reais do simulador.
- A experiência termina com confirmação e a pergunta sobre LiDAR.
- Teste Playwright real cobre movimento pelo navegador, dois contextos,
  reconexão, reinício, expiração e lotação.

## Requisitos não funcionais

- Simulação sem interface gráfica, sem GPU, sem WSLg, X11 ou RViz.
- API, frontend e runtime executam em containers; o perfil local usa
  `127.0.0.1`.
- Limite inicial de sessões configurável; padrão 2 para desenvolvimento.
- TTL inicial: 30 min; inatividade: 10 min.
- Isolamento de sessão com container próprio, sem rede externa, UDS, UID
  1000, `cap_drop: ALL`, `no-new-privileges` e limites de cgroup.
- Antes de um piloto público, documentar e validar o isolamento contra
  escapes, mineração, exaustão de recursos e acesso a outras sessões.

## Métricas a registrar

- Tempo de inicialização até a primeira mensagem de `/odom`.
- CPU e RAM com uma e duas sessões, ocioso e em movimento.
- Latência de parada após o fim dos comandos.
- Tempo de criação de sessão, reconexão, reinício e limpeza.
- Taxa de sucesso do aceite em execuções repetidas.

## Riscos e mitigação

- **Memória do WSL:** 7,7 GiB; medir e limitar sessões; aumentar `.wslconfig`
  apenas com autorização.
- **DDS em `network none`:** validado na Etapa 1 com CycloneDDS e loopback.
- **Isolamento fraco do Docker para código arbitrário:** aceitável no perfil
  local; para piloto público, usar rootless/VM dedicada, seccomp/AppArmor,
  gVisor ou Firecracker, TLS e rate limiting.
- **Alinhamento entre cenário e visor:** resolvido pela fonte única do YAML e
  por teste de consistência.
- **Aviso KDL:** o link raiz tem inércia; não afeta o comportamento validado.
