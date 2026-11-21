# Runbook do piloto privado

## Estado

O piloto privado está implementado para execução local e em host Linux. A
validação em domínio público depende do host e do DNS escolhidos; neste
repositório ficam os templates de Caddy, Compose, systemd e operação.

O acesso é por convite, sem cadastro: o convidado recebe um código, troca por
um cookie de acesso e inicia uma sessão anônima normal. O código nunca vai na
URL, no log ou no frontend depois do resgate.

## Host recomendado

- VM Linux dedicada com **Ubuntu Server 24.04 LTS x86_64**.
- 8 vCPU, 16 GiB de RAM e 80 GB SSD.
- Docker Engine/Compose em **rootless**; `uidmap`, `newuidmap`, `newgidmap`,
  `subuid`/`subgid` e user namespaces habilitados.
- Caddy 2 no host, com portas 80/443; API apenas em `127.0.0.1:8080`.
- DNS de `pilot.exemplo.org` apontando para o host; A é obrigatório e AAAA é
  opcional conforme a disponibilidade de IPv6.
- SSH por chave, root desabilitado, firewall fechado exceto 22, 80 e 443.
- Sem GPU, GUI, WSL, X11 ou RViz.

Se rootless não for viável, usar uma VM dedicada com `userns-remap`; não usar
Docker rootful em host compartilhado.

## Instalação

1. Instalar Docker rootless e Caddy conforme a documentação oficial.
2. Confirmar:

```bash
docker info --format '{{json .SecurityOptions}}'
aa-status
uname -r
nproc
free -h
```

3. Clonar o repositório em `/srv/launchpad`.
4. Criar `/etc/launchpad/pilot.env` com base em `deploy/pilot.env.example`,
   modo `0600`, dono do usuário que opera o Docker rootless.
5. Criar os diretórios:

```bash
sudo install -d -m 0775 -o "$USER" -g "$USER" /srv/launchpad/run/sessions
sudo install -d -m 0775 -o "$USER" -g "$USER" /srv/launchpad/run/pilot
```

6. Copiar `deploy/Caddyfile` para `/etc/caddy/Caddyfile` e definir
   `PILOT_DOMAIN` e `PILOT_API_PORT=8080` em `/etc/caddy/pilot.env`. Em rootless, garanta que
   `/srv/launchpad/run/pilot` seja gravável pelo UID mapeado do container da
   API; valide com `docker compose exec -u 1000 -T api test -w
   /var/lib/launchpad/pilot`. Se não for, ajuste a propriedade do bind ou use
   um volume preparado antes de iniciar.
7. Instalar `deploy/systemd/ros2-launchpad.service` como serviço de usuário
   (rootless) e `deploy/systemd/caddy-override.conf` no serviço do Caddy.
8. Validar e iniciar:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl restart caddy
systemctl --user daemon-reload
systemctl --user enable --now ros2-launchpad.service
loginctl enable-linger "$USER"
```

9. Subir o piloto a partir de `/srv/launchpad`:

```bash
set -a
source /etc/launchpad/pilot.env
set +a
make pilot-up
```

10. Executar `make pilot-verify` e os testes de interface.

## Configuração essencial

```text
PUBLIC_ORIGINS=https://pilot.exemplo.org
COOKIE_SECURE=true
MAX_SESSIONS=2
HOST_RUN_DIR=/srv/launchpad/run/sessions
RUN_HOST_DIR=run/sessions
PILOT_HOST_DIR=run/pilot
DOCKER_SOCKET=/run/user/<uid>/docker.sock
SESSION_PROJECT=launchpad
SESSION_READ_ONLY=true
SESSION_APPARMOR=docker-default
PILOT_ENABLED=true
PILOT_STATE_DIR=/var/lib/launchpad/pilot
PILOT_TRUST_FORWARDED=true
```

O `compose.pilot.yaml` ativa o convite, monta `run/pilot` e aplica o hardening.
O Caddy termina TLS e faz o upgrade de WebSocket; o navegador usa
`wss://` automaticamente porque `apps/web/src/lib/api.ts` escolhe o protocolo
pela página.

## Convites e controle

Dentro do host, com o ambiente carregado:

```bash
make pilot-admin ARGS="invite --label guest-1 --ttl 7200"
make pilot-admin ARGS="list"
make pilot-admin ARGS="pause"
make pilot-admin ARGS="resume"
make pilot-admin ARGS="close"
make pilot-admin ARGS="events"
make pilot-admin ARGS="events-session --session <tag>"
```

O comando `invite` imprime o código uma única vez. O estado guarda só o hash.
`pause` bloqueia novos resgates e novas sessões, mas mantém as sessões ativas.
`close` fecha novas entradas, revoga os convites, aguarda a carência
configurada e remove containers e UDS. Use `scripts/pilot-admin.sh close --now`
em emergência.

Em produção, não expor o CLI pela web. Ele roda por SSH e escreve no volume
`run/pilot`.

## Verificação

```bash
make pilot-verify
```

