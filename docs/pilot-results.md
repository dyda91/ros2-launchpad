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
| `make stage2b` | **OK**; startup 6,24 s; Playwright 2B 2 passed |
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

## Ainda depende do host/domínio

- Validação real de rootless, AppArmor e seccomp no host escolhido.
- DNS, portas 80/443, certificado público e HSTS.
- WebSocket `wss://` através do Caddy real.
- Medição de CPU/RAM do host e comparação formal com o WSL.
- Testes de falha no host: matar container, reiniciar API/runtime/Caddy.
- Retenção e exportação dos eventos e logs do piloto.

Até esses itens serem executados no host, o piloto deve ser tratado como
**pronto para revisão local**, não como publicado.
