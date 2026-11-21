# Resultados da Etapa 3 — Primeiro Turno

Data: 2026-11-21.

## Escopo entregue

A missão guiada de quatro desafios foi integrada à sessão local da Etapa 2A,
com conteúdo separado da interface, inserção segura de comandos, validação da
entrega pelo monitor ROS, reinício por recriação do container e testes reais no
WSL.

## Decisões implementadas

- **Layout:** três colunas em desktop largo; desafio acima do visor e do
  terminal em largura intermediária; empilhamento em telas estreitas. O teste
  Playwright verifica os três arranjos.
- **Inserção de comando:** cada ação mostra uma prévia de uma linha e um botão
  **Copiar** sempre disponível. O botão **Inserir no terminal** só habilita
  quando o agente confirma `prompt=true`, `lineEmpty=true` e `running=false`.
  Não há Ctrl+U automático. O texto é enviado sem Enter; somente o aluno
  pressiona Enter.
- **Detecção do shell:** o bash usa um marcador de prompt; o agente acompanha
  o estado do prompt e da linha a partir do PTY e dos eventos de entrada. Isso
  evita enviar texto quando já existe texto digitado ou quando
  `ros2 topic echo /odom` está em execução.
- **Desafio 2:** o conteúdo explica que x/y são relativos à origem do
  referencial `odom` e que, neste cenário, essa origem foi alinhada à origem do
  mapa. Também explica que o yaw é calculado a partir do quaternion.
- **Desafio 3:** a pose de referência é capturada quando a previsão foi
  respondida e o terminal está no prompt e vazio. A conclusão exige
  deslocamento novo ≥ 0,15 m e parada ≤ 0,02 m/s depois dessa referência.
- **Desafio 4:** `delivered` do `mission_monitor` é a única fonte de verdade.
  A solução opcional tem pose de partida explícita (x≈0,44, y≈0, z≈0) e foi
  calibrada no simulador real.
- **Reinício:** recria o container e a UDS; a UI descarta telemetria da sessão
  antiga por geração, mostra falha se o novo container não subir e permite nova
  tentativa. Cliques repetidos são bloqueados na UI e serializados na API.
- **Progresso:** implementado inicialmente em memória no navegador. A Etapa
  2B moveu o progresso para a API por sessão: recarregar restaura o painel;
  reiniciar recria a sessão, zera o progresso e volta à pose inicial.
- **Conteúdo:** `content/missions/primeiro-turno.yaml`; a API serve
  `GET /api/mission`; a interface renderiza os tipos `quiz`, `motion` e
  `delivery` sem hardcode dos textos, respostas, comandos ou dicas.

## Solução opcional calibrada

Partindo da pose ao final do desafio 3 (x≈0,44, y≈0, yaw≈0):

```bash
timeout 16.5 ros2 topic pub --rate 10 /cmd_vel \
  geometry_msgs/msg/Twist "{linear: {x: 0.35}}"
timeout 2.85 ros2 topic pub --rate 10 /cmd_vel \
  geometry_msgs/msg/Twist "{angular: {z: 0.8}}"
timeout 10.0 ros2 topic pub --rate 10 /cmd_vel \
  geometry_msgs/msg/Twist "{linear: {x: 0.35}}"
```

A calibração real terminou em aproximadamente x=5,8, y=3,2, dentro da zona.
O Playwright interrompe o último comando com Ctrl+C depois de observar a
passagem pela zona em movimento, confirmando a parada e a validação de 2 s.

## Resultados finais

| Verificação | Resultado |
|---|---|
| `make stage1` | **OK**; startup **6,28 s** |
| `make stage2a` | **OK**; integração 2A OK; Playwright 2A **1 passed em 48,6 s** |
| `make e2e` | **3 passed em 2,4 min** |
| `make test-mission` | **5 testes OK** |
| `make test-api` | **2 testes OK** |
| Layout largo (1600 px) | desafio, visor e terminal lado a lado |
| Layout intermediário (1280 px) | desafio acima; visor e terminal na mesma linha |
| Layout estreito (800 px) | desafio, visor e terminal empilhados |
| Texto já digitado no prompt | inserção desabilitada; cópia disponível |
| `ros2 topic echo /odom` em execução | inserção desabilitada; Ctrl+C libera |
| Comando inserido | texto aparece sem executar; Enter executa |
| Passagem pela zona em movimento | `in_zone=true`, `delivered=false`, `v>0,02 m/s` |
| Parada dentro da zona | `delivered=true` após 2 s; tela de sucesso e gancho |
| Reinício da missão | novo container; passo 1; pose x≈0 |
| Falha de novo container | interface mostra falha e permite tentar novamente |
| Cliques repetidos no reinício | UI desabilita; API serializa |
| Telemetria antiga após reinício | descartada por geração |

Tempos do Playwright final:

- Etapa 2A: 46,9 s.
- Primeiro Turno (quatro desafios): 1,2 min.
- Falha de reinício + nova tentativa: 19,7 s.
- Total: 2,4 min, 3 testes.

## Comandos executados

```bash
make stage1
make stage2a
make e2e
```

Também foram executados:

```bash
make test-mission
make test-api
```

## Observações e limites

- A entrega continua local, em `127.0.0.1:8080`; a Etapa 2B elevou para duas
  sessões simultâneas, com reconexão, TTL e inatividade.
- A publicação pública com TLS e o isolamento de piloto continuam pendentes.
- A missão não persiste progresso entre recargas; o painel avisa isso.
- A solução completa é opcional e calibrada para a pose após o desafio 3.
- O Playwright usa `--network host` para alcançar o loopback do WSL; é um
  artefato de teste.
- O aviso KDL do link raiz com inércia permanece sem impacto.
- A falha de criação do novo container foi coberta pelo teste de unidade da
  API (`test_session_restart_failure.py`) e a falha de UI pelo Playwright com
  resposta 503 simulada. O caminho real de sucesso do reinício é exercitado no
  Playwright.
