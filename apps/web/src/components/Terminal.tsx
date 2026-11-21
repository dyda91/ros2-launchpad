import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { wsUrl } from "../lib/api";

export default function Terminal({ wsPath }: { wsPath: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

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
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    fit.fit();
    terminal.focus();

    const socket = new WebSocket(wsUrl(wsPath));
    socket.onopen = () => {
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
      try {
        const message = JSON.parse(event.data as string);
        if (message.type === "output") {
          terminal.write(message.data as string);
        }
      } catch {
        terminal.write(event.data as string);
      }
    };
    socket.onclose = () => {
      terminal.write("\r\n[conexão encerrada]\r\n");
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
      observer.disconnect();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      socket.close();
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
