"use client";

import * as React from "react";

/**
 * False on the server and during the first client render, true afterwards. Anything that reads
 * browser-only state (persisted stores, window, navigator) should render its empty form until this
 * is true, otherwise the server HTML and the first client render differ and React reports a
 * hydration error.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  return hydrated;
}
