import type {
  MapData,
  MissionContent,
  MissionProgress,
  SessionStatus
} from "../types";

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();
  return payload as T;
}

export async function getSession(): Promise<SessionStatus> {
  const response = await fetch("/api/session", {
    credentials: "same-origin"
  });
  if (!response.ok) {
    throw new Error("não foi possível consultar a sessão");
  }
  return parseResponse<SessionStatus>(response);
}

export async function startSession(): Promise<SessionStatus> {
  const response = await fetch("/api/session", {
    method: "POST",
    credentials: "same-origin"
  });
  return parseResponse<SessionStatus>(response);
}

export async function endSession(): Promise<void> {
  await fetch("/api/session", {
    method: "DELETE",
    credentials: "same-origin"
  });
}

export async function restartSession(): Promise<SessionStatus> {
  const response = await fetch("/api/session/restart", {
    method: "POST",
    credentials: "same-origin"
  });
  return parseResponse<SessionStatus>(response);
}

export interface RedeemResult {
  ok: boolean;
  status: number;
  message: string;
}

export async function redeemInvite(code: string): Promise<RedeemResult> {
  const response = await fetch("/api/pilot/redeem", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  if (response.status === 204) {
    return { ok: true, status: 204, message: "" };
  }
  let message = "convite inválido ou expirado";
  try {
    const payload = (await response.json()) as { detail?: string };
    if (response.status === 429) {
      message = "tentativas demais; aguarde alguns minutos";
    } else if (payload.detail === "pilot not accepting") {
      message = "o piloto não está aceitando novas entradas";
    }
  } catch {
    return { ok: false, status: response.status, message };
  }
  return { ok: false, status: response.status, message };
}

export async function touchSession(): Promise<void> {
  await fetch("/api/session/touch", {
    method: "POST",
    credentials: "same-origin"
  });
}

export async function saveProgress(progress: MissionProgress): Promise<void> {
  await fetch("/api/session/progress", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ progress })
  });
}

export async function getMission(): Promise<MissionContent> {
  const response = await fetch("/api/mission", {
    credentials: "same-origin"
  });
  if (!response.ok) {
    throw new Error("não foi possível carregar a missão");
  }
  return parseResponse<MissionContent>(response);
}

export async function getMap(): Promise<MapData> {
  const response = await fetch("/api/map", {
    credentials: "same-origin"
  });
  if (!response.ok) {
    throw new Error("mapa ainda não está disponível");
  }
  return parseResponse<MapData>(response);
}

export function wsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${path}`;
}