O script confere rootless, AppArmor, seccomp, DNS A (AAAA é opcional),
portas, health, redirecionamento HTTP, hostname/SAN/emissor/validade do
certificado e HSTS. Com duas sessões ativas, inspecione o perfil efetivo:

```bash
make pilot-inspect
```

O inspector lê `docker inspect` de cada container do projeto, mostra
`ReadonlyRootfs`, rede, capabilities, AppArmor, seccomp, tmpfs, ulimits,
usuário, binds e executa probes somente leitura dentro da sessão. Ele não lê
o conteúdo do terminal. Depois validar no navegador:

1. Entrar com o convite.
2. Iniciar e aguardar “Pronto”.
3. Ver terminal, visor e telemetria.
4. Recarregar: o terminal e o progresso devem voltar.
5. Fechar o WebSocket do terminal: ele deve reconectar.
6. Abrir uma segunda sessão; a terceira deve receber “Laboratório cheio”.
7. Pausar novas entradas e confirmar que as sessões ativas continuam.
8. Encerrar o piloto e confirmar a limpeza.

## Hardening esperado

A sessão deve ser inspecionada com:

```bash
docker inspect <container> --format '{{json .HostConfig}}'
```

Conferir `ReadonlyRootfs=true`, `NetworkMode=none`, `Privileged=false`,
`CapDrop=[ALL]`, `SecurityOpt` com `no-new-privileges` e AppArmor,
`PidsLimit=256`, 2 GiB/2 CPUs, sem socket Docker e com somente o bind da UDS.

Dentro da sessão:

```bash
id
grep CapEff /proc/self/status
ip -brief addr
getent hosts example.com
test ! -e /var/run/docker.sock
```

Esperado: UID 1000, capabilities zero, somente `lo`, DNS/rede externa
bloqueados, sem Docker. A entrada do terminal não deve aparecer em nenhum log.

## Roteiro de convidados

| Tempo | Atividade |
|---|---|
| 0–2 min | Enviar convite, explicar que é temporário e real |
| 2–5 min | Entrar, iniciar, aguardar “Pronto”, localizar as áreas |
| 5–15 min | Quatro desafios, pensando em voz alta |
| 15–18 min | Entrega, sucesso e gancho final |
| 18–20 min | Encerrar/expirar e feedback curto |

O observador registra apenas o desafio alcançado, dicas usadas, uso de
copiar/inserir, tempo e comentários. Não pedir comandos ou saída do terminal.
Não habilitar gravação de tela sobre o terminal.

## Encerramento

1. `pause` para novas entradas.
2. Avisar os convidados.
3. Exportar `events.jsonl` e os logs de acesso.
4. `close` (ou `close --now`).
5. Confirmar:

```bash
docker ps -a --filter label=launchpad.role=session
find /srv/launchpad/run/sessions -mindepth 1 -maxdepth 1
```

6. Revogar convites, remover `/etc/launchpad/pilot.env` se o piloto terminar e
   rotacionar tokens. Não apagar eventos antes de exportar.

## Referências oficiais

- Docker rootless: <https://docs.docker.com/engine/security/rootless/>
- Docker userns-remap: <https://docs.docker.com/engine/security/userns-remap/>
- Seccomp: <https://docs.docker.com/engine/security/seccomp/>
- AppArmor: <https://docs.docker.com/engine/security/apparmor/>
- Recursos: <https://docs.docker.com/engine/containers/resource_constraints/>
- `docker run`: <https://docs.docker.com/reference/cli/docker/container/run/>
- Socket Docker: <https://docs.docker.com/engine/security/protect-access/>
- Caddy HTTPS: <https://caddyserver.com/docs/automatic-https>
- Caddy proxy/WebSocket: <https://caddyserver.com/docs/caddyfile/directives/reverse_proxy>
- Caddy logs: <https://caddyserver.com/docs/caddyfile/directives/log>

## Aceite no host real

### Antes de começar

Confirme que o host está com rootless, Caddy e DNS já validados. Não execute
`make stage2b`, `make measure-2b` ou `make pilot-acceptance` durante um piloto
ativo: esses comandos limpam sessões e reiniciam a aplicação. Use-os apenas em
janela de manutenção ou no staging isolado.

### Operações administrativas no host

O CLI é separado do Playwright externo. Os códigos são exibidos apenas uma vez
e não devem ser colocados em arquivos do repositório, logs compartilháveis ou
capturas de tela.

```bash
set -a
source /etc/launchpad/pilot.env
set +a

make pilot-admin ARGS="invite --label host-a --ttl 1800"
make pilot-admin ARGS="invite --label host-b --ttl 1800"
make pilot-admin ARGS="invite --label host-c --ttl 1800"
make pilot-admin ARGS="invite --label host-revoked --ttl 1800"
make pilot-admin ARGS="revoke <id-do-host-revoked>"
```

Também é possível usar `make pilot-admin ARGS="list"` para localizar o ID do
convite revogado. Entregue os códigos A, B e C ao operador do navegador externo
por canal privado. O código revogado serve apenas para o teste negativo.

### Playwright externo

Execute em uma máquina fora do host, com os códigos apenas em variáveis de
ambiente:

