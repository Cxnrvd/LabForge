"use client";

import * as React from "react";
import { Camera, History, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface Snapshot {
  id: string;
  hostname: string;
  name: string;
  takenAt: string;
}

interface SnapshotControlsProps {
  labId: number;
  vms: { hostname: string; state: string }[];
}

/**
 * Snapshot / checkpoint UI per VM. Talks to the API at
 * ``/api/v1/labs/{id}/snapshot/{vm}`` — that endpoint is *planned*
 * (the agent will call ``vagrant snapshot save / restore`` under the
 * hood). Until it lands, this component keeps a local list so the UX
 * is testable end-to-end against a mock.
 *
 * Why ship the UI now? Because IR/forensics workflows depend on rewind,
 * and adding it to the agent is a small wrapper — the UX is the part
 * that needs iteration.
 */
const STORAGE_KEY = "labforge.snapshots.local.v1";

function readLocalSnapshots(labId: number): Snapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const blob = window.localStorage.getItem(`${STORAGE_KEY}:${labId}`);
    return blob ? (JSON.parse(blob) as Snapshot[]) : [];
  } catch {
    return [];
  }
}

function writeLocalSnapshots(labId: number, snapshots: Snapshot[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_KEY}:${labId}`, JSON.stringify(snapshots));
  } catch {
    /* ignore */
  }
}

export function SnapshotControls({ labId, vms }: SnapshotControlsProps) {
  const [snapshots, setSnapshots] = React.useState<Snapshot[]>([]);
  const [target, setTarget] = React.useState<string>(vms[0]?.hostname ?? "");
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    setSnapshots(readLocalSnapshots(labId));
  }, [labId]);

  const save = (): void => {
    if (!target || !name) {
      toast.error("Pick a VM and name the snapshot.");
      return;
    }
    const snap: Snapshot = {
      id: `${target}-${Date.now()}`,
      hostname: target,
      name,
      takenAt: new Date().toISOString(),
    };
    const next = [snap, ...snapshots];
    setSnapshots(next);
    writeLocalSnapshots(labId, next);
    setName("");
    toast.success(`Snapshot '${snap.name}' queued for ${snap.hostname}`, {
      description: "API endpoint /labs/{id}/snapshot/{vm} is pending — see code comments.",
    });
  };

  const restore = (snap: Snapshot): void => {
    toast.message(`Restore '${snap.name}' on ${snap.hostname}`, {
      description: "Would run vagrant snapshot restore via the agent.",
    });
  };

  const remove = (id: string): void => {
    const next = snapshots.filter((s) => s.id !== id);
    setSnapshots(next);
    writeLocalSnapshots(labId, next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="h-4 w-4" /> Snapshots
        </CardTitle>
        <CardDescription>
          Per-VM checkpoints. Capture before detonating malware; rewind after to compare
          before/after artefacts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
          <div>
            <Label htmlFor="snap-vm" className="text-xs">VM</Label>
            <select
              id="snap-vm"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-xs"
            >
              {vms.map((vm) => (
                <option key={vm.hostname} value={vm.hostname}>
                  {vm.hostname}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="snap-name" className="text-xs">Name</Label>
            <Input
              id="snap-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="pre-payload"
              className="h-9"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={save}>
              <Save className="mr-1 h-4 w-4" /> Capture
            </Button>
          </div>
        </div>
        <Separator />
        <div className="space-y-2">
          {snapshots.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No snapshots yet. Capture one before running risky payloads.
            </p>
          )}
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className="flex items-center gap-2 rounded-md border bg-card/30 px-3 py-2"
            >
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{snap.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {snap.hostname} · {new Date(snap.takenAt).toLocaleString()}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => restore(snap)}>
                <RotateCcw className="mr-1 h-3 w-3" /> Restore
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(snap.id)}>
                Delete
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
