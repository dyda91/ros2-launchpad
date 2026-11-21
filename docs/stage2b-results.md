# Resultados da Etapa 2B — sessões simultâneas, reconexão e expiração

Data: 2026-11-21.

## Escopo entregue

A Etapa 2B local foi implementada sobre as Etapas 1, 2A e 3. Dois navegadores
anônimos podem manter sessões simultâneas, cada um com container, UDS, ROS
graph, terminal, robô, telemetria e progresso próprios. A reconexão do terminal
preserva o xterm e retoma a saída por offset; a telemetria reconecta; TTL,
inatividade, aviso e limpeza automática liberam vagas. O limite padrão é 2 e o
terceiro navegador recebe `full`.

A publicação pública com TLS, a validação contra escapes de shells anônimos e
a auditoria de piloto continuam fora desta entrega local.

## Decisões implementadas

- **Capacidade:** `MAX_SESSIONS=2` na API e no runtime. A reserva da vaga
  ocorre na API antes da criação do container, sob lock, evitando que duas
  requisições concorrentes passem do limite. O runtime repete a checagem.
- **Sessões independentes:** cada sessão recebe um ID opaco, cookie
  `HttpOnly`, token de agente, UDS em `/run/sessions/<id>/agent.sock`, nome de
  container `ros2-launchpad-session-<id>`, labels `launchpad.role=session`,
  `launchpad.session=<id>` e `launchpad.managed=true`.
- **ROS e Gazebo:** cada container usa `ROS_DOMAIN_ID` próprio (a partir de
  `SESSION_ROS_DOMAIN_ID=42`) e `GZ_PARTITION` derivado do ID, mantendo os
  grafos e a simulação isolados dentro do `network none`.
- **Progresso:** o painel envia o progresso para `PUT /api/session/progress`;
  a API guarda por sessão em memória, valida tamanho e tipos, e o devolve em
  `GET /api/session`. Recarregar a página restaura o desafio, seleção, dicas,
  pose de referência e estado de movimento. Reiniciar zera o progresso.
- **Reconexão do terminal:** o agente mantém um buffer circular de 128 KiB e
  offsets de bytes. Ao reconectar, o navegador envia `since`; o agente envia
  `stream_start`, o trecho que falta e o estado do shell. Se o offset já saiu
  do buffer, envia `reset` e os últimos 128 KiB. O xterm só é limpo no
  `reset`; na reconexão normal ele é preservado.
- **Conexões:** o terminal e a telemetria reconectam automaticamente enquanto
  a sessão estiver `ready`. A telemetria também entrega eventos de ciclo de
  vida com prazos restantes e aviso.
- **Expiração:** TTL total de 1800 s, inatividade de 600 s e aviso 120 s antes.
  Criar, retomar, recarregar, conectar o terminal, digitar, inserir, redimensionar,
  responder quiz/previsão, dica, solução, progresso, toque explícito e
  reinício contam como atividade. Telemetria contínua não conta.
- **Limpeza:** na expiração, a sessão sai do mapa ativo, o container e a UDS
  são removidos e a vaga é liberada. O cookie expirado permanece como
  tombstone curto para mostrar `expired`; iniciar novamente cria outro ID.
- **Reinício:** o reinício mantém a mesma vaga e a mesma tag de sessão, mas
  recria o container, a UDS, o token, a pose e o progresso.
- **Falhas:** se o container não subir, a API retorna erro, a sessão fica em
  `error` para diagnóstico e a UI oferece nova tentativa. Na inicialização, a
  API tenta reconciliar o runtime por até 60 s antes de falhar, cobrindo a
  ordem de reinício do Compose.
- **Reconciliação:** ao iniciar a API ou o runtime, sessões ativas da execução
  anterior são encerradas, containers órfãos com label são removidos e as
  vagas são liberadas. Não há recuperação de sessão após reiniciar a API ou o
  runtime.
- **Aceite acelerado:** `make stage2b` usa 90 s de TTL, 15 s de inatividade,
  5 s de aviso e monitor de 1 s. O padrão local continua 1800/600/120 s.

## Contratos adicionados

```text
GET    /api/health                 {api, runtime, session, active, max}
POST   /api/session/touch          204 | 409
PUT    /api/session/progress       204 | 400 | 409
GET    /api/session                inclui progress e lifecycle
WS     /ws/telemetry               state, pose, mission e lifecycle
WS     /ws/terminal?since=<bytes>  resume por offset
```

```text
GET    /v1/sessions                lista sessões gerenciadas
GET    /v1/sessions/{id}           status do container
POST   /v1/reconcile              remove órfãos e libera vagas
DELETE /v1/sessions/{id}           remove container e diretório
Authorization: Bearer RUNTIME_TOKEN
```

## Resultados finais

| Verificação | Resultado |
|---|---|
| `make stage2b` (completo) | **OK**; integração com duas sessões, terceiro `full`, progresso isolado, aviso/expiração, nova sessão, reinício e limpeza |
| Playwright 2B | **2 passed em 1,2 min** |
| `make measure-2b` | sessão A **7,90 s**, sessão B **6,85 s**; 2 ativas e `max=2` |
| Consumo das sessões | ~**270 MiB** e **63–65%** de um núcleo cada, ociosas |
| `make test-session-capacity` | **8 testes OK** |
| `make test-api` | **2 testes OK** |
| `make e2e` (2A + 3) | **3 passed em 2,3 min** |
| `make stage1` | **OK**; startup **6,63–6,79 s** |
| Integração 2A | **OK** após os containers passarem a ter nome único |
| Terceiro navegador | `full`, sem container criado |
| Duas sessões | containers, UDS, tags e progressos distintos |
| Recarregar a página | mesma tag, mesmo desafio, progresso e terminal com replay |
| Queda do WebSocket do terminal | reconexão automática e comando seguinte executado |
| Inatividade | aviso visível, `expired`, container removido e vaga liberada |
| Reinício | mesma tag, passo 1, pose x≈0 e progresso zerado |
| Encerrar duas sessões | containers e diretórios removidos; `idle` |

## Observações

- O Playwright 2B abre dois contextos isolados, reproduz a terceira vaga cheia,
  recarrega uma sessão e força o fechamento do WebSocket do terminal para
  validar a reconexão. O teste de inatividade usa os prazos curtos do alvo.
- O `make stage2b` é separado do `make e2e`: o primeiro precisa de prazos
  curtos, enquanto o segundo mantém os padrões longos.
- As sessões continuam sem rede externa, sem socket Docker, com UID 1000,
  `cap_drop: ALL`, `no-new-privileges`, 2 GiB, 2 CPUs e 256 PIDs.
- O WSL tem 7,7 GiB; duas sessões ocuparam cerca de 540 MiB de RSS somado aos
  containers e não houve falha de recurso no aceite.
- A publicação, TLS, autenticação de visitantes e isolamento reforçado para
  shells anônimos continuam pendentes antes de qualquer piloto público.
