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
- DNS de `pilot.exemplo.org` apontando para o host.
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
DOCKER_SOCKET=/run/user/<uid>/docker.sock
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

O script confere rootless, AppArmor, seccomp, DNS, portas, health, redirecionamento
HTTP, TLS e HSTS. Depois validar no navegador:

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
