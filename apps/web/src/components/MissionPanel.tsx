import { useEffect, useMemo, useRef, useState } from "react";

import {
  HOLD_MS,
  checkAnswer,
  completedTasks,
  freshProgress,
  guideFor,
  judgeCommand,
  kindLabels,
  learnedUpTo,
  needsStart,
  nextPosition,
  poseCriteria,
  restoreProgress,
  scanCriteria,
  isStopped,
  snapshot,
  totalTasks,
  type CommandVerdict,
  type Criterion
} from "../course";
import type {
  CourseGuide,
  MissionContent,
  MissionProgress,
  MissionStatus,
  Pose,
  ScanData,
  TerminalCommand,
  TerminalState
} from "../types";

interface MissionPanelProps {
  mission: MissionContent;
  pose: Pose | null;
  scan: ScanData | null;
  missionStatus: MissionStatus | null;
  terminalState: TerminalState | null;
  lastCommand: TerminalCommand | null;
  insertNotice: string;
  busy: boolean;
  restarting: boolean;
  initialProgress?: unknown;
  onInsert: (command: string) => void;
  onRestart: () => void;
  onProgressChange: (progress: MissionProgress) => void;
  onGuideChange?: (guide: CourseGuide | null) => void;
}

interface CommandFeedback {
  verdict: CommandVerdict;
  command: string;
  exit: number;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  }
}

