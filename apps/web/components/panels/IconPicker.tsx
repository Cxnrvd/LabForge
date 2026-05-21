"use client";

import * as React from "react";
import { Check, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils/cn";
import {
  CATEGORY_ORDER,
  searchVendors,
  type IconCategory,
  type VendorEntry,
} from "@/lib/icons/catalog";
import { VendorIconInner } from "@/components/icons/VendorIcon";

interface IconPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  onToggle: (id: string) => void;
}

export function IconPicker({ open, onOpenChange, selected, onToggle }: IconPickerProps) {
  const [query, setQuery] = React.useState("");
  const grouped = React.useMemo(() => {
    const results = searchVendors(query);
    const out = Object.fromEntries(
      CATEGORY_ORDER.map((c) => [c, [] as VendorEntry[]]),
    ) as Record<IconCategory, VendorEntry[]>;
    for (const entry of results) out[entry.category].push(entry);
    return out;
  }, [query]);

  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const totalMatches = React.useMemo(
    () => CATEGORY_ORDER.reduce((acc, c) => acc + grouped[c].length, 0),
    [grouped],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add services & tooling</DialogTitle>
          <DialogDescription>
            Pick the security stack, services, or platforms installed on this node. They appear
            as logo badges on the canvas.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Splunk, Wazuh, MDE, github…"
            className="pl-8"
            autoFocus
          />
        </div>

        <ScrollArea className="h-[55vh] pr-4">
          <div className="space-y-5">
            {CATEGORY_ORDER.map((category) => {
              const entries = grouped[category];
              if (entries.length === 0) return null;
              return (
                <section key={category}>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{category}</h3>
                    <Badge variant="outline" className="text-[10px]">
                      {entries.length}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {entries.map((entry) => {
                      const isSelected = selectedSet.has(entry.id);
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => onToggle(entry.id)}
                          className={cn(
                            "group flex items-center gap-2 rounded-md border p-2 text-left transition-colors",
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "border-input hover:bg-accent",
                          )}
                        >
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background"
                            style={{ borderColor: entry.color + "44" }}
                          >
                            <VendorIconInner entry={entry} size={16} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">
                              {entry.label}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {entry.description}
                            </span>
                          </span>
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {totalMatches === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No vendors match &quot;{query}&quot;.
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
