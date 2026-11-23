import { useCallback, useEffect, useRef, useState } from "react";

import MissionPanel from "./components/MissionPanel";
import PilotGate from "./components/PilotGate";
import Terminal, { type TerminalHandle } from "./components/Terminal";
import WarehouseViewer from "./components/WarehouseViewer";
import {
  endSession,
  getMap,
  getMission,
  getSession,
  restartSession,
  saveProgress,
  startSession,
  touchSession,
  wsUrl
} from "./lib/api";
import type {
  CourseGuide,
  InsertResult,
  MapData,
  MissionContent,
  MissionProgress,
  MissionStatus,
  Pose,
  ScanData,
  SessionStatus,
  TerminalCommand,
  TerminalState
} from "./types";

const stageLabels: Record<string, string> = {
  creating: "Criando o ambiente",
  starting: "Iniciando o simulador",
  waiting_odom: "Aguardando a odometria",
  ready: "Pronto",
  restarting: "Reiniciando a missão"
};

function missionStatusFromMessage(message: Record<string, unknown>) {
  if (typeof message.delivered !== "boolean") {
    return null;
  }
  return {
    zoneId: String(message.zone_id ?? "coleta"),
    inZone: Boolean(message.in_zone),
    speedMps: Number(message.speed_mps ?? 0),
    angularSpeedRps: Number(message.angular_speed_rps ?? 0),
    stoppedForS: Number(message.stopped_for_s ?? 0),
    delivered: Boolean(message.delivered),
    pose: (message.pose ?? null) as MissionStatus["pose"]
  };
}

function statusLabel(state: SessionStatus["state"]) {
  switch (state) {
    case "idle":
      return "Pronto para começar";
    case "preparing":
      return "Preparando";
    case "ready":
      return "Pronto";
    case "full":
      return "Laboratório em uso";
    case "error":
      return "Falha";
    case "expired":
      return "Sessão expirada";
    case "invite_required":
      return "Convite necessário";
    case "pilot_paused":
      return "Piloto pausado";
    case "pilot_closed":
      return "Piloto encerrado";
    default:
      return "Pronto para começar";
  }
}

