import { useEffect, useState } from "react";

import Terminal from "./components/Terminal";
import WarehouseCanvas from "./components/WarehouseCanvas";
import {
  endSession,
  getMap,
  getSession,
  startSession,
  wsUrl
} from "./lib/api";
import type { MapData, Pose, SessionStatus } from "./types";

const stageLabels: Record<string, string> = {
  creating: "Criando o ambiente",
  starting: "Iniciando o simulador",
  waiting_odom: "Aguardando a odometria",
  ready: "Pronto"
};

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
    default:
      return "Pronto para começar";
  }
}

export default function App() {
  const [session, setSession] = useState<SessionStatus>({ state: "idle" });
  const [map, setMap] = useState<MapData | null>(null);
  const [pose, setPose] = useState<Pose | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

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
    if (session.state !== "preparing") {
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
    const socket = new WebSocket(wsUrl("/ws/telemetry"));
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string);
        if (message.type === "pose") {
          setPose(message as Pose);
        }
        if (message.type === "state" && message.state === "error") {
          setSession({
            state: "error",
            error: "o simulador encerrou inesperadamente"
          });
        }
      } catch {
        return;
      }
    };
    return () => socket.close();
  }, [session.state]);

  async function handleStart() {
    setBusy(true);
    setNotice("");
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
    setBusy(true);
    try {
      await endSession();
    } finally {
      setSession({ state: "idle" });
      setMap(null);
      setPose(null);
      setNotice("");
      setBusy(false);
    }
  }

  const speed = Math.abs(pose?.vx ?? 0);
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
            <p className="eyebrow">Sessão única</p>
            <h2>Laboratório em uso</h2>
            <p>
              Esta entrega permite uma sessão por vez. Encerre a sessão aberta
              em outro navegador ou tente novamente mais tarde.
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
        <main className="workspace">
          <section className="panel viewport-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Visor 2D</p>
                <h2>Armazém</h2>
              </div>
              <span className="panel-note">referencial odom</span>
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
                >
                  <WarehouseCanvas map={map} pose={pose} />
                </div>
              ) : (
                <div className="viewport-loading">Carregando o mapa...</div>
              )}
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
            </div>
            <div className="instructions">
              <strong>Laboratório pronto.</strong> No terminal, execute{" "}
              <code>ros2 topic list</code>. Para mover, use{" "}
              <code>timeout 3 ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist &quot;{"{"}linear: {"{"}x: 0.2{"}"}{"}"}&quot;</code>.
            </div>
          </section>

          <section className="panel terminal-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Shell Linux</p>
                <h2>Terminal</h2>
              </div>
              <span className="panel-note">ROS 2 Jazzy</span>
            </div>
            <div className="terminal-wrap">
              <Terminal wsPath="/ws/terminal" />
            </div>
          </section>
        </main>
      ) : null}
    </div>
  );
}
