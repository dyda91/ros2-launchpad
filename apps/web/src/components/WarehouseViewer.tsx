import { useEffect, useRef, useState } from "react";

import type {
  CourseGuide,
  MapData,
  MissionStatus,
  Pose,
  ScanData
} from "../types";
import {
  clampPan,
  clampZoom,
  makeView,
  pickLevel,
  screenX,
  screenY,
  worldBounds,
  worldX,
  worldY
} from "../viewer/camera";
import { drawDynamic } from "../viewer/dynamicLayer";
import { rangeGradient } from "../viewer/lidarDraw";
import { renderStatic } from "../viewer/staticLayer";
import {
  defaultLayers,
  type Layers,
  type ScanFrame,
  type TrailPoint,
  type ViewerState
} from "../viewer/state";

const TRAIL_SECONDS = 30;
const TRAIL_LIMIT = 1500;
const FRAME_LIMIT = 12;

interface StaticCache {
  key: string;
  map: MapData;
  canvas: HTMLCanvasElement;
}

interface WarehouseViewerProps {
  map: MapData;
  pose: Pose | null;
  scan: ScanData | null;
  showLidar: boolean;
  zoom: number;
  follow: boolean;
  resetToken: number;
  clearTrailToken: number;
  missionStatus: MissionStatus | null;
  guide: CourseGuide | null;
  onZoomChange: (zoom: number) => void;
  onFollowChange: (follow: boolean) => void;
  onShowLidarChange: (visible: boolean) => void;
}

const PERSISTENCE_OPTIONS = [1, 3, 5, 10];

const layerLabels: { key: keyof Layers; label: string; sub?: boolean }[] = [
  { key: "grid", label: "Grade" },
  { key: "tf", label: "TF" },
  { key: "trail", label: "Rastro" },
  { key: "velocity", label: "Velocidade" },
  { key: "markings", label: "Marcações do piso" },
  { key: "rays", label: "Raios do LiDAR", sub: true },
  { key: "sector", label: "Setor frontal", sub: true }
];

function formatNumber(value: number, digits = 2) {
  return value.toFixed(digits).replace(".", ",");
}

function buildFrame(scan: ScanData, fallback: Pose): ScanFrame {
  const origin = scan.pose ?? fallback;
  const points = new Float32Array(scan.ranges.length * 3);
  let count = 0;
  for (let index = 0; index < scan.ranges.length; index += 1) {
    const range = scan.ranges[index];
    if (
      range === null ||
      !Number.isFinite(range) ||
      range < scan.range_min ||
      range > scan.range_max
    ) {
      continue;
    }
    const angle = origin.yaw + scan.angle_min + index * scan.angle_increment;
    points[count * 3] = origin.x + range * Math.cos(angle);
    points[count * 3 + 1] = origin.y + range * Math.sin(angle);
    points[count * 3 + 2] = range;
    count += 1;
  }
  return {
    stamp: scan.stamp,
    t: performance.now(),
    originX: origin.x,
    originY: origin.y,
    rangeMax: scan.range_max,
    points: points.subarray(0, count * 3)
  };
}

