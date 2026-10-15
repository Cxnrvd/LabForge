"use client";

import * as React from "react";
import { Loader2, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { useReactFlow } from "@xyflow/react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api/client";
import { useTemplates } from "@/lib/api/hooks";
import { useTopologyStore } from "@/lib/store/topology-store";

interface TemplateGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplateGallery({ open, onOpenChange }: TemplateGalleryProps) {
  const { data: templates, isLoading, isError } = useTemplates();
  const loadTopology = useTopologyStore((s) => s.loadTopology);
  const { fitView } = useReactFlow();

  const handleLoad = async (id: string): Promise<void> => {
    try {
      const topology = await api.getTemplate(id);
      loadTopology(topology);
      onOpenChange(false);
      // Wait one tick so React Flow has the new node measurements before
      // computing the fit-view bounds.
      // Two passes: a quick one at 80 ms with whatever measurements are
      // ready, then a follow-up at 280 ms once React Flow has measured the
      // freshly-mounted nodes (including zone widths). Without the second
      // pass the first fitView can mis-center because zone bounds aren't
      // settled yet.
      window.setTimeout(() => {
        fitView({ padding: 0.25, duration: 0, minZoom: 0.2, maxZoom: 1.5 });
      }, 80);
      window.setTimeout(() => {
        fitView({ padding: 0.25, duration: 450, minZoom: 0.2, maxZoom: 1.5 });
      }, 280);
      toast.success("Template loaded", { description: topology.name });
    } catch (err) {
      const e = err as { detail?: string };
      toast.error("Could not load template", { description: e.detail });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5" />
            Prebuilt templates
          </DialogTitle>
          <DialogDescription>
            Start from a curated topology — you can edit any node after loading.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="grid gap-3 sm:grid-cols-2">
            {isLoading &&
              Array.from({ length: 4 }).map((_, idx) => (
                <Skeleton key={idx} className="h-32 w-full" />
              ))}
            {isError && (
              <p className="text-sm text-destructive">
                Failed to load templates. Is the API running?
              </p>
            )}
            {templates?.map((t) => (
              <Card
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => handleLoad(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLoad(t.id);
                }}
                className="cursor-pointer transition-colors hover:border-primary"
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t.name}</CardTitle>
                  <CardDescription className="line-clamp-2">{t.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2 pt-0">
                  <Badge variant="secondary">{t.node_count} nodes</Badge>
                  <Badge variant="outline">{t.edge_count} edges</Badge>
                </CardContent>
              </Card>
            ))}
            {templates?.length === 0 && (
              <div className="col-span-full flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                No templates installed.
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
