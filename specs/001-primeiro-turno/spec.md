# Especificação — Primeiro Turno

## Status

- **Etapa 1:** implementada e validada em 2026-11-20.
- **Etapa 2A:** implementada e validada em 2026-11-21.
- **Etapa 2B local** (duas sessões simultâneas, reconexão, progresso
  persistente, TTL e inatividade): implementada e validada em 2026-11-21.
- **Etapa 3:** implementada e validada em 2026-11-21.
- **Piloto público** (publicação TLS, autenticação de visitantes e validação
  reforçada de isolamento): pendente.

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
- **R2** Ciclo de vida com `idle`, `preparing`, `ready`, `full`, `error` e
  `expired`; a reconexão é automática enquanto a sessão está ativa.
- **R3** Cada sessão tem shell, simulador, ROS graph e UDS próprios.
- **R4** PTY real com digitação, saída contínua, resize, histórico e Ctrl+C;
  reconexão por offset preserva o xterm e retoma a saída.
- **R5** Visor Canvas 2D carrega o mapa uma vez e recebe pose/velocidade
  limitadas (10 Hz).
- **R6** `/cmd_vel` e `/odom` são as interfaces da missão, com tipos
  verificados no ambiente real.
- **R7** O robô para automaticamente quando os comandos cessam, com tempo de
  expiração definido e testado.
- **R8** Encerrar e iniciar outra sessão restaura a pose sem deixar a
  instância anterior em execução.
- **R9** Encerrar, expirar ou reiniciar uma sessão libera a vaga; duas
  sessões podem coexistir com progresso e telemetria isolados.
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

## Etapa 2A — sessão local, terminal e visor

### Entregue

- React + TypeScript + Vite, servidos pela API FastAPI em
  `http://localhost:8080`.
- Sessão anônima única, com cookie `HttpOnly`, sem login.
- Container efêmero criado pelo runtime a partir da mesma imagem da Etapa 1.
- Agente dentro do container que inicia o launch, abre o PTY, lê `/odom` por
  `rclpy` e expõe apenas uma UDS.
- xterm.js conectado ao PTY real, com resize, histórico do shell, Ctrl+C e
  buffer de saída.
- Canvas 2D carregando o `map.json` do próprio simulador e atualizando a pose
  a 10 Hz.
- Encerramento que remove o container e a UDS, liberando a sessão única.
- Separação de acesso: somente `apps/runtime` tem o socket do Docker; a API
  usa HTTP interno e a UDS; o navegador só acessa a API.

### Critérios de aceite executados

- `make stage1` continua passando.
- O navegador em localhost inicia a sessão sem terminal auxiliar: aprovado no
  Playwright e verificado por HTTP a partir do Windows.
- `ros2 topic list` no terminal real mostra `/cmd_vel` e `/odom`.
- `ros2 topic echo /odom` interrompido com Ctrl+C devolve o prompt.
- O comando de movimento da Etapa 1 muda a pose real exibida no Canvas e o
  robô para após o watchdog.
- Encerrar a sessão remove o container e permite iniciar outra na pose
  inicial.
- O container da sessão está em `network none`, sem socket Docker, com UID
  1000, `cap_drop: ALL`, `no-new-privileges`, 2 GiB, 2 CPUs e 256 PIDs.
- A aplicação publica apenas `127.0.0.1:8080`.

### Evidência

A Etapa 2A foi aprovada em 2026-11-21. Sessão pronta em **7,26 s** após o
`POST`; Playwright **1 passed em 47,8–50,0 s**; ocioso da sessão **73,81% de um
núcleo** e **269,9 MiB**. Consulte `docs/stage2a-results.md`.

## Etapa 2B — sessões simultâneas, reconexão e expiração

### Entregue

- Até duas sessões anônimas simultâneas (`MAX_SESSIONS=2`), cada uma com
  cookie, container, UDS e token próprios.
- Nome de container, UDS, `ROS_DOMAIN_ID` e `GZ_PARTITION` exclusivos por
  sessão; labels `launchpad.role=session` e `launchpad.session=<id>`.
- Reserva atômica da vaga na API antes da criação do container; a terceira
  sessão recebe `full` sem criar container.
- Progresso persistido no servidor por sessão, validado e devolvido em
  `GET /api/session`; recarregar restaura o painel; reiniciar zera.
- Reconexão do terminal por offset em buffer circular de 128 KiB, com replay
  dos últimos 128 KiB e preservação do xterm quando o offset é válido.
- Reconexão automática da telemetria e envio de eventos de ciclo de vida.
- TTL total de 30 min, inatividade de 10 min e aviso 2 min antes; expiração
  remove container e UDS e libera a vaga.