export default function WarehouseViewer(props: WarehouseViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<ViewerState>({
    map: props.map,
    pose: props.pose,
    scan: props.scan,
    showLidar: props.showLidar,
    zoom: props.zoom,
    follow: props.follow,
    guide: props.guide,
    missionStatus: props.missionStatus,
    layers: defaultLayers,
    persistence: 3,
    panX: 0,
    panY: 0,
    trail: [],
    frames: [],
    cursor: null
  });
  const callbacksRef = useRef({
    onZoomChange: props.onZoomChange,
    onFollowChange: props.onFollowChange
  });
  const scheduleRef = useRef<() => void>(() => undefined);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const [layers, setLayers] = useState<Layers>(defaultLayers);
  const [persistence, setPersistence] = useState(3);
  const [panelOpen, setPanelOpen] = useState(true);

  callbacksRef.current = {
    onZoomChange: props.onZoomChange,
    onFollowChange: props.onFollowChange
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const state = stateRef.current;
    let cache: StaticCache | null = null;
    let queued = 0;
    let frames = 0;
    let average = 0;
    let dragging: { id: number; x: number; y: number } | null = null;

    function currentView(width: number, height: number) {
      const bounds = worldBounds(state.map);
      let centerX = (bounds.minX + bounds.maxX) / 2 + state.panX;
      let centerY = (bounds.minY + bounds.maxY) / 2 + state.panY;
      if (state.follow && state.pose !== null) {
        centerX = state.pose.x;
        centerY = state.pose.y;
      }
      return {
        bounds,
        view: makeView(bounds, width, height, state.zoom, centerX, centerY)
      };
    }

    function draw() {
      queued = 0;
      const context = canvas!.getContext("2d");
      if (context === null) {
        return;
      }
      const started = performance.now();
      const ratio = window.devicePixelRatio || 1;
      const width = canvas!.clientWidth;
      const height = canvas!.clientHeight;
      if (width === 0 || height === 0) {
        return;
      }
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (canvas!.width !== pixelWidth || canvas!.height !== pixelHeight) {
        canvas!.width = pixelWidth;
        canvas!.height = pixelHeight;
      }
      const { bounds, view } = currentView(width, height);
      const level = pickLevel(view.scale * ratio);
      const key = `${level}|${state.layers.grid}|${state.layers.markings}`;
      if (cache === null || cache.key !== key || cache.map !== state.map) {
        cache = {
          key,
          map: state.map,
          canvas: renderStatic(state.map, level, {
            grid: state.layers.grid,
            markings: state.layers.markings
          })
        };
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = "#080d12";
      context.fillRect(0, 0, pixelWidth, pixelHeight);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        cache.canvas,
        screenX(view, bounds.minX),
        screenY(view, bounds.maxY),
        (bounds.maxX - bounds.minX) * view.scale,
        (bounds.maxY - bounds.minY) * view.scale
      );
      drawDynamic(context, view, state, started);
      const elapsed = performance.now() - started;
      frames += 1;
      average = frames === 1 ? elapsed : average * 0.95 + elapsed * 0.05;
      if (cursorRef.current !== null) {
        cursorRef.current.textContent =
          state.cursor === null
            ? "cursor: —"
            : `cursor: (${formatNumber(state.cursor.x)}; ${formatNumber(state.cursor.y)}) m`;
      }
      canvas!.dataset.frameMs = average.toFixed(2);
      canvas!.dataset.frames = String(frames);
      canvas!.dataset.trailPoints = String(state.trail.length);
      canvas!.dataset.scanFrames = String(state.frames.length);
    }

    function schedule() {
      if (queued === 0) {
        queued = window.requestAnimationFrame(draw);
      }
    }

    scheduleRef.current = schedule;

    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    const ticker = window.setInterval(schedule, 250);

    function onPointerDown(event: PointerEvent) {
      event.preventDefault();
      dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas!.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const { view } = currentView(rect.width, rect.height);
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      state.cursor = { x: worldX(view, sx), y: worldY(view, sy) };
      if (dragging !== null && dragging.id === event.pointerId) {
        const dx = event.clientX - dragging.x;
        const dy = event.clientY - dragging.y;
        dragging.x = event.clientX;
        dragging.y = event.clientY;
        if (dx !== 0 || dy !== 0) {
          if (state.follow) {
            callbacksRef.current.onFollowChange(false);
            state.follow = false;
            const bounds = worldBounds(state.map);
            state.panX = view.centerX - (bounds.minX + bounds.maxX) / 2;
            state.panY = view.centerY - (bounds.minY + bounds.maxY) / 2;
          }
          const [panX, panY] = clampPan(
            worldBounds(state.map),
            state.panX - dx / view.scale,
            state.panY + dy / view.scale
          );
          state.panX = panX;
          state.panY = panY;
        }
      }
      schedule();
    }

    function onPointerUp(event: PointerEvent) {
      if (dragging !== null && dragging.id === event.pointerId) {
        dragging = null;
      }
    }

    function onPointerLeave() {
      state.cursor = null;
      schedule();
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const { bounds, view } = currentView(rect.width, rect.height);
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const next = clampZoom(state.zoom * Math.exp(-event.deltaY * 0.0015));
      if (next === state.zoom) {
        return;
      }
      if (!state.follow) {
        const focusX = worldX(view, sx);
        const focusY = worldY(view, sy);
        const nextScale = view.scale * (next / state.zoom);
        const centerX = focusX - (sx - rect.width / 2) / nextScale;
        const centerY = focusY + (sy - rect.height / 2) / nextScale;
        const [panX, panY] = clampPan(
          bounds,
          centerX - (bounds.minX + bounds.maxX) / 2,
          centerY - (bounds.minY + bounds.maxY) / 2
        );
        state.panX = panX;
        state.panY = panY;
      }
      state.zoom = next;
      callbacksRef.current.onZoomChange(next);
      schedule();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    schedule();

    return () => {
      window.cancelAnimationFrame(queued);
      window.clearInterval(ticker);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      scheduleRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    state.map = props.map;
    state.showLidar = props.showLidar;
    state.zoom = props.zoom;
    state.follow = props.follow;
    state.guide = props.guide;
    state.missionStatus = props.missionStatus;
    scheduleRef.current();
  }, [
    props.map,
    props.showLidar,
    props.zoom,
    props.follow,
    props.guide,
    props.missionStatus
  ]);

  useEffect(() => {
    stateRef.current.layers = layers;
    stateRef.current.persistence = persistence;
    scheduleRef.current();
  }, [layers, persistence]);

  useEffect(() => {
    const state = stateRef.current;
    state.panX = 0;
    state.panY = 0;
    scheduleRef.current();
  }, [props.resetToken]);

  useEffect(() => {
    stateRef.current.trail = [];
    scheduleRef.current();
  }, [props.clearTrailToken]);

  useEffect(() => {
    const state = stateRef.current;
    state.pose = props.pose;
    if (props.pose === null) {
      state.trail = [];
      state.frames = [];
    } else {
      const now = performance.now();
      const last = state.trail[state.trail.length - 1];
      const moved =
        last === undefined
          ? Infinity
          : Math.hypot(props.pose.x - last.x, props.pose.y - last.y);
      if (moved > 1.5) {
        state.trail = [];
      }
      if (last === undefined || moved >= 0.02 || now - last.t > 1000) {
        const point: TrailPoint = { x: props.pose.x, y: props.pose.y, t: now };
        state.trail.push(point);
      }
      const oldest = now - TRAIL_SECONDS * 1000;
      while (
        state.trail.length > TRAIL_LIMIT ||
        (state.trail.length > 0 && state.trail[0].t < oldest)
      ) {
        state.trail.shift();
      }
    }
    scheduleRef.current();
  }, [props.pose]);

  useEffect(() => {
    const state = stateRef.current;
    state.scan = props.scan;
    if (props.scan !== null && props.pose !== null) {
      const last = state.frames[state.frames.length - 1];
      if (last === undefined || last.stamp !== props.scan.stamp) {
        state.frames.push(buildFrame(props.scan, props.pose));
        while (state.frames.length > FRAME_LIMIT) {
          state.frames.shift();
        }
      }
    }
    scheduleRef.current();
  }, [props.scan]);

  function keepTerminalFocus(event: React.MouseEvent<HTMLElement>) {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button, input, label") !== null
    ) {
      event.preventDefault();
    }
  }

  const pose = props.pose;
  const yawDegrees = pose === null ? 0 : (pose.yaw * 180) / Math.PI;
  const rangeMax = props.scan?.range_max ?? 8;

  return (
    <div className="viewer" data-testid="viewer">
      <canvas
        ref={canvasRef}
        className="warehouse-canvas"
        aria-label="Visor do armazém visto de cima"
        data-testid="warehouse-canvas"
        data-guide-region={props.guide?.region?.label ?? ""}
        data-guide-yaw={props.guide?.yawDeg ?? ""}
        data-guide-sector={props.guide?.sectorDeg ?? ""}
      />
      <div className="viewer-overlay" onMouseDown={keepTerminalFocus}>
        <div className="displays-panel" data-testid="displays-panel">
          <button
            type="button"
            className="displays-toggle"
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
            data-testid="displays-toggle"
          >
            Displays {panelOpen ? "▾" : "▸"}
          </button>
          {panelOpen ? (
            <div className="displays-body">
              <label className="displays-row">
                <input
                  type="checkbox"
                  checked={props.showLidar}
                  onChange={(event) => props.onShowLidarChange(event.target.checked)}
                  data-testid="layer-scan"
                />
                LaserScan
              </label>
              {layerLabels.map((item) => (
                <label
                  key={item.key}
                  className={`displays-row ${item.sub ? "displays-sub" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={layers[item.key]}
                    onChange={(event) =>
                      setLayers((previous) => ({
                        ...previous,
                        [item.key]: event.target.checked
                      }))
                    }
                    data-testid={`layer-${item.key}`}
                  />
                  {item.label}
                </label>
              ))}
              <div className="displays-persistence">
                <span>Decay (varreduras)</span>
                <div className="persistence-options">
                  {PERSISTENCE_OPTIONS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={persistence === count ? "persistence-on" : ""}
                      onClick={() => setPersistence(count)}
                      data-testid={`persistence-${count}`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="readout" data-testid="readout">
          <span className="readout-frame">Fixed Frame: odom</span>
          <span>
            x <strong>{formatNumber(pose?.x ?? 0)} m</strong>
          </span>
          <span>
            y <strong>{formatNumber(pose?.y ?? 0)} m</strong>
          </span>
          <span>
            yaw <strong>{formatNumber(yawDegrees, 1)}°</strong>
          </span>
          <span>
            v <strong>{formatNumber(pose?.vx ?? 0)} m/s</strong>
          </span>
          <span>
            ω <strong>{formatNumber(pose?.wz ?? 0)} rad/s</strong>
          </span>
        </div>
        <span className="cursor-readout" ref={cursorRef} data-testid="cursor-readout">
          cursor: —
        </span>
        <div className="range-legend" data-testid="range-legend">
          <span>0 m</span>
          <i style={{ background: rangeGradient() }} />
          <span>{formatNumber(rangeMax, 0)} m</span>
        </div>
      </div>
    </div>
  );
}
