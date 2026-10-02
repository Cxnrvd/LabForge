"use client";

import { create } from "zustand";

interface LaunchState {
  open: boolean;
  show: () => void;
  hide: () => void;
  setOpen: (v: boolean) => void;
}

/** Controls the global Launch dialog (mounted once in AppShell). */
export const useLaunchStore = create<LaunchState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  setOpen: (open) => set({ open }),
}));