function CommandPreview({
  command,
  terminalState,
  insertNotice,
  onInsert,
  testId = "command-preview"
}: {
  command: string;
  terminalState: TerminalState | null;
  insertNotice: string;
  onInsert: (command: string) => void;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canInsert = Boolean(
    terminalState?.prompt && terminalState.lineEmpty && !terminalState.running
  );
  const reason = !terminalState
    ? "aguardando o terminal"
    : terminalState.running
      ? "há um comando em execução; use Copiar ou Ctrl+C"
      : !terminalState.prompt
        ? "o shell não está no prompt"
        : !terminalState.lineEmpty
          ? "já existe texto na linha; use Copiar ou limpe a linha"
          : "";

  async function handleCopy() {
    const ok = await copyText(command);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="command-preview" data-testid={testId}>
      <pre>
        <code>{command}</code>
      </pre>
      <div className="command-actions">
        <button
          className="button button-secondary button-small"
          onClick={handleCopy}
          data-testid="copy-command"
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
        <button
          className="button button-primary button-small"
          onClick={() => onInsert(command)}
          disabled={!canInsert}
          title={canInsert ? "Insere sem pressionar Enter" : reason}
          data-testid="insert-command"
        >
          Inserir no terminal
        </button>
      </div>
      <p className="command-note">
        {canInsert
          ? "O comando será inserido sem Enter. Pressione Enter no terminal para executar."
          : `Inserção indisponível: ${reason}. Use Copiar e cole no terminal.`}
      </p>
      {insertNotice ? (
        <p className="command-result" data-testid="insert-result">
          {insertNotice}
        </p>
      ) : null}
    </div>
  );
}

function CriteriaList({ criteria }: { criteria: Criterion[] }) {
  return (
    <ul className="criteria-list" data-testid="task-criteria">
      {criteria.map((criterion) => (
        <li
          key={criterion.id}
          className={criterion.ok ? "criterion-ok" : "criterion-pending"}
          data-criterion={criterion.id}
          data-ok={criterion.ok}
        >
          <span className="criterion-mark">{criterion.ok ? "✓" : "✗"}</span>
          <span className="criterion-label">{criterion.label}</span>
          <span className="criterion-detail">{criterion.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function DeliveryStatus({ status }: { status: MissionStatus | null }) {
  let text = "Aguardando a telemetria da missão...";
  if (status !== null) {
    if (status.delivered) {
      text = "Entrega concluída.";
    } else if (status.inZone) {
      if (status.speedMps > 0.02) {
        text = "Você está na zona, mas o robô ainda se move. Pare dentro dela.";
      } else {
        const remaining = Math.max(0, 2.0 - status.stoppedForS);
        text = `Parado na zona. Aguarde ${remaining.toFixed(1)} s para confirmar.`;
      }
    } else {
      text = "Fora da zona. Ajuste o caminho e entre na área verde.";
    }
  }
  return (
    <div
      className={`delivery-status ${status?.delivered ? "delivery-ok" : ""}`}
      data-testid="mission-status"
      data-in-zone={status?.inZone ?? false}
      data-delivered={status?.delivered ?? false}
      data-speed={status?.speedMps ?? 0}
      data-stopped-for={status?.stoppedForS ?? 0}
    >
      <strong>Entrega:</strong> {text}
      {status ? (
        <span className="delivery-numbers">
          v={status.speedMps.toFixed(2)} m/s · parado há{" "}
          {status.stoppedForS.toFixed(1)} s
        </span>
      ) : null}
    </div>
  );
}

function Success({
  mission,
  busy,
  restarting,
  onRestart
}: {
  mission: MissionContent;
  busy: boolean;
  restarting: boolean;
  onRestart: () => void;
}) {
  return (
    <div className="mission-success" data-testid="mission-success">
      <p className="eyebrow">Entrega confirmada</p>
      <h3>{mission.success.title}</h3>
      <p>{mission.success.body}</p>
      <p className="hook" data-testid="mission-hook">
        {mission.success.hook}
      </p>
      <button
        className="button button-primary"
        onClick={onRestart}
        disabled={busy || restarting}
        data-testid="restart-button"
      >
        {restarting ? "Reiniciando..." : "Reiniciar missão"}
      </button>
    </div>
  );
}

function feedbackText(feedback: CommandFeedback) {
  if (feedback.verdict === "match") {
    return `Você executou ${feedback.command} — é isso.`;
  }
  if (feedback.verdict === "error") {
    return `Você executou ${feedback.command}: comando certo, mas terminou com erro ${feedback.exit}. Confira a saída e tente de novo.`;
  }
  return `Você executou ${feedback.command} — ainda não é o pedido.`;
}

export default function MissionPanel({
  mission,
  pose,
  scan,
  missionStatus,
  terminalState,
  lastCommand,
  insertNotice,
  busy,
  restarting,
  initialProgress,
  onInsert,
  onRestart,
  onProgressChange,
  onGuideChange
}: MissionPanelProps) {
  const [progress, setProgress] = useState<MissionProgress>(() =>
    restoreProgress(mission, initialProgress)
  );
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<CommandFeedback | null>(null);
  const [conceptOpen, setConceptOpen] = useState(progress.taskIndex === 0);
  const progressCallback = useRef(onProgressChange);
  const guideCallback = useRef(onGuideChange);
  const enteredAt = useRef(Date.now());
  const handledSeq = useRef(lastCommand?.seq ?? 0);
  const metSince = useRef<number | null>(null);
  const poseRef = useRef(pose);
  const scanRef = useRef(scan);

  const step = mission.steps[progress.stepIndex];
  const task = step.tasks[progress.taskIndex];
  const next = nextPosition(mission, progress.stepIndex, progress.taskIndex);
  const isLastTask = next === null;
  const delivered = Boolean(missionStatus?.delivered);
  const total = totalTasks(mission);
  const done = completedTasks(mission, progress);
  const live = task.kind === "pose" || task.kind === "scan";

  poseRef.current = pose;
  scanRef.current = scan;

  useEffect(() => {
    progressCallback.current = onProgressChange;
    guideCallback.current = onGuideChange;
  }, [onProgressChange, onGuideChange]);

  useEffect(() => {
    progressCallback.current(progress);
  }, [progress]);

  const guide = useMemo(() => guideFor(progress.taskDone ? null : task), [task, progress.taskDone]);

  useEffect(() => {
    guideCallback.current?.(guide);
  }, [guide]);

  useEffect(() => () => guideCallback.current?.(null), []);

  function update(changes: Partial<MissionProgress>) {
    setProgress((previous) => ({ ...previous, ...changes }));
  }

  useEffect(() => {
    if (lastCommand === null || lastCommand.seq === handledSeq.current) {
      return;
    }
    handledSeq.current = lastCommand.seq;
    if (lastCommand.receivedAt < enteredAt.current || progress.taskDone) {
      return;
    }
    if (task.kind !== "command") {
      return;
    }
    const verdict = judgeCommand(task, lastCommand);
    setFeedback({ verdict, command: lastCommand.command, exit: lastCommand.exit });
    if (verdict === "match") {
      update({ taskDone: true });
    }
  }, [lastCommand, task, progress.taskDone]);

  useEffect(() => {
    if (!needsStart(task) || progress.taskStart !== null || progress.taskDone) {
      return;
    }
    if (pose === null || !isStopped(pose)) {
      return;
    }
    update({ taskStart: snapshot(pose) });
  }, [task, pose, progress.taskStart, progress.taskDone]);

  const criteria = useMemo<Criterion[]>(() => {
    if (task.kind === "pose") {
      return poseCriteria(task, pose, progress.taskStart);
    }
    if (task.kind === "scan") {
      return scanCriteria(task, scan, pose);
    }
    return [];
  }, [task, pose, scan, progress.taskStart]);

  useEffect(() => {
    metSince.current = null;
    if (!live || progress.taskDone) {
      return;
    }
    const timer = window.setInterval(() => {
      const current =
        task.kind === "pose"
          ? poseCriteria(task, poseRef.current, progress.taskStart)
          : scanCriteria(task, scanRef.current, poseRef.current);
      const allOk = current.every((criterion) => criterion.ok);
      if (!allOk) {
        metSince.current = null;
        return;
      }
      const now = Date.now();
      if (metSince.current === null) {
        metSince.current = now;
        return;
      }
      if (now - metSince.current >= HOLD_MS) {
        metSince.current = null;
        update({ taskDone: true });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [live, task, progress.taskDone, progress.taskStart]);

  useEffect(() => {
    if (task.kind === "delivery" && delivered && !progress.taskDone) {
      update({ taskDone: true });
    }
  }, [task.kind, delivered, progress.taskDone]);

  function goNext() {
    if (next === null) {
      return;
    }
    enteredAt.current = Date.now();
    metSince.current = null;
    setFeedback(null);
    setAnswer("");
    if (next.newStep) {
      setConceptOpen(true);
    }
    setProgress(freshProgress(next.stepIndex, next.taskIndex));
  }

  function selectQuiz(index: number) {
    if (progress.taskDone || !task.question) {
      return;
    }
    if (index === task.question.answerIndex) {
      update({ selected: index, taskDone: true, answerWrong: false });
    } else {
      update({ selected: index, answerWrong: true });
    }
  }

  function submitAnswer(event: React.FormEvent) {
    event.preventDefault();
    if (progress.taskDone) {
      return;
    }
    if (checkAnswer(task, answer)) {
      update({ taskDone: true, answerWrong: false });
    } else {
      update({ answerWrong: true });
    }
  }

  function preserveTerminalFocus(event: React.MouseEvent<HTMLElement>) {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button") !== null
    ) {
      event.preventDefault();
    }
  }

  const hintsExhausted = progress.hintsShown >= task.hints.length;
  const showSuccess = isLastTask && delivered;
  const learned = learnedUpTo(mission, progress.stepIndex);

  return (
    <aside
      className="panel mission-panel"
      data-testid="mission-panel"
      tabIndex={-1}
      onMouseDown={preserveTerminalFocus}
    >
      <div className="panel-header mission-header">
        <div>
          <p className="eyebrow" data-testid="module-counter">
            Módulo {progress.stepIndex + 1} de {mission.steps.length}
          </p>
          <h2>{mission.title}</h2>
        </div>
        <button
          className="button button-ghost button-small"
          onClick={onRestart}
          disabled={busy || restarting}
          data-testid="restart-button-top"
        >
          {restarting ? "Reiniciando..." : "Reiniciar"}
        </button>
      </div>

      <div className="course-progress">
        <div
          className="progress-bar"
          data-testid="course-progress"
          data-done={done}
          data-total={total}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <span className="progress-label">
          {done} de {total} desafios
        </span>
        <ol className="module-map" data-testid="module-map">
          {mission.steps.map((item, index) => {
            const state =
              index < progress.stepIndex
                ? "done"
                : index === progress.stepIndex
                  ? "current"
                  : "next";
            return (
              <li
                key={item.id}
                className={`module-dot module-${state}`}
                data-state={state}
                title={item.title}
              >
                {state === "done" ? "✓" : index + 1}
              </li>
            );
          })}
        </ol>
      </div>

      <div
        className="mission-body"
        data-testid="mission-step"
        data-step={step.id}
        data-task={task.id}
      >
        {showSuccess ? (
          <Success
            mission={mission}
            busy={busy}
            restarting={restarting}
            onRestart={onRestart}
          />
        ) : (
          <>
            {progress.stepIndex === 0 && progress.taskIndex === 0 ? (
              <p className="mission-intro">{mission.intro}</p>
            ) : null}
            <p className="mission-title">{step.title}</p>
            <p className="mission-goal">
              <strong>Objetivo:</strong> {step.goal}
            </p>
            <details
              className="concept"
              open={conceptOpen}
              onToggle={(event) =>
                setConceptOpen((event.target as HTMLDetailsElement).open)
              }
              data-testid="concept"
            >
              <summary className="concept-label">Conceito</summary>
              <p>{step.concept}</p>
              <p className="mission-why">
                <strong>Por que importa:</strong> {step.why}
              </p>
              {step.example.length > 0 ? (
                <div className="mission-example">
                  <span className="concept-label">Exemplo comentado</span>
                  <pre>{step.example.join("\n")}</pre>
                </div>
              ) : null}
            </details>

            <ol className="task-checklist" data-testid="task-checklist">
              {step.tasks.map((item, index) => {
                const state =
                  index < progress.taskIndex ||
                  (index === progress.taskIndex && progress.taskDone)
                    ? "done"
                    : index === progress.taskIndex
                      ? "current"
                      : "next";
                return (
                  <li key={item.id} className={`task-${state}`} data-state={state}>
                    <span className="task-mark">
                      {state === "done" ? "✓" : state === "current" ? "▸" : "○"}
                    </span>
                    {item.title}
                  </li>
                );
              })}
            </ol>

            <section
              className={`task-card task-${task.kind} ${progress.taskDone ? "task-card-done" : ""}`}
              data-testid="task-card"
              data-kind={task.kind}
              data-done={progress.taskDone}
            >
              <div className="task-card-header">
                <span className="task-kind">{kindLabels[task.kind]}</span>
                <span className="task-count">
                  Desafio {progress.taskIndex + 1} de {step.tasks.length}
                </span>
              </div>
              <h3 className="task-title">{task.title}</h3>
              <p className="task-prompt">{task.prompt}</p>

              {task.insertCommand && !progress.taskDone ? (
                <CommandPreview
                  command={task.insertCommand}
                  terminalState={terminalState}
                  insertNotice={insertNotice}
                  onInsert={onInsert}
                />
              ) : null}

              {task.kind === "answer" ? (
                <form className="answer-form" onSubmit={submitAnswer}>
                  <input
                    className="answer-input"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder={task.placeholder ?? "sua resposta"}
                    disabled={progress.taskDone}
                    data-testid="answer-input"
                    aria-label="Resposta"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="submit"
                    className="button button-primary button-small"
                    disabled={progress.taskDone || answer.trim() === ""}
                    data-testid="answer-submit"
                  >
                    Conferir
                  </button>
                </form>
              ) : null}

              {task.kind === "quiz" && task.question ? (
                <div className="mission-question">
                  <p>{task.question.prompt}</p>
                  <div className="option-list">
                    {task.question.options.map((option, index) => (
                      <button
                        key={option}
                        className={[
                          "option-button",
                          progress.selected === index ? "option-selected" : "",
                          progress.taskDone && index === task.question!.answerIndex
                            ? "option-correct"
                            : "",
                          progress.answerWrong &&
                          !progress.taskDone &&
                          progress.selected === index
                            ? "option-wrong"
                            : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => selectQuiz(index)}
                        disabled={progress.taskDone}
                        data-testid="quiz-option"
                        data-index={index}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {live ? <CriteriaList criteria={criteria} /> : null}

              {task.kind === "delivery" ? (
                <>
                  <DeliveryStatus status={missionStatus} />
                  <ol className="delivery-strategy" data-testid="delivery-strategy">
                    {(task.strategy ?? []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </>
              ) : null}

              {task.kind === "command" && feedback !== null ? (
                <p
                  className={`command-feedback feedback-${feedback.verdict}`}
                  data-testid="command-feedback"
                  data-verdict={feedback.verdict}
                >
                  {feedbackText(feedback)}
                </p>
              ) : null}

              {progress.answerWrong && !progress.taskDone ? (
                <p className="answer-wrong" data-testid="answer-wrong">
                  {task.kind === "quiz"
                    ? "Ainda não. Releia o conceito e tente outra opção."
                    : "Ainda não. Confira a saída no terminal e tente de novo."}
                </p>
              ) : null}

              <p
                className={`task-status ${progress.taskDone ? "task-status-done" : ""}`}
                data-testid="task-status"
                data-done={progress.taskDone}
              >
                {progress.taskDone
                  ? "Desafio concluído."
                  : task.kind === "command"
                    ? "Aguardando o comando no terminal."
                    : task.kind === "answer"
                      ? "Descubra no terminal e digite a resposta."
                      : task.kind === "quiz"
                        ? "Escolha uma opção."
                        : task.kind === "delivery"
                          ? "O mission_monitor confirma a entrega."
                          : "Conferido ao vivo; o robô precisa parar."}
              </p>

              {progress.taskDone ? (
                <div className="answer-feedback">
                  <p>{task.feedback}</p>
                  {task.observe ? (
                    <p className="mission-observe">
                      <strong>Observe:</strong> {task.observe}
                    </p>
                  ) : null}
                  {next !== null ? (
                    <button
                      className="button button-primary"
                      onClick={goNext}
                      data-testid="next-task"
                    >
                      {next.newStep ? "Próximo módulo" : "Próximo desafio"}
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  {task.observe && task.kind !== "answer" ? (
                    <p className="mission-observe">
                      <strong>Observe:</strong> {task.observe}
                    </p>
                  ) : null}
                  <div className="hints">
                    {task.hints.slice(0, progress.hintsShown).map((hint, index) => (
                      <p className="hint" key={hint}>
                        <strong>Dica {index + 1}:</strong> {hint}
                      </p>
                    ))}
                    {task.hints.length > 0 ? (
                      <button
                        className="button button-ghost button-small"
                        onClick={() =>
                          update({
                            hintsShown: Math.min(
                              progress.hintsShown + 1,
                              task.hints.length
                            )
                          })
                        }
                        disabled={hintsExhausted}
                        data-testid="hint-button"
                      >
                        {progress.hintsShown === 0
                          ? "Mostrar dica"
                          : hintsExhausted
                            ? "Dicas esgotadas"
                            : "Mais uma dica"}
                      </button>
                    ) : null}
                  </div>
                  {hintsExhausted && task.solution && task.solution.length > 0 ? (
                    <div className="solution">
                      <button
                        className="button button-secondary button-small"
                        onClick={() => update({ solutionVisible: !progress.solutionVisible })}
                        data-testid="toggle-solution"
                      >
                        {progress.solutionVisible ? "Ocultar solução" : "Mostrar solução"}
                      </button>
                      {progress.solutionVisible ? (
                        <>
                          <p className="solution-note">
                            {task.solutionNote ??
                              "Solução de referência: execute e confira o resultado."}
                          </p>
                          {task.solution.map((command, index) => (
                            <CommandPreview
                              key={`${index}-${command}`}
                              command={command}
                              terminalState={terminalState}
                              insertNotice={insertNotice}
                              onInsert={onInsert}
                              testId={`solution-command-${index}`}
                            />
                          ))}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </>
        )}

        <details className="cheat-sheet" data-testid="cheat-sheet">
          <summary>Sua cola de comandos ({learned.length})</summary>
          <dl>
            {learned.map((item) => (
              <div className="cheat-row" key={item.command}>
                <dt>
                  <code>{item.command}</code>
                </dt>
                <dd>{item.meaning}</dd>
              </div>
            ))}
          </dl>
        </details>
        <p className="terminal-help mission-terminal-help">
          Tab completa caminhos e comandos; ↑ traz o último comando. Ctrl+C
          interrompe e Ctrl+Shift+E sai do terminal e foca a aula.
        </p>
        <p className="mission-footnote">
          O progresso fica nesta sessão e sobrevive a recarregar a página.
          Reiniciar recria a sessão, a pose inicial e o progresso.
        </p>
        <details className="free-drive-help mission-free-drive" data-testid="free-drive-help">
          <summary>Condução livre: comandos</summary>
          <p>
            Para manter o robô andando, use o comando sem <code>--times</code> e
            interrompa com Ctrl+C.
          </p>
          <pre>{`# andar ~3 s a 0,3 m/s
ros2 topic pub --rate 10 --times 30 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.3}}"

# girar à esquerda / à direita
ros2 topic pub --rate 10 --times 15 /cmd_vel geometry_msgs/msg/Twist "{angular: {z: 0.8}}"
ros2 topic pub --rate 10 --times 15 /cmd_vel geometry_msgs/msg/Twist "{angular: {z: -0.8}}"

# ajuste fino
ros2 topic pub --rate 10 --times 2 /cmd_vel geometry_msgs/msg/Twist "{angular: {z: 0.2}}"

# movimento contínuo; pare com Ctrl+C
ros2 topic pub --rate 10 /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.2}}"`}</pre>
        </details>
      </div>
    </aside>
  );
}
