"use client";

import * as React from "react";

/**
 * Tiny client for the lab live bus (`/api/v1/labs/{id}/ws`).
 *
 * Design notes:
 *   - The dev-server proxies `/api/v1/*` to the FastAPI app, so we
 *     translate that to `ws://.../api/v1/labs/{id}/ws` here.
 *   - One reconnection attempt with linear backoff (1s, 2s, 4s). After
 *     the third failure we surface ``status = "error"`` and let the
 *     caller fall back to its existing polling cadence — the polling
 *     code stays untouched so this hook is purely additive.
 *   - We never throw from inside the effect; errors are state.
 */

export interface LiveBusEvent {
  type: "hello" | "heartbeat" | string;
  // The server sends "data" for heartbeat envelopes; other envelopes
  // carry their own shape. Callers narrow on `type`.
  data?: unknown;
  // For "hello" envelopes the server includes the lab_id it bound to.
  lab_id?: number;
}

export type LiveBusStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

interface UseLiveBusOptions {
  enabled?: boolean;
  onEvent?: (event: LiveBusEvent) => void;
}

function resolveWsUrl(labId: number): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // The Next.js rewrite at /api/v1/* points to the API origin; we
  // mirror that prefix here so production deployments behind a single
  // hostname work without configuration.
  return `${proto}//${window.location.host}/api/v1/labs/${labId}/ws`;
}

export function useLiveBus(
  labId: number | null | undefined,
  options: UseLiveBusOptions = {},
): { status: LiveBusStatus; lastEvent: LiveBusEvent | null } {
  const { enabled = true, onEvent } = options;
  const [status, setStatus] = React.useState<LiveBusStatus>("idle");
  const [lastEvent, setLastEvent] = React.useState<LiveBusEvent | null>(null);

  // Stable ref so the effect doesn't reconnect when the caller passes
  // a fresh handler each render.
  const onEventRef = React.useRef(onEvent);
  React.useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  React.useEffect(() => {
    if (!enabled || !labId || !Number.isFinite(labId)) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: number | null = null;

    const connect = (): void => {
      if (cancelled) return;
      setStatus("connecting");
      try {
        ws = new WebSocket(resolveWsUrl(labId));
      } catch {
        setStatus("error");
        return;
      }

      ws.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setStatus("open");
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(ev.data) as LiveBusEvent;
          setLastEvent(parsed);
          onEventRef.current?.(parsed);
        } catch {
          // Malformed payload — ignore rather than tearing down the socket.
        }
      };

      const scheduleReconnect = (): void => {
        if (cancelled) return;
        attempt += 1;
        if (attempt > 3) {
          setStatus("error");
          return;
        }
        const delay = Math.min(4000, 1000 * 2 ** (attempt - 1));
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatus("closed");
        scheduleReconnect();
      };

      ws.onerror = () => {
        // `onerror` always precedes `onclose`; let onclose handle the
        // backoff so we don't schedule twice.
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [labId, enabled]);

  return { status, lastEvent };
}
