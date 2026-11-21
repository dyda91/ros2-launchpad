import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { wsUrl } from "../lib/api";
import type { InsertResult, TerminalState } from "../types";

export interface TerminalHandle {
  insert: (text: string) => void;
  focus: () => void;
}

interface TerminalProps {
  wsPath: string;
  onTerminalState?: (state: TerminalState) => void;
  onInsertResult?: (result: InsertResult) => void;
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ wsPath, onTerminalState, onInsertResult }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const terminalStateCallback = useRef(onTerminalState);
    const insertResultCallback = useRef(onInsertResult);

    useEffect(() => {
      terminalStateCallback.current = onTerminalState;
      insertResultCallback.current = onInsertResult;
    }, [onTerminalState, onInsertResult]);

    useImperativeHandle(
      ref,
      () => ({
        insert(text: string) {
          const socket = socketRef.current;
          if (socket !== null && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "insert", data: text }));
          }
        },
        focus() {
          terminalRef.current?.focus();
        }
      }),
      []
    );

    useEffect(() => {
      if (containerRef.current === null) {
        return;
      }
      const terminal = new XTerm({
        cursorBlink: true,
        convertEol: false,
        fontFamily:
          '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
        fontSize: 14,
        scrollback: 5000,
        theme: {
          background: "#0b1016",
          foreground: "#d7e1ea",
          cursor: "#6ee7b7",
          selectionBackground: "#264653",
          black: "#0b1016",
          red: "#f87171",
          green: "#6ee7b7",
          yellow: "#fbbf24",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#d7e1ea"
        }
      });
      terminalRef.current = terminal;
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(containerRef.current);
      fit.fit();
      terminal.focus();

      let active = true;
      const socket = new WebSocket(wsUrl(wsPath));
      socketRef.current = socket;
      socket.onopen = () => {
        if (!active) {
          return;
        }
        fit.fit();
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows
          })
        );
        terminal.focus();
      };
      socket.onmessage = (event) => {
        if (!active) {
          return;
        }
        try {
          const message = JSON.parse(event.data as string);
          if (message.type === "output") {
            terminal.write(message.data as string);
          } else if (message.type === "terminal_state") {
            terminalStateCallback.current?.({
              prompt: Boolean(message.prompt),
              lineEmpty: Boolean(message.lineEmpty),
              running: Boolean(message.running)
            });
          } else if (message.type === "insert_result") {
            insertResultCallback.current?.({
              ok: Boolean(message.ok),
              reason: String(message.reason ?? "")
            });
          }
        } catch {
          terminal.write(event.data as string);
        }
      };
      socket.onclose = () => {
        if (!active) {
          return;
        }
        terminal.write("\r\n[conexão encerrada]\r\n");
        terminalStateCallback.current?.({
          prompt: false,
          lineEmpty: false,
          running: false
        });
      };

      const dataSubscription = terminal.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", data }));
        }
      });
      const resizeSubscription = terminal.onResize(({ cols, rows }) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });
      const observer = new ResizeObserver(() => {
        fit.fit();
      });
      observer.observe(containerRef.current);

      return () => {
        active = false;
        observer.disconnect();
        dataSubscription.dispose();
        resizeSubscription.dispose();
        socket.close();
        socketRef.current = null;
        terminalRef.current = null;
        terminal.dispose();
      };
    }, [wsPath]);

    return (
      <div
        className="terminal"
        data-testid="terminal"
        ref={containerRef}
        aria-label="Terminal do laboratório"
      />
    );
  }
);

Terminal.displayName = "Terminal";

export default Terminal;
