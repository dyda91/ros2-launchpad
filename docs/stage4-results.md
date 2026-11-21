# Resultados da Etapa 4 — curso, Tab, condução e LiDAR

Data: 2026-11-21.

## Build entregue ao usuário

A aplicação é servida por `apps/api` em `127.0.0.1:8080`; o frontend é
reconstruído na imagem da API. Após a última reconstrução:

```bash
docker compose ps
docker exec ros2-launchpad-api ls -l /app/static/assets
curl -s http://127.0.0.1:8080/ | grep -o 'assets/index-[^"]*'
```

O navegador precisa ser recarregado com **Ctrl+Shift+R** para usar os assets
novos. As sessões de teste são containers efêmeros; reinicie a sessão depois
de uma rodada de regressão que use `sessions-clean`.

Build verificado nesta rodada:

```text
assets/index-CMvykhyO.js
assets/index-0EX-Ykap.css
```

O mesmo hash apareceu no `curl` da página e em `/app/static/assets` da API.

## Tab no terminal web

O PTY agora inicia:

```text
bash --noprofile --rcfile /etc/launchpad.bashrc -i
```

O rcfile carrega ROS 2, `bash-completion`, a completação `ros2` registrada
pelo ambiente e configura o readline para listar prefixos ambíguos.

Comandos verificados no xterm:

- `ls /opt/ros/jazzy/setup.b<Tab>` →/`/opt/ros/jazzy/setup.bash`;
- `ros2 top<Tab>` → `ros2 topic`;
- `ls /opt/ros/jazzy/setup.<Tab><Tab>` → lista `setup.bash`, `setup.sh` e
  `setup.zsh`;
- Tab é enviado ao shell apenas quando o xterm tem foco. O terminal ganha foco
  ao clicar no workspace e pelo botão **Focar terminal**.
- **Ctrl+Shift+E** sai do terminal e leva o foco à aula. O atalho está na ajuda
  do terminal e no módulo de terminal Linux.

O shell direto e o PTY usam o mesmo Bash, ROS 2 e completion; a diferença
anterior era o `exec bash --noprofile --norc` que descartava a configuração de
completude. O readline foi configurado para listar um prefixo ambíguo já no
primeiro Tab (o teste usa dois Tabs para deixar a listagem explícita).

## Condução repetida e mapa

O aceite no navegador executa, na mesma sessão e sem reiniciar:

```text
avançar → parar → girar à esquerda → avançar → girar à direita → recuar → parar
```

Validações:

- deslocamento positivo no referencial da frente do robô;
- yaw aumentando na esquerda e diminuindo na direita;
- ré medida pelo produto escalar com a frente atual, não pelo eixo X do mapa;
- retorno ao prompt após cada comando;
- parada confirmada por `/odom`;
- publicação contínua, Ctrl+C e comando seguinte;
- condução disponível após avançar módulo e após a entrega.

O visor usa `pose.yaw` de `/odom`; a seta e o deslocamento acompanham a nova
orientação. A causa reproduzida da perda de controle foi foco do teclado:
o botão de inserção/navegação mantinha o foco e o Enter não chegava ao PTY.
O shell direto executou a sequência corretamente, então watchdog, bridge e
Gazebo não precisaram de correção.

Valores da sequência direta no mesmo robô:

```text
início:    x=-0.0000 y=0.0000 yaw=-0.0000
avançar:   x= 0.2200 y=-0.0000 yaw=-0.0000
esquerda:  x= 0.2200 y=-0.0000 yaw= 0.5600
avançar:   x= 0.3090 y= 0.0558 yaw= 0.5600
direita:   x= 0.3090 y= 0.0558 yaw= 0.0800
recuar:    x= 0.2043 y= 0.0474 yaw= 0.0800
final:     velocidade 0.0000
```

## Curso v2

Seis módulos em `content/missions/primeiro-turno.yaml`:

1. Terminal Linux e Tab;
2. comunicação ROS 2;
3. odometria;
4. condução livre;
5. LiDAR e obstáculos;
6. entrega no armazém.

Cada módulo tem conceito, motivo, exemplo comentado, ação, exercício,
observação e dicas graduais; a solução completa aparece depois de esgotar as
dicas e pode ser copiada para o terminal. O curso usa `version: 2` e a API
valida os seis módulos e os novos campos.

O desktop passou a ter duas colunas: aula à esquerda; visor e terminal
empilhados à direita. Em telas menores tudo empilha. O terminal fica
imediatamente abaixo do visor. O visor tem legenda de parede/obstáculo/zona/
LiDAR, zoom de 1,00x a 3,00x e botão **Centralizar**. A orientação do robô é
desenhada a partir de `pose.yaw`.

O layout ocupa a altura da janela e reserva uma faixa mais baixa e larga para
o mapa; o terminal fica visível sem rolar a página. Em 1280x800, o teste mede
o retângulo do terminal dentro da janela e exige
`scrollHeight - innerHeight <= 1`. O Canvas usa escalas independentes em X e
Y: o mapa preenche a faixa esticada, em vez de manter uma área quadrada que
empurra o terminal para fora da tela. Em telas estreitas, a página volta a
rolar e os painéis empilham.

## LiDAR

Foi adicionado um sensor `gpu_lidar` de 360 amostras, 10 Hz, alcance
0,12–8 m, no link `lidar_link`. O sensor roda no Gazebo headless do WSL sem
GPU dedicada; o `/scan` é publicado como `sensor_msgs/msg/LaserScan`.

