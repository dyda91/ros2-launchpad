import type { MapData, MissionContent, SessionStatus } from "../types";

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
