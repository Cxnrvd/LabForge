"use client";

import * as React from "react";
import { Crosshair, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ATTACK_TACTIC_COLORS,
  ATTACK_TACTIC_LABELS,
  AttackTactic,
  type AttackTag,
} from "@labforge/schema";
import { useTopologyStore } from "@/lib/store/topology-store";

interface NodeAttackTagsPanelProps {
  nodeId: string;
  tags: AttackTag[];
}

const TACTICS: AttackTactic[] = [
  "reconnaissance",
  "resource_development",
  "initial_access",
  "execution",
  "persistence",
  "privilege_escalation",
  "defense_evasion",
  "credential_access",
  "discovery",
  "lateral_movement",
  "collection",
  "command_and_control",
  "exfiltration",
  "impact",
];

/**
 * Editor for the MITRE ATT&CK tags on a single node. Designed to slot
 * into the existing NodeConfigPanel as a new tab. Tags are persisted
 * inline on the TopologyNode via the canvas store.
 */
export function NodeAttackTagsPanel({ nodeId, tags }: NodeAttackTagsPanelProps) {
  const updateNodeConfig = useTopologyStore((s) => s.updateNodeConfig);
  const [tactic, setTactic] = React.useState<AttackTactic>("initial_access");
  const [technique, setTechnique] = React.useState("");
  const [note, setNote] = React.useState("");

  const setTags = (next: AttackTag[]): void => {
    updateNodeConfig(nodeId, (node) => ({ ...node, attack_tags: next }));
  };

  const add = (): void => {
    const trimmedTechnique = technique.trim();
    const validTechnique = !trimmedTechnique || /^T\d{4}(\.\d{3})?$/.test(trimmedTechnique);
    if (!validTechnique) return;
    setTags([
      ...tags,
      {
        tactic,
        technique: trimmedTechnique || null,
        note: note.trim() || null,
      },
    ]);
    setTechnique("");
    setNote("");
  };

  const remove = (idx: number): void => {
    setTags(tags.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3 p-3">
      <header>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Crosshair className="h-4 w-4" /> MITRE ATT&CK coverage
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Tag what this node represents in the attack chain. Used to colour the canvas
          and to enrich the generated lab report.
        </p>
      </header>

      <div className="space-y-1.5">
        <Label className="text-xs">Tactic</Label>
        <Select value={tactic} onValueChange={(v) => setTactic(v as AttackTactic)}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TACTICS.map((t) => (
              <SelectItem key={t} value={t}>
                <span
                  className="mr-2 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: ATTACK_TACTIC_COLORS[t] }}
                />
                {ATTACK_TACTIC_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        <div>
          <Label htmlFor="atk-tech" className="text-xs">Technique (optional)</Label>
          <Input
            id="atk-tech"
            value={technique}
            onChange={(e) => setTechnique(e.target.value)}
            placeholder="T1190 or T1190.001"
            className="h-9"
          />
        </div>
        <div>
          <Label htmlFor="atk-note" className="text-xs">Note (optional)</Label>
          <Input
            id="atk-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Spring4Shell ingress"
            className="h-9"
          />
        </div>
      </div>
      <Button size="sm" className="w-full" onClick={add}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add tag
      </Button>

      <div className="space-y-1.5">
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tags yet.</p>
        ) : (
          tags.map((tag, idx) => (
            <div
              key={`${tag.tactic}-${idx}`}
              className="flex items-center gap-2 rounded-md border bg-card/30 px-2 py-1.5 text-xs"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: ATTACK_TACTIC_COLORS[tag.tactic] }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {ATTACK_TACTIC_LABELS[tag.tactic]}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {tag.technique ? <code>{tag.technique}</code> : "—"}
                  {tag.note ? ` · ${tag.note}` : ""}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {idx + 1}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => remove(idx)}
                aria-label="Remove tag"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
