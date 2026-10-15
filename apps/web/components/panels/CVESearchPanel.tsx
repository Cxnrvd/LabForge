"use client";

import * as React from "react";
import { Eye, Loader2, Plus, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCveSearch } from "@/lib/api/hooks";
import type { CVEEntry } from "@labforge/schema";

type Severity = CVEEntry["severity"];

interface CVESearchPanelProps {
  attached: string[];
  onAdd: (cve: string) => void;
  onRemove: (cve: string) => void;
}

const SEVERITY_VARIANT: Record<Severity, "critical" | "high" | "medium" | "low" | "outline"> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  NONE: "outline",
};

export function CVESearchPanel({ attached, onAdd, onRemove }: CVESearchPanelProps) {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const { data, isFetching, isError, error } = useCveSearch(debounced);

  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(handle);
  }, [query]);

  const errMessage = (error as { detail?: string } | null)?.detail;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="CVE-2021-44228 or 'log4j'"
            className="pl-8"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Search the NVD by CVE-ID or keyword. Adding a CVE wires up its provisioner script (if
          curated) into the generated lab.
        </p>
      </div>

      {attached.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Attached</p>
          <div className="flex flex-wrap gap-1.5">
            {attached.map((cve) => (
              <Badge key={cve} variant="secondary" className="flex items-center gap-1 font-mono">
                {cve}
                <button onClick={() => onRemove(cve)} aria-label={`Remove ${cve}`}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="space-y-2 pr-3">
          {isFetching && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching NVD…
            </div>
          )}
          {isError && (
            <p className="text-xs text-destructive">
              {errMessage ?? "NVD lookup failed. Try again in a moment."}
            </p>
          )}
          {data?.length === 0 && !isFetching && (
            <p className="text-xs text-muted-foreground">No CVEs match.</p>
          )}
          {data?.map((entry) => (
            <CveResult
              key={entry.id}
              entry={entry}
              isAttached={attached.includes(entry.id)}
              onAdd={() => onAdd(entry.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function CveResult({
  entry,
  isAttached,
  onAdd,
}: {
  entry: CVEEntry;
  isAttached: boolean;
  onAdd: () => void;
}) {
  return (
    <Card className="border-muted">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs font-semibold">{entry.id}</span>
            <Badge variant={SEVERITY_VARIANT[entry.severity]} className="text-[10px]">
              {entry.severity}
            </Badge>
            {entry.cvss_score != null && (
              <Badge variant="outline" className="text-[10px]">
                CVSS {entry.cvss_score.toFixed(1)}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant={isAttached ? "secondary" : "outline"}
            onClick={onAdd}
            disabled={isAttached}
            className="h-7 px-2"
          >
            {isAttached ? (
              <>
                <Eye className="mr-1 h-3 w-3" />
                Added
              </>
            ) : (
              <>
                <Plus className="mr-1 h-3 w-3" />
                Add
              </>
            )}
          </Button>
        </div>
        <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{entry.description}</p>
      </CardContent>
    </Card>
  );
}
