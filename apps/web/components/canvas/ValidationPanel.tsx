"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import {
  AlertOctagon,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { isZone, useTopologyStore } from "@/lib/store/topology-store";

/**
 * Bottom-anchored canvas overlay that surfaces the latest validation
 * issues. Click an issue → pan/zoom to the offending node. Collapses to
 * a single header bar when there are no issues to keep the canvas clean.
 */
export function ValidationPanel() {
  const issues = useTopologyStore(useShallow((s) => s.validationIssues));
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const setValidationIssues = useTopologyStore((s) => s.setValidationIssues);
  const { setCenter, getNode, getZoom } = useReactFlow();

  const [open, setOpen] = React.useState(true);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const total = issues.length;
  const allClear = total === 0;

  // Auto-expand when new issues arrive.
  const prevTotal = React.useRef(0);
  React.useEffect(() => {
    if (total > 0 && total !== prevTotal.current) setOpen(true);
    prevTotal.current = total;
  }, [total]);

  const jumpTo = (nodeId: string | null): void => {
    if (!nodeId) return;
    const node = getNode(nodeId);
    if (!node) return;
    if (!isZone(node as never)) {
      setSelectedNode(nodeId);
    }
    const x = node.position.x + (node.measured?.width ?? 140) / 2;
    const y = node.position.y + (node.measured?.height ?? 140) / 2;
    setCenter(x, y, { zoom: Math.max(getZoom(), 1.1), duration: 450 });
  };

  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-3 left-3 right-3 z-10 rounded-lg border bg-background/95 shadow-lg backdrop-blur transition-all",
        allClear ? "max-w-[320px]" : "max-w-[520px]",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/40"
      >
        {allClear ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : errors.length > 0 ? (
          <AlertOctagon className="h-4 w-4 text-red-500" />
        ) : (
          <TriangleAlert className="h-4 w-4 text-amber-500" />
        )}
        <span className="text-sm font-semibold">
          {allClear
            ? "No issues"
            : `${total} issue${total === 1 ? "" : "s"}`}
        </span>
        {!allClear && (
          <span className="text-xs text-muted-foreground">
            {errors.length > 0 && `${errors.length} error${errors.length === 1 ? "" : "s"}`}
            {errors.length > 0 && warnings.length > 0 && " · "}
            {warnings.length > 0 && `${warnings.length} warn`}
          </span>
        )}
        <span className="ml-auto text-muted-foreground">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>

      {!allClear && open && (
        <ul className="max-h-56 divide-y overflow-y-auto border-t">
          {[...errors, ...warnings].map((issue, idx) => (
            <li key={`${issue.node_id ?? "x"}-${issue.field ?? "x"}-${idx}`}>
              <button
                type="button"
                onClick={() => jumpTo(issue.node_id)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40"
              >
                {issue.severity === "error" ? (
                  <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{issue.message}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {issue.node_id && `node ${issue.node_id}`}
                    {issue.field && ` · field "${issue.field}"`}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!allClear && open && (
        <div className="flex items-center justify-end border-t px-2 py-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setValidationIssues([])}
          >
            Dismiss all
          </Button>
        </div>
      )}
    </div>
  );
}
