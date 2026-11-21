import { useEffect, useMemo, useRef, useState } from "react";

import type {
  MissionContent,
  MissionProgress,
  MissionQuestion,
  MissionStatus,
  MissionStep,
  Pose,
  TerminalState
} from "../types";

interface MissionPanelProps {
  mission: MissionContent;
  pose: Pose | null;
  missionStatus: MissionStatus | null;
  terminalState: TerminalState | null;
  insertNotice: string;
  busy: boolean;
  restarting: boolean;
  initialProgress?: MissionProgress;
  onInsert: (command: string) => void;
  onRestart: () => void;
  onProgressChange: (progress: MissionProgress) => void;
}

function angleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
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

function Question({
  question,
  selected,
  done,
  wrong,
  onSelect,
  testId
}: {
  question: MissionQuestion;
  selected: number | null;
  done: boolean;
  wrong: boolean;
  onSelect: (index: number) => void;
  testId: string;
}) {
  return (
    <div className="mission-question">
      <p>{question.prompt}</p>
      <div className="option-list">
        {question.options.map((option, index) => (
          <button
            key={option}
            className={[
              "option-button",
              selected === index ? "option-selected" : "",
              done && index === question.answerIndex ? "option-correct" : "",
              wrong && selected === index ? "option-wrong" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onSelect(index)}
            disabled={done}
            data-testid={testId}
            data-index={index}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
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

function Hints({
  step,
  hintsShown,
  setHintsShown
}: {
  step: MissionStep;
  hintsShown: number;
  setHintsShown: (value: number) => void;
}) {
  return (
    <div className="hints">
      {step.hints.slice(0, hintsShown).map((hint, index) => (
        <p className="hint" key={hint}>
          <strong>Dica {index + 1}:</strong> {hint}
        </p>
      ))}
      <button
        className="button button-ghost button-small"
        onClick={() => setHintsShown(Math.min(hintsShown + 1, step.hints.length))}
        disabled={hintsShown >= step.hints.length}
        data-testid="hint-button"
      >
        {hintsShown === 0
          ? "Mostrar dica"
          : hintsShown >= step.hints.length
            ? "Dicas esgotadas"
            : "Mais uma dica"}
      </button>
    </div>
  );
}

function DeliveryStatus({
  status,
  step
}: {
  status: MissionStatus | null;
  step: MissionStep;
}) {
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
      data-zone={step.id}
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

export default function MissionPanel({
  mission,
  pose,
  missionStatus,
  terminalState,
  insertNotice,
  busy,
  restarting,
  initialProgress,
  onInsert,
  onRestart,
  onProgressChange
}: MissionPanelProps) {
  const [stepIndex, setStepIndex] = useState(() =>
    Math.min(initialProgress?.stepIndex ?? 0, mission.steps.length - 1)
  );
  const [selected, setSelected] = useState<number | null>(
    initialProgress?.selected ?? null
  );
  const [quizDone, setQuizDone] = useState(
    initialProgress?.quizDone ?? false
  );
  const [quizWrong, setQuizWrong] = useState(
    initialProgress?.quizWrong ?? false
  );
  const [predictionSelected, setPredictionSelected] = useState<number | null>(
    initialProgress?.predictionSelected ?? null
  );
  const [predictionDone, setPredictionDone] = useState(
    initialProgress?.predictionDone ?? false
  );
  const [predictionWrong, setPredictionWrong] = useState(
    initialProgress?.predictionWrong ?? false
  );
  const [hintsShown, setHintsShown] = useState(
    initialProgress?.hintsShown ?? 0
  );
  const [solutionVisible, setSolutionVisible] = useState(
    initialProgress?.solutionVisible ?? false
  );
  const [motionStart, setMotionStart] = useState<{
    x: number;
    y: number;
    yaw: number;
  } | null>(initialProgress?.motionStart ?? null);
  const [motionDone, setMotionDone] = useState(
    initialProgress?.motionDone ?? false
  );
  const progressCallback = useRef(onProgressChange);

  const step = mission.steps[stepIndex];
  const isLast = stepIndex === mission.steps.length - 1;
  const delivered = Boolean(missionStatus?.delivered);

  useEffect(() => {
    progressCallback.current = onProgressChange;
  }, [onProgressChange]);

  const progress = useMemo<MissionProgress>(
    () => ({
      stepIndex,
      selected,
      quizDone,
      quizWrong,
      predictionSelected,
      predictionDone,
      predictionWrong,
      hintsShown,
      solutionVisible,
      motionStart,
      motionDone
    }),
    [
      stepIndex,
      selected,
      quizDone,
      quizWrong,
      predictionSelected,
      predictionDone,
      predictionWrong,
      hintsShown,
      solutionVisible,
      motionStart,
      motionDone
    ]
  );

  useEffect(() => {
    progressCallback.current(progress);
  }, [progress]);

  useEffect(() => {
    if (
      step.kind !== "motion" ||
      !predictionDone ||
      motionStart !== null ||
      pose === null
    ) {
      return;
    }
    if (!terminalState?.prompt || !terminalState.lineEmpty) {
      return;
    }
    setMotionStart({ x: pose.x, y: pose.y, yaw: pose.yaw });
  }, [step.kind, predictionDone, motionStart, terminalState, pose]);

  useEffect(() => {
    if (
      step.kind !== "motion" ||
      motionStart === null ||
      pose === null ||
      motionDone
    ) {
      return;
    }
    const distance = Math.hypot(pose.x - motionStart.x, pose.y - motionStart.y);
    const speed = Math.abs(pose.vx);
    const minDistance = step.minDisplacementM ?? 0.15;
    const stopSpeed = step.stopSpeedMps ?? 0.02;
    if (distance >= minDistance && speed <= stopSpeed) {
      setMotionDone(true);
    }
  }, [step, motionStart, pose, motionDone]);

  const solutionAtStart = useMemo(() => {
    if (!pose || !step.solutionStart) {
      return false;
    }
    const start = step.solutionStart;
    const distance = Math.hypot(pose.x - start.x, pose.y - start.y);
    const yawDiff = Math.abs(angleDelta(pose.yaw, start.yaw));
    return distance <= start.tolerance && yawDiff <= 0.35;
  }, [pose, step.solutionStart]);

  function selectQuiz(index: number) {
    if (quizDone || !step.question) {
      return;
    }
    setSelected(index);
    setQuizWrong(false);
    if (index === step.question.answerIndex) {
      setQuizDone(true);
    } else {
      setQuizWrong(true);
    }
  }

  function selectPrediction(index: number) {
    if (predictionDone || !step.prediction) {
      return;
    }
    setPredictionSelected(index);
    setPredictionWrong(false);
    if (index === step.prediction.answerIndex) {
      setPredictionDone(true);
    } else {
      setPredictionWrong(true);
    }
  }

  function nextStep() {
    if (isLast) {
      return;
    }
    setStepIndex((index) => index + 1);
    setSelected(null);
    setQuizDone(false);
    setQuizWrong(false);
    setPredictionSelected(null);
    setPredictionDone(false);
    setPredictionWrong(false);
    setHintsShown(0);
    setSolutionVisible(false);
    setMotionStart(null);
    setMotionDone(false);
  }

  return (
    <aside className="panel mission-panel" data-testid="mission-panel">
      <div className="panel-header mission-header">
        <div>
          <p className="eyebrow">Desafio {stepIndex + 1} de {mission.steps.length}</p>
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

      <div className="mission-body" data-testid="mission-step" data-step={step.id}>
        {delivered && isLast ? (
          <Success
            mission={mission}
            busy={busy}
            restarting={restarting}
            onRestart={onRestart}
          />
        ) : (
          <>
            {stepIndex === 0 ? (
              <p className="mission-intro">{mission.intro}</p>
            ) : null}
            <p className="mission-title">{step.title}</p>
            <div className="concept">
              <span className="concept-label">Conceito</span>
              <p>{step.concept}</p>
            </div>
            <p className="mission-action">
              <strong>Ação:</strong> {step.action}
            </p>
            {step.observe ? (
              <p className="mission-observe">
                <strong>Observe:</strong> {step.observe}
              </p>
            ) : null}

            {step.kind === "quiz" ? (
              <>
                {step.insertCommand ? (
                  <CommandPreview
                    command={step.insertCommand}
                    terminalState={terminalState}
                    insertNotice={insertNotice}
                    onInsert={onInsert}
                  />
                ) : null}
                {step.question ? (
                  <>
                    <Question
                      question={step.question}
                      selected={selected}
                      done={quizDone}
                      wrong={quizWrong}
                      onSelect={selectQuiz}
                      testId="quiz-option"
                    />
                    {quizWrong && !quizDone ? (
                      <p className="answer-wrong">
                        Ainda não. Releia a saída do terminal e tente outra
                        opção.
                      </p>
                    ) : null}
                    {quizDone ? (
                      <div className="answer-feedback">
                        <p>{step.feedback}</p>
                        <button
                          className="button button-primary"
                          onClick={nextStep}
                          data-testid="next-step"
                        >
                          Próximo desafio
                        </button>
                      </div>
                    ) : (
                      <p className="small">Escolha uma opção para conferir.</p>
                    )}
                  </>
                ) : null}
              </>
            ) : null}

            {step.kind === "motion" ? (
              <>
                {step.prediction ? (
                  <>
                    <Question
                      question={step.prediction}
                      selected={predictionSelected}
                      done={predictionDone}
                      wrong={predictionWrong}
                      onSelect={selectPrediction}
                      testId="prediction-option"
                    />
                    {predictionWrong && !predictionDone ? (
                      <p className="answer-wrong">
                        Observe a direção do robô e tente novamente.
                      </p>
                    ) : null}
                  </>
                ) : null}
                {predictionDone && step.command ? (
                  <CommandPreview
                    command={step.command}
                    terminalState={terminalState}
                    insertNotice={insertNotice}
                    onInsert={onInsert}
                  />
                ) : null}
                {predictionDone ? (
                  <p className="motion-reference" data-testid="motion-reference">
                    {motionStart
                      ? `Pose de referência: x=${motionStart.x.toFixed(2)}, y=${motionStart.y.toFixed(2)}`
                      : "Aguardando o terminal estar no prompt e vazio para capturar a pose de referência."}
                  </p>
                ) : null}
                {motionDone ? (
                  <div className="answer-feedback">
                    <p>{step.feedback}</p>
                    <p className="small">
                      Deslocamento observado a partir da referência. O robô
                      também voltou a ficar parado.
                    </p>
                    <button
                      className="button button-primary"
                      onClick={nextStep}
                      data-testid="next-step"
                    >
                      Ir para a entrega
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {step.kind === "delivery" ? (
              <>
                <DeliveryStatus status={missionStatus} step={step} />
                <Hints
                  step={step}
                  hintsShown={hintsShown}
                  setHintsShown={setHintsShown}
                />
                {hintsShown >= step.hints.length && step.solution ? (
                  <div className="solution">
                    <button
                      className="button button-secondary button-small"
                      onClick={() => setSolutionVisible((visible) => !visible)}
                      data-testid="toggle-solution"
                    >
                      {solutionVisible
                        ? "Ocultar solução completa"
                        : "Mostrar solução completa (opcional)"}
                    </button>
                    {solutionVisible ? (
                      <>
                        <p className="solution-note">
                          {step.hintsNote} Pose de partida esperada:
                          {" "}
                          x≈{step.solutionStart?.x.toFixed(2)}, y≈
                          {step.solutionStart?.y.toFixed(2)}, yaw≈
                          {step.solutionStart?.yaw.toFixed(2)}.{" "}
                          {solutionAtStart
                            ? "A pose atual está dentro da tolerância."
                            : "A pose atual não está na partida; use as dicas ou ajuste manualmente."}
                        </p>
                        {step.solution.map((command, index) => (
                          <CommandPreview
                            key={command}
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
            ) : null}
          </>
        )}
        <p className="mission-footnote">
          O progresso fica nesta sessão e sobrevive a recarregar a página.
          Reiniciar recria a sessão, a pose inicial e o progresso.
        </p>
      </div>
    </aside>
  );
}