O agente assina `/scan`, envia a leitura pela telemetria e o Canvas desenha
os pontos transformados pela pose de `/odom` **no instante da leitura**. O
agente guarda um histórico curto de poses e anexa ao scan a pose de `/odom`
mais próxima do `header.stamp`; o Canvas usa essa pose, não a pose mais
recente da tela. Antes, a nuvem capturada antes de uma curva era desenhada
com o yaw novo, girando os pontos e criando uma parede aparente à frente.
A camada LiDAR pode ser ligada e desligada. O teste verifica mais de 20
pontos, o toggle, a presença do tópico real e a diferença máxima de 1 s entre
o stamp do scan e o stamp da pose usada.

O módulo de LiDAR usa uma leitura real de `/scan`, pergunta o efeito de se
aproximar de uma parede e pede que o aluno use os pontos para escolher um
desvio. A entrega continua validada exclusivamente por `delivered` do
`mission_monitor`.

## Medições no WSL

Duas sessões, com LiDAR ligado:

| Métrica | Sem LiDAR (2B) | Com LiDAR |
|---|---:|---:|
| Ready A | 7,90 s | 8,75–8,94 s |
| Ready B | 6,85 s | 8,75–9,01 s |
| RAM por sessão | ~270 MiB | ~448 MiB |
| CPU ociosa por sessão | 63–65% de um núcleo | 107–121% de um núcleo |
| Sessões | 2 | 2 |

A abertura ficou ~1,0–2,2 s mais lenta; o sensor adicionou aproximadamente
178 MiB e ~0,43 núcleo por sessão. Duas sessões permanecem dentro dos limites
de 2 GiB/2 CPUs de cada container e do WSL de 7,7 GiB. O LiDAR usa renderização
de sensores em software; a GPU não foi necessária.

## Testes executados

| Verificação | Resultado |
|---|---|
| `make e2e` (2A + curso) | **3 passed** |
| `make e2e-4a` (Tab, foco, condução, Ctrl+C, comandos ROS) | **8 passed** |
| `make test-mission` | **6/6 OK** |
| `make stage2b` (duas sessões, reconexão, TTL) | **2 passed** |
| `make measure-2b` | **A 8,75–8,94 s; B 8,75–9,01 s; 2 ativas** |
| `make test-api` | **2/2 OK** |
| `make test-session-capacity` | **8/8 OK** |
| `make test-pilot` | **5/5 OK** |
| `pilot-acceptance` | **OK** |
| LiDAR `/scan` | tipo, publisher e leituras reais OK |
| Canvas LiDAR | pontos >20, toggle e pose temporal OK |
| Layout 1280x800 | terminal dentro da janela, sem rolagem vertical |

## Exemplos e comandos verificados

Verificados no xterm real:

```text
pwd
ls
ls /opt/ros/jazzy/setup.b<Tab>
ros2 top<Tab>
ls /opt/ros/jazzy/setup.<Tab><Tab>
ros2 node list
ros2 topic list
ros2 topic info /cmd_vel
ros2 topic type /cmd_vel
ros2 interface show geometry_msgs/msg/Twist
ros2 topic echo --once /odom
timeout 2 ros2 topic hz /odom
ros2 topic echo --once /scan
ros2 topic pub --rate 10 /cmd_vel ...
Ctrl+C
Ctrl+Shift+E
```

`ros2 topic hz` foi testado com timeout para devolver o prompt; a publicação
de movimento foi testada com timeout e com publicação contínua interrompida
por Ctrl+C.

## Pendências

- Repetir o aceite no host real, com navegador externo e duas sessões.
- Teste com uma pessoa iniciante, separado do teste técnico.
- Confirmar o custo de CPU/RAM e o comportamento do LiDAR no host escolhido;
  o sensor foi validado apenas no WSL.
- Publicação/TLS e o piloto público continuam pendentes.
- A missão final ensina o desvio e usa o monitor existente; não há um novo
  critério automático que force uma rota específica ao redor do obstáculo.


## Como reproduzir

```bash
make up
make e2e-4a        # Tab, foco, condução, Ctrl+C e atalho de saída
make e2e           # 2A, layout sem rolagem, curso e reinício
make test-mission  # schema e conteúdo dos seis módulos
make stage2b       # duas sessões, reconexão, TTL e lotação
make measure-2b    # startup, CPU e RAM com duas sessões
```

No navegador:

1. Recarregue com Ctrl+Shift+R e inicie uma sessão.
2. Digite `ls /opt/ros/jazzy/setup.b` e pressione Tab; o comando completa
   `setup.bash`.
3. Digite `ros2 top` e pressione Tab; completa `ros2 topic`.
4. Digite `ls /opt/ros/jazzy/setup.` e pressione Tab novamente; aparecem
   `setup.bash`, `setup.sh` e `setup.zsh`.
5. Use Ctrl+Shift+E; o foco vai para a aula.
6. Execute giro com `angular.z`, espere a parada e avance com `linear.x`;
   confirme yaw e x/y no visor. Repita com o sinal oposto e com `linear.x`
   negativo.
7. Abra a camada LiDAR e aproxime/gire perto de uma parede; os pontos devem
   acompanhar a pose e mudar de distância.

## Passou no WSL e pendente

**Passou no WSL:** build servido em `127.0.0.1:8080`, Tab de caminho,
subcomando e listagem ambígua; atalho de saída; foco; condução repetida com
curvas e ré; curso v2 (seis módulos); layout de duas colunas; LiDAR real
headless, camada no Canvas, zoom e centralização; duas sessões, reconexão,
lotação, TTL e limpeza; medição de recursos.

**Pendente:** repetir o aceite em host real com navegador externo, TLS/WSS
público, duas pessoas iniciantes e medição de LiDAR no hardware do host. A
validação de obstáculo é pedagógica e usa `delivered` do monitor; não há uma
nova regra automática que force uma rota específica.
