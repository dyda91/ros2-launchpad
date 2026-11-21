# Resultados do piloto privado

Data: 2026-11-21.

## Escopo validado localmente

- Entrada por convite, sem cadastro.
- Código de convite único, hash no estado, cookie de acesso opaco.
- Duas sessões simultâneas; terceira sessão recebe `full`.
- Pausa e retomada de novas entradas sem derrubar sessões ativas.
- Fechamento bloqueia novas sessões.
- Eventos de missão sem conteúdo do terminal.
- Sessão com rootfs read-only, tmpfs, capabilities zero e sem rede.
- Caddyfile validado com `caddy validate`.

## Comandos executados

| Verificação | Resultado |
|---|---|
| `make test-pilot` | **5/5 OK** |
| `make pilot-acceptance` | **OK**; convite, terceiro, progresso, pausa, close e limpeza |
| `make pilot-e2e` (com `PILOT_INVITE_CODE`) | **2 passed em 21,9–22,2 s** |
| `make pilot-host-e2e` local (3 contextos, full, retry, usado, revogado e reconexão) | **1 passed em 53,4–54,5 s** |
| `make staging-expiry` | **OK**; sessão expirou, vaga liberada e container removido |
| `make stage2b` | **OK**; startup 6,69 s; Playwright 2B 2 passed |
| `make e2e` | **3 passed em 2,2–2,3 min** |
| Integração 2A | **OK** |
| Sessão read-only | **ready**; Gazebo e `/odom` funcionando |
| `docker inspect` da sessão | `ReadonlyRootfs=true`, `NetworkMode=none`, `CapDrop=[ALL]`, sem Docker |
| Caddyfile | `Valid configuration` |
| Eventos | `invite_redeemed`, `session_created`, `step_entered`, `quiz_correct`, `session_ended`; sem terminal |

## Comparação local com a Etapa 2B

| Métrica | WSL/Etapa 2B | Piloto local |
|---|---:|---:|
| Sessões simultâneas | 2 | 2 |
| Ready | 7,90 s / 6,85 s | mesmo simulador, sem regressão observada |
| RAM por sessão | ~270 MiB | ~270 MiB |
| CPU ociosa | 63–65% de um núcleo | mesma faixa |
| Terceiro navegador | full | full |
| Reconexão | OK | OK |
| Expiração | OK | OK |

## Validação no host

Preencher esta seção somente após executar o runbook em um servidor real e um
navegador externo.

| Verificação | Resultado | Pendente |
|---|---|---|
| Há A/AAAA? AAAA opcional | — | DNS |
| Certificado, SAN, emissor e validade | — | TLS |
| HTTP→HTTPS, HSTS e portas fechadas | — | DNS/host |
| `wss://` terminal e telemetria externos | — | navegador externo/Caddy |
| Três convites, lotação, retry, usado e revogado | — | host + convites |
| Rootless, AppArmor, seccomp e inspeção real | — | host |
| Tempo até `ready`, CPU e RAM com duas sessões | — | host |
| Pausa, retomada, fechamento e limpeza | — | host |
| Logs sem terminal/códigos/tokens | — | host |

Até esses itens serem executados no host, o piloto deve ser tratado como
**pronto para revisão local**, não como publicado.
