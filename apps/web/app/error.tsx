"use client";

import * as React from "react";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }): React.ReactElement {
  return (
    <main className="page" style={{ maxWidth: 560 }}>
      <div className="scard" style={{ marginTop: 48 }}>
        <div className="eyebrow">Something went wrong</div>
        <h1 className="home-title" style={{ marginTop: 6 }}>This page hit an error</h1>
        <p className="home-sub" style={{ marginTop: 8 }}>
          Nothing was lost. Try again, and if it keeps happening check that the API is running (pnpm dev).
        </p>
        <pre className="code" style={{ marginTop: 12, fontSize: 11, whiteSpace: "pre-wrap" }}>{error.message}</pre>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" className="btn primary" onClick={reset}>Try again</button>
          <a href="/" className="btn">Go to Home</a>
        </div>
      </div>
    </main>
  );
}
