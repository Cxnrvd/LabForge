"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Binding {
  combo: string[];
  description: string;
}

const GROUPS: { name: string; bindings: Binding[] }[] = [
  {
    name: "Anywhere",
    bindings: [
      { combo: ["⌘", "K"], description: "Open command palette" },
      { combo: ["?"], description: "Show this dialog" },
    ],
  },
  {
    name: "Canvas (/build)",
    bindings: [
      { combo: ["⌫"], description: "Delete selected node / edge" },
      { combo: ["⌘", "Z"], description: "Undo" },
      { combo: ["⇧", "⌘", "Z"], description: "Redo" },
      { combo: ["Drag handle"], description: "Connect two nodes" },
    ],
  },
  {
    name: "Lab monitor (/labs/[id])",
    bindings: [
      { combo: ["Esc"], description: "Clear focused host" },
      { combo: ["Click node"], description: "Focus host (dim other edges)" },
    ],
  },
];

interface KeybindingsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeybindingsHelp({ open, onOpenChange }: KeybindingsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Quick reference. Cmd is shown for Mac; use Ctrl on Windows/Linux.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {GROUPS.map((group) => (
            <div key={group.name}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.name}
              </p>
              <ul className="space-y-1.5">
                {group.bindings.map((b) => (
                  <li
                    key={b.description}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-foreground/80">{b.description}</span>
                    <span className="flex items-center gap-1">
                      {b.combo.map((k, i) => (
                        <kbd
                          key={i}
                          className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