```bash
export PILOT_BASE_URL="https://pilot.exemplo.org"
export PILOT_INVITE_A="<código A>"
export PILOT_INVITE_B="<código B>"
export PILOT_INVITE_C="<código C>"
export PILOT_INVITE_REVOKED="<código revogado>"
make pilot-host-e2e
```

O teste `host-pilot.spec.ts`:

- usa três contextos e três convites válidos;
- verifica convite inválido, usado e revogado;
- inicia A e B, confirma dois `wss://` de terminal/telemetria quando a URL é
  HTTPS;
- abre C com convite válido e confirma `full`, sem criar sessão;
- encerra A e confirma que C consegue tentar novamente e iniciar quando a vaga
  é liberada;
- força a queda do WebSocket do terminal e valida a reconexão.

Ele não cria, revoga ou pausa convites. Essas ações são feitas pelo CLI no
host. Não habilite trace, screenshot ou vídeo: o teste já desliga artefatos.
O Playwright mantém artefatos desligados por padrão; use
`PILOT_E2E_ARTIFACTS=1` somente em uma reprodução local e apague o resultado
antes de compartilhar.

Para testar localmente o mesmo spec via loopback, use:

```bash
PILOT_BASE_URL=http://127.0.0.1:8080 PILOT_HOST_NETWORK=1 \
  PILOT_INVITE_A="..." PILOT_INVITE_B="..." \
  PILOT_INVITE_C="..." PILOT_INVITE_REVOKED="..." \
  make pilot-host-e2e
```

### Lotação sem container novo

Com A e B ativos, antes e depois de abrir o terceiro contexto:

```bash
docker ps -q --filter label=launchpad.role=session \
  --filter label=launchpad.project=launchpad | wc -l
```

O resultado deve permanecer `2`; C deve mostrar “As duas vagas estão em uso” e
não deve aparecer um terceiro container.

### Sequência CLI → navegador

| Ação no host | Efeito observado no navegador |
|---|---|
| `make pilot-admin ARGS="pause"` | Sessões ativas mostram o aviso “O piloto pausou novas entradas”; uma nova entrada recebe recusa; A/B continuam `ready` |
| `make pilot-admin ARGS="resume"` | O aviso desaparece na próxima atualização de ciclo de vida; uma nova entrada volta a ser aceita quando houver vaga |
| `make pilot-admin ARGS="close"` | Novas entradas recebem “piloto encerrado”; sessões ativas são encerradas após a carência; containers, UDS e `run/sessions` são removidos |
| `make pilot-admin ARGS="close --now"` | Mesmo efeito, sem carência |

Durante o fechamento, o Caddy permanece com TLS; a API pode responder erro até
ser parada pelo compose. Registre o estado final de Caddy/API/runtime.

### Staging curto

O staging usa projeto, estado, sockets e portas próprios:

Expiração automática:

```bash
make staging-expiry
```

Ele sobe o staging, cria a sessão, aguarda a inatividade curta (30 s, TTL
120 s), confirma `expired`, vaga livre e container removido, e derruba o
staging. Usa `run/staging`, labels `launchpad.project=staging` e a porta
`18080`; não interfere nas sessões de `run/sessions`.

Operação manual do staging:

```bash
make staging-up
make staging-admin ARGS="invite --label staging-manual --ttl 300"
make staging-admin ARGS="list"
make staging-down
```

### Medição de CPU/RAM

Com duas sessões ativas e ociosas, colher três amostras no host:

```bash
docker stats --no-stream --format \
  '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' \
  $(docker ps -q --filter label=launchpad.role=session \
    --filter label=launchpad.project=launchpad)
```

Registrar também API, runtime e Caddy:

```bash
docker stats --no-stream --format \
  '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' \
  ros2-launchpad-api ros2-launchpad-runtime
```

O tempo até `ready` deve ser observado no navegador externo (marcar o início
no `POST /api/session` e o fim no estado “Pronto”), sem medir telemetria ou
conteúdo do terminal. Para uma medição automatizada, usar o teste externo já
executando e repetir as amostras depois que A/B estiverem prontos.

### O que registrar em `docs/pilot-results.md`

Preencher a seção “Validação no host” com:

- data, commit, host, kernel, CPU/RAM/disco, Docker, Caddy;
- A/AAAA e resolvedor externo; AAAA ausente é aceitável;
- emissor, SAN, validade e `checkhost` do certificado;
- health, redirect, HSTS e portas fechadas;
- URLs `wss://` observadas no navegador externo;
- tags de A/B, tempo até `ready`, CPU/RAM de duas sessões;
- resultado de convite inválido, usado, revogado e terceiro `full`;
- contagem de containers antes/depois do terceiro;
- reconexão, pausa, retomada, fechamento e limpeza;
- ausência de conteúdo do terminal, cookies, tokens e códigos nos logs;
- pendências e falhas.

Não registrar códigos, cookies, tokens, IPs de convidados ou saída do terminal.
Os resultados de DNS, TLS, WSS externo, isolamento efetivo e métricas do host
permanecem **pendentes** até serem medidos no servidor real.