export default function App() {
  const [session, setSession] = useState<SessionStatus>({ state: "idle" });
  const [map, setMap] = useState<MapData | null>(null);
  const [mission, setMission] = useState<MissionContent | null>(null);
  const [missionStatus, setMissionStatus] = useState<MissionStatus | null>(null);
  const [pose, setPose] = useState<Pose | null>(null);
  const [scan, setScan] = useState<ScanData | null>(null);
  const [showLidar, setShowLidar] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [follow, setFollow] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [clearTrailToken, setClearTrailToken] = useState(0);
  const [terminalState, setTerminalState] = useState<TerminalState | null>(null);
  const [insertNotice, setInsertNotice] = useState("");
  const [lastCommand, setLastCommand] = useState<TerminalCommand | null>(null);
  const [guide, setGuide] = useState<CourseGuide | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const terminalRef = useRef<TerminalHandle>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    let alive = true;
    getSession()
      .then((status) => {
        if (alive) {
          setSession(status);
        }
      })
      .catch(() => {
        if (alive) {
          setSession({
            state: "error",
            error: "não foi possível consultar o laboratório"
          });
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    getMission()
      .then((content) => {
        if (alive) {
          setMission(content);
        }
      })
      .catch((error: Error) => {
        if (alive) {
          setNotice(error.message);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (session.state !== "preparing" || restarting) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const status = await getSession();
        setSession(status);
      } catch {
        setSession({
          state: "error",
          error: "não foi possível acompanhar a preparação"
        });
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [session.state, restarting]);

  useEffect(() => {
    if (session.state !== "ready") {
      return;
    }
    void touchSession().catch(() => undefined);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void touchSession().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session.state]);

  useEffect(() => {
    if (session.state !== "ready") {
      return;
    }
    let alive = true;
    getMap()
      .then((data) => {
        if (alive) {
          setMap(data);
        }
      })
      .catch((error: Error) => {
        if (alive) {
          setNotice(error.message);
        }
      });
    return () => {
      alive = false;
    };
  }, [session.state]);

  useEffect(() => {
    if (session.state !== "ready") {
      return;
    }
    let alive = true;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    const generation = generationRef.current;

    function scheduleReconnect() {
      if (!alive || timer !== null) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = null;
        connect();
      }, 1200);
    }

    function applyLifecycle(message: Record<string, unknown>) {
      const state = String(message.state ?? "");
      if (state === "expired") {
        setSession({ state: "expired" });
        return;
      }
      if (
        state !== "preparing" &&
        state !== "ready" &&
        state !== "error"
      ) {
        return;
      }
      setSession((previous) => ({
        ...previous,
        state,
        error:
          state === "error"
            ? previous.error ?? "a sessão não está mais disponível"
            : previous.error,
        pilot_state:
          typeof message.pilot_state === "string"
            ? (message.pilot_state as SessionStatus["pilot_state"])
            : previous.pilot_state,
        lifecycle: {
          idle_expires_in: Number(message.idle_expires_in ?? 0),
          hard_expires_in: Number(message.hard_expires_in ?? 0),
          warning: Boolean(message.warning)
        }
      }));
    }

    function connect() {
      if (!alive) {
        return;
      }
      socket = new WebSocket(wsUrl("/ws/telemetry"));
      socket.onmessage = (event) => {
        if (generationRef.current !== generation) {
          return;
        }
        try {
          const message = JSON.parse(event.data as string) as Record<
            string,
            unknown
          >;
          if (message.type === "pose") {
            setPose(message as unknown as Pose);
          }
          if (message.type === "mission") {
            const status = missionStatusFromMessage(message);
            if (status !== null) {
              setMissionStatus(status);
            }
          }
          if (message.type === "scan") {
            setScan(message as unknown as ScanData);
          }
          if (message.type === "lifecycle") {
            applyLifecycle(message);
          }
          if (message.type === "state" && message.state === "error") {
            setSession((previous) => ({
              ...previous,
              state: "error",
              error: "o simulador encerrou inesperadamente"
            }));
          }
        } catch {
          return;
        }
      };
      socket.onclose = (event) => {
        if (!alive) {
          return;
        }
        if ([4401, 4403, 4409].includes(event.code)) {
          getSession()
            .then((status) => {
              if (alive) {
                setSession(status);
              }
            })
            .catch(() => undefined);
          return;
        }
        scheduleReconnect();
      };
    }

    connect();
    return () => {
      alive = false;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      socket?.close();
    };
  }, [session.state]);

  const handleProgressChange = useCallback(
    (progress: MissionProgress) => {
      void saveProgress(progress).catch(() => undefined);
    },
    []
  );

  async function handleRedeem() {
    setBusy(true);
    setNotice("");
    try {
      const status = await getSession();
      setSession(status);
      if (status.state === "invite_required") {
        setNotice("o convite não foi reconhecido; tente novamente");
      }
    } catch {
      setNotice("não foi possível abrir a sessão após o convite");
    } finally {
      setBusy(false);
    }
  }

  function handleTerminalState(state: TerminalState) {
    setTerminalState(state);
  }

  function handleCommand(command: TerminalCommand) {
    setLastCommand(command);
  }

  function handleInsertResult(result: InsertResult) {
    setInsertNotice(
      result.ok
        ? "Comando inserido. Pressione Enter no terminal."
        : `Não foi possível inserir: ${result.reason}. Use Copiar.`
    );
  }

  function handleInsert(command: string) {
    setInsertNotice("");
    terminalRef.current?.insert(command);
    terminalRef.current?.focus();
  }

  function handleInterrupt() {
    terminalRef.current?.interrupt();
  }

  function focusCourse() {
    terminalRef.current?.blur();
    document
      .querySelector<HTMLElement>('[data-testid="mission-panel"]')
      ?.focus();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "e"
      ) {
        event.preventDefault();
        focusCourse();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handleStart() {
    generationRef.current += 1;
    setBusy(true);
    setNotice("");
    setMissionStatus(null);
    setTerminalState(null);
    setLastCommand(null);
    setInsertNotice("");
    setScan(null);
    try {
      const status = await startSession();
      setSession(status);
      if (status.state === "error") {
        setNotice(status.error ?? "não foi possível iniciar o simulador");
      }
      if (status.state === "full") {
        setNotice("encerre a sessão aberta em outro navegador");
      }
    } catch {
      setSession({
        state: "error",
        error: "não foi possível iniciar o laboratório"
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRestart() {
    if (busy || restarting) {
      return;
    }
    generationRef.current += 1;
    setBusy(true);
    setRestarting(true);
    setNotice("");
    setSession({ state: "preparing", stage: "restarting" });
    setMap(null);
    setPose(null);
    setScan(null);
    setMissionStatus(null);
    setTerminalState(null);
    setLastCommand(null);
    setInsertNotice("");
    try {
      const status = await restartSession();
      setSession(status);
      if (status.state === "error") {
        setNotice(status.error ?? "não foi possível reiniciar o laboratório");
      }
    } catch {
      setSession({
        state: "error",
        error: "não foi possível reiniciar o laboratório"
      });
    } finally {
      setBusy(false);
      setRestarting(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    try {
      const status = await getSession();
      setSession(status);
    } catch {
      setNotice("não foi possível consultar o laboratório");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    generationRef.current += 1;
    setBusy(true);
    setMap(null);
    setPose(null);
    setScan(null);
    setMissionStatus(null);
    setTerminalState(null);
    setLastCommand(null);
    setInsertNotice("");
    try {
      await endSession();
      try {
        setSession(await getSession());
      } catch {
        setSession({ state: "idle" });
      }
    } catch {
      setSession({ state: "idle" });
    } finally {
      setBusy(false);
    }
  }

  const speed = Math.abs(pose?.vx ?? 0);
  const scanPoints =
    scan?.ranges.filter(
      (value) => value !== null && value > scan.range_min
    ).length ?? 0;
  const stage = session.stage ? stageLabels[session.stage] ?? session.stage : "";

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">ROS 2 Launchpad</div>
          <h1>Primeiro Turno</h1>
        </div>
        <div className="topbar-actions">
          <span
            className={`status-pill status-${session.state}`}
            data-testid="session-state"
            data-state={session.state}
          >
            {statusLabel(session.state)}
          </span>
          {session.state === "ready" ? (
            <button
              className="button button-secondary"
              onClick={handleEnd}
              disabled={busy}
              data-testid="end-button"
            >
              Encerrar sessão
            </button>
          ) : null}
        </div>
      </header>

      {session.state === "invite_required" ? (
        <PilotGate onRedeemed={handleRedeem} />
      ) : null}

      {session.state === "pilot_paused" ? (
        <main className="landing">
          <div className="landing-card">
            <p className="eyebrow">Piloto privado</p>
            <h2>Novas entradas estão pausadas</h2>
            <p>
              O laboratório está temporariamente fechado para novos
              convidados. As sessões já iniciadas continuam até o limite de
              tempo ou inatividade.
            </p>
            <button
              className="button button-secondary"
              onClick={handleRefresh}
              disabled={busy}
            >
              Verificar novamente
            </button>
          </div>
        </main>
      ) : null}

      {session.state === "pilot_closed" ? (
        <main className="landing">
          <div className="landing-card">
            <p className="eyebrow">Piloto privado</p>
            <h2>O piloto foi encerrado</h2>
            <p>
              O laboratório não está aceitando novas sessões. Obrigado por
              participar.
            </p>
          </div>
        </main>
      ) : null}

      {session.state === "idle" ? (
        <main className="landing">
          <div className="landing-card">
            <p className="eyebrow">Laboratório local</p>
            <h2>Um robô, um armazém e um terminal Linux real.</h2>
            <p>
              Inicie uma sessão anônima, abra o terminal no navegador e veja o
              robô se mover no visor 2D. Não é necessário cadastro.
            </p>
            <button
              className="button button-primary"
              onClick={handleStart}
              disabled={busy}
              data-testid="start-button"
            >
              Iniciar laboratório
            </button>
            <p className="small">
              O simulador leva alguns segundos para ficar pronto. O acesso é
              publicado apenas em localhost.
            </p>
          </div>
        </main>
      ) : null}

      {session.state === "preparing" ? (
        <main className="landing">
          <div className="landing-card">
            <div className="spinner" />
            <h2>Preparando seu laboratório</h2>
            <p>{stage || "Iniciando o simulador e aguardando a odometria."}</p>
            <p className="small">
              A página será atualizada automaticamente quando o robô estiver
              pronto.
            </p>
            <button
              className="button button-secondary"
              onClick={handleEnd}
              disabled={busy}
            >
              Cancelar
            </button>
          </div>
        </main>
      ) : null}

      {session.state === "full" ? (
        <main className="landing">
          <div className="landing-card">
            <p className="eyebrow">Laboratório cheio</p>
            <h2>As duas vagas estão em uso</h2>
            <p>
              Esta entrega permite dois navegadores anônimos simultâneos.
              Encerre uma sessão aberta em outro navegador ou tente novamente
              mais tarde.
            </p>
            <button
              className="button button-primary"
              onClick={handleRefresh}
              disabled={busy}
            >
              Verificar novamente
            </button>
          </div>
        </main>
      ) : null}

      {session.state === "expired" ? (
        <main className="landing">
          <div className="landing-card">
            <p className="eyebrow">Sessão expirada</p>
            <h2>O tempo ou a inatividade encerraram o laboratório</h2>
            <p>
              O robô e o terminal desta sessão foram encerrados. Inicie uma
              nova sessão para continuar; a missão começa do primeiro desafio.
            </p>
            <button
              className="button button-primary"
              onClick={handleStart}
              disabled={busy}
              data-testid="expired-start-button"
            >
              Iniciar nova sessão
            </button>
          </div>
        </main>
      ) : null}

      {session.state === "error" ? (
        <main className="landing">
          <div className="landing-card">
            <p className="eyebrow">Falha na sessão</p>
            <h2>Não foi possível preparar o laboratório</h2>
            <p>{notice || session.error || "tente novamente"}</p>
            <div className="button-row">
              <button
                className="button button-primary"
                onClick={handleStart}
                disabled={busy}
              >
                Tentar novamente
              </button>
              <button
                className="button button-secondary"
                onClick={handleEnd}
                disabled={busy}
              >
                Encerrar
              </button>
            </div>
          </div>
        </main>
      ) : null}

      {session.state === "ready" ? (
        <main
          className="workspace mission-workspace"
          onClick={() => terminalRef.current?.focus()}
        >
          {mission !== null ? (
            <MissionPanel
              mission={mission}
              pose={pose}
              scan={scan}
              missionStatus={missionStatus}
              terminalState={terminalState}
              lastCommand={lastCommand}
              insertNotice={insertNotice}
              busy={busy}
              restarting={restarting}
              initialProgress={session.progress}
              onInsert={handleInsert}
              onRestart={handleRestart}
              onProgressChange={handleProgressChange}
              onGuideChange={setGuide}
            />
          ) : (
            <aside className="panel mission-panel">
              <div className="mission-body">
                <p className="eyebrow">Missão</p>
                <h2>Carregando o Primeiro Turno...</h2>
                {notice ? <p>{notice}</p> : null}
              </div>
            </aside>
          )}

          {session.pilot_state === "paused" ||
          session.pilot_state === "closed" ? (
            <div className="pilot-notice" data-testid="pilot-notice">
              {session.pilot_state === "paused"
                ? "O piloto pausou novas entradas; sua sessão atual continua."
                : "O piloto foi encerrado; esta sessão será encerrada em breve."}
            </div>
          ) : null}
          {session.lifecycle?.warning ? (
            <div className="lifecycle-warning" data-testid="lifecycle-warning">
              {session.lifecycle.idle_expires_in <=
              session.lifecycle.hard_expires_in
                ? `Sessão expira por inatividade em ${Math.ceil(
                    session.lifecycle.idle_expires_in
                  )} s.`
                : `Tempo total da sessão termina em ${Math.ceil(
                    session.lifecycle.hard_expires_in
                  )} s.`}
            </div>
          ) : null}
          <div className="right-stack">
          <section className="panel viewport-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Visor de cima</p>
                <h2>Armazém</h2>
              </div>
              <div className="viewport-actions">
                <button
                  className="button button-secondary button-small"
                  onClick={() => setZoom((value) => Math.max(1, Math.round((value - 0.25) * 100) / 100))}
                  data-testid="zoom-out"
                  aria-label="Diminuir zoom"
                >
                  −
                </button>
                <span className="zoom-value" data-testid="zoom-value">
                  {zoom.toFixed(2)}x
                </span>
                <button
                  className="button button-secondary button-small"
                  onClick={() => setZoom((value) => Math.min(6, Math.round((value + 0.25) * 100) / 100))}
                  data-testid="zoom-in"
                  aria-label="Aumentar zoom"
                >
                  +
                </button>
                <button
                  className="button button-secondary button-small"
                  onClick={() => {
                    setZoom(1);
                    setFollow(false);
                    setResetToken((value) => value + 1);
                  }}
                  data-testid="recenter"
                >
                  Centralizar
                </button>
                <button
                  className={`button button-small ${follow ? "button-secondary" : "button-ghost"}`}
                  onClick={() => setFollow((value) => !value)}
                  data-testid="follow-robot"
                  data-enabled={follow}
                >
                  Seguir robô
                </button>
                <button
                  className="button button-ghost button-small"
                  onClick={() => setClearTrailToken((value) => value + 1)}
                  data-testid="clear-trail"
                >
                  Limpar rastro
                </button>
                <button
                  className={`button button-small ${showLidar ? "button-secondary" : "button-ghost"}`}
                  onClick={() => setShowLidar((visible) => !visible)}
                  data-testid="lidar-toggle"
                  data-enabled={showLidar}
                >
                  LiDAR {showLidar ? "ligado" : "desligado"}
                </button>
                <span className="panel-note">referencial odom</span>
              </div>
            </div>
            <div className="viewport">
              {map !== null ? (
                <div
                  className="viewport-inner"
                  data-testid="robot-pose"
                  data-x={pose?.x ?? 0}
                  data-y={pose?.y ?? 0}
                  data-yaw={pose?.yaw ?? 0}
                  data-speed={speed}
                  data-scan-points={scanPoints}
                  data-scan-stamp={scan?.stamp ?? 0}
                  data-scan-pose-x={scan?.pose?.x ?? pose?.x ?? 0}
                  data-scan-pose-y={scan?.pose?.y ?? pose?.y ?? 0}
                  data-scan-pose-yaw={scan?.pose?.yaw ?? pose?.yaw ?? 0}
                  data-scan-pose-stamp={scan?.pose?.stamp ?? 0}
                  data-zoom={zoom}
                >
                  <WarehouseViewer
                    map={map}
                    pose={pose}
                    scan={scan}
                    showLidar={showLidar}
                    zoom={zoom}
                    follow={follow}
                    resetToken={resetToken}
                    clearTrailToken={clearTrailToken}
                    missionStatus={missionStatus}
                    guide={guide}
                    onZoomChange={setZoom}
                    onFollowChange={setFollow}
                  />
                </div>
              ) : (
                <div className="viewport-loading">Carregando o mapa...</div>
              )}
            </div>
            <div className="map-legend">
              <span><i className="legend-wall" />parede</span>
              <span><i className="legend-obstacle" />obstáculo</span>
              <span><i className="legend-zone" />zona</span>
              <span><i className="legend-lidar" />LiDAR</span>
            </div>
            <div className="telemetry">
              <span>
                x <strong>{(pose?.x ?? 0).toFixed(2)} m</strong>
              </span>
              <span>
                y <strong>{(pose?.y ?? 0).toFixed(2)} m</strong>
              </span>
              <span>
                yaw <strong>{(pose?.yaw ?? 0).toFixed(2)} rad</strong>
              </span>
              <span>
                v <strong>{speed.toFixed(2)} m/s</strong>
              </span>
            </div>          </section>

          <section className="panel terminal-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Shell Linux</p>
                <h2>Terminal</h2>
              </div>
              <div className="terminal-actions">
                <span
                  className="terminal-status"
                  data-testid="terminal-status"
                  data-running={terminalState?.running ?? false}
                >
                  {terminalState === null
                    ? "Conectando"
                    : terminalState.running
                      ? "Comando em execução"
                      : "Pronto para digitar"}
                </span>
                <button
                  className="button button-secondary button-small"
                  onClick={() => terminalRef.current?.focus()}
                  data-testid="focus-terminal"
                >
                  Focar terminal
                </button>
                <button
                  className="button button-secondary button-small"
                  onClick={handleInterrupt}
                  data-testid="interrupt-button"
                >
                  Ctrl+C
                </button>
              </div>
            </div>
            <div
              className="terminal-wrap"
              data-testid="terminal-state"
              data-prompt={terminalState?.prompt ?? false}
              data-line-empty={terminalState?.lineEmpty ?? false}
              data-running={terminalState?.running ?? false}
              data-last-command-seq={lastCommand?.seq ?? 0}
              data-last-command-exit={lastCommand?.exit ?? ""}
            >
              <Terminal
                ref={terminalRef}
                wsPath="/ws/terminal"
                onTerminalState={handleTerminalState}
                onInsertResult={handleInsertResult}
                onCommand={handleCommand}
              />
            </div>
          </section>
          </div>
        </main>
      ) : null}
    </div>
  );
}
