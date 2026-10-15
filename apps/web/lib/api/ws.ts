"use client";

import * as React from "react";

/**
 * React hook that subscribes to the lab-telemetry WebSocket at
 * ``/api/v1/labs/{id}/ws``. Receives one JSON envelope per heartbeat:
 *
 *   { type: "hello", lab_id: N }
 *   { type: "heartbeat", data: HeartbeatPayload }
 *
 * The hook auto-reconnects with exponential backoff on close — so a
 * dropped connection (uvicorn reload, server restart) recovers without
 * the user refreshing.
 */

export interface LabStreamEnvelope {
  type: "hello" | "heartbeat";
  data?: unknown;
  lab_id?: number;
}

interface UseLabStreamOptions {
  labId: number | null;
  enabled?: boolean;
  onMessage?: (message: LabStreamEnvelope) => void;
}

function buildWsUrl(labId: number): string | null {
  if (typeof window === "undefined") return null;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/labs/${labId}/ws`;
}

export function useLabStream({ labId, enabled = true, onMessage }: UseLabStreamOptions) {
  const [status, setStatus] = React.useState<"idle" | "connecting" | "open" | "closed">(
    "idle",
  );
  const [lastMessage, setLastMessage] = React.useState<LabStreamEnvelope | null>(null);
  const onMessageRef = React.useRef(onMessage);
  React.useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  React.useEffect(() => {
    if (!enabled || labId === null || !Number.isFinite(labId)) {
      setStatus("idle");
      return;
    }
    const url = buildWsUrl(labId);
    if (!url) return;

    let cancelled = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let reopen: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      socket = new WebSocket(url);
      socket.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setStatus("open");
      };
      socket.onmessage = (event) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(event.data) as LabStreamEnvelope;
          setLastMessage(parsed);
          onMessageRef.current?.(parsed);
        } catch {
          // ignore malformed frame
        }
      };
      socket.onclose = () => {
        setStatus("closed");
        if (cancelled) return;
        // Backoff: 0.5 s, 1 s, 2 s, 4 s, capped at 10 s.
        const delay = Math.min(500 * 2 ** attempt, 10_000);
        attempt += 1;
        reopen = setTimeout(connect, delay);
      };
      socket.onerror = () => {
        // ``onclose`` will fire next; nothing to do here other than log.
        socket?.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reopen) clearTimeout(reopen);
      socket?.close();
    };
  }, [labId, enabled]);

  return { status, lastMessage };
}