- Reinício mantém a mesma tag de sessão e vaga, mas recria container, pose e
  progresso.
- Limpeza de órfãos e encerramento de sessões ativas quando API ou runtime
  reiniciam.
- `make stage2b` com prazos curtos e `make measure-2b` para duas sessões.

### Critérios de aceite executados

- Dois perfis de navegador com robôs, terminais, tags e progressos distintos.
- Terceiro navegador recebe `full`; encerrar ou expirar libera a vaga.
- Recarregar reconecta à mesma sessão e restaura o progresso e o terminal.
- Reiniciar preserva a tag e a vaga, restaura a pose inicial e zera o painel.
- O aviso de expiração aparece antes do prazo; ao expirar, o container é
  removido, a vaga é liberada e uma nova sessão pode começar.
- A queda do WebSocket do terminal é seguida de reconexão e novo comando.
- `make stage1`, `make stage2a`, `make e2e`, `make stage2b` e `make measure-2b`
  passam com dados reais do simulador.
- Publicação pública, TLS e isolamento de piloto continuam fora do escopo
  local e pendentes.

### Evidência

A Etapa 2B local foi aprovada em 2026-11-21. Integração OK; Playwright 2B
**2 passed em 1,2 min**; duas sessões prontas em **7,90 s** e **6,85 s**;
consumo ocioso de **~270 MiB** e **63–65%** de um núcleo por sessão. Consulte
`docs/stage2b-results.md`.

## Etapa 3 — missão guiada Primeiro Turno

### Entregue

- Quatro desafios com conteúdo em `content/missions/primeiro-turno.yaml` e
  renderização genérica no frontend.
- Desafio 1: `ros2 topic list` e pergunta curta sobre `/cmd_vel` e `/odom`.
- Desafio 2: amostra de `/odom`, posição x/y relativa à origem de `odom` e
  explicação de que o yaw vem do quaternion; o conteúdo explicita que, neste
  cenário, a origem de `odom` foi alinhada à origem do mapa.
- Desafio 3: previsão, comando validado de 0,2 m/s por 3 s e conclusão por
  deslocamento novo ≥ 0,15 m e parada ≤ 0,02 m/s depois de uma pose de
  referência capturada quando o exercício está pronto.
- Desafio 4: ajuste de comandos, solução completa opcional com pose de partida
  explícita e conclusão somente por `delivered` do `mission_monitor`.
- Layout de três áreas: colunas lado a lado em desktop largo, desafio acima do
  visor e terminal em largura intermediária e empilhamento em telas estreitas.
- Prévia de comando com **Copiar** sempre disponível. **Inserir** só envia ao
  PTY quando o agente confirma prompt e linha vazia; não há Ctrl+U automático;
  o comando é de uma linha e só executa quando o aluno pressiona Enter.
- Reinício por recriação do container, com descarte de telemetria antiga,
  proteção contra cliques repetidos, mensagem de falha e nova tentativa.
- Progresso inicialmente em memória; a Etapa 2B passou a guardá-lo na API por sessão, restaurando o painel ao recarregar.
- Confirmação final e gancho:
  “Como o robô saberia que há uma caixa no caminho?”

### Critérios de aceite executados

- Um iniciante percorre os quatro desafios pela interface, com ação,
  observação e dicas graduais.
- Passar pela zona em movimento **não** conclui: o teste verifica
  `in_zone=true`, `delivered=false` e velocidade acima do limite.
- Parar dentro da zona por 2 s conclui: `delivered=true` do monitor real.
- Reiniciar recria o container, restaura a pose inicial e reinicia o painel no
  desafio 1.
- `make stage1`, `make stage2a` e `make e2e` continuam passando.
- Texto já digitado e `ros2 topic echo /odom` em execução bloqueiam a inserção
  automática; Copiar permanece disponível.
- Falha na criação do novo container é coberta pela API e pela UI; a interface
  permite tentar novamente.

### Evidência

A Etapa 3 foi aprovada em 2026-11-21. `make stage1` OK (startup 6,28 s);
`make stage2a` OK com Playwright 2A 1 passed em 48,6 s; `make e2e` 3 passed em
2,4 min. `make test-mission` 5/5 e `make test-api` 2/2. Consulte
`docs/stage3-results.md`.

## Requisitos não funcionais

- Simulação sem interface gráfica, sem GPU, sem WSLg, X11 ou RViz.
- API, frontend e runtime executam em containers; o perfil local usa
  `127.0.0.1`.
- Etapas 2A, 2B local e 3: limite configurável, com padrão 2 sessões
  simultâneas para desenvolvimento.
- TTL total de 30 min, inatividade de 10 min e aviso de 2 min.
- O progresso da missão é guardado na API por sessão e reinicia no reinício.
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
