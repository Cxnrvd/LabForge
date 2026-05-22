"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface RootErrorBoundaryProps {
  children: ReactNode;
}

interface RootErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches any uncaught render error in the React tree and shows a
 * recoverable panel instead of a blank canvas. Next.js App Router also
 * supports `error.tsx` per-segment, but a class boundary wrapping the
 * AppShell keeps a working frame (sidebar, theme) around the error so
 * navigation stays usable.
 */
export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  override state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[RootErrorBoundary] uncaught render error", error, info);
  }

  private handleReload = (): void => {
    this.setState({ error: null });
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  private handleDismiss = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    const err = this.state.error;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-2xl rounded-lg border border-red-500/40 bg-red-500/5 p-6 shadow-lg">
          <h2 className="mb-2 text-lg font-semibold text-red-500">
            Something broke in the LabForge UI
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            The page hit an uncaught error and stopped rendering. Reload to
            recover, or dismiss to keep the rest of the shell usable.
          </p>
          <pre className="mb-4 max-h-64 overflow-auto rounded bg-black/40 p-3 text-xs text-red-200">
            {err.name}: {err.message}
            {err.stack ? `\n\n${err.stack}` : ""}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={this.handleDismiss}
              className="rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }
}
