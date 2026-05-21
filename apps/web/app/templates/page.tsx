"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { useTemplates } from "@/lib/api/hooks";
import { useTopologyStore } from "@/lib/store/topology-store";

export default function TemplatesPage() {
  const { data: templates, isLoading, isError } = useTemplates();
  const loadTopology = useTopologyStore((s) => s.loadTopology);
  const router = useRouter();

  const handleLoad = async (id: string): Promise<void> => {
    try {
      const topology = await api.getTemplate(id);
      loadTopology(topology);
      toast.success("Template loaded");
      router.push("/");
    } catch (err) {
      const e = err as { detail?: string };
      toast.error("Could not load template", { description: e.detail });
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to canvas
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">
            Curated lab topologies to bootstrap your scenario.
          </p>
        </div>
      </div>

      {isError && (
        <p className="text-sm text-destructive">
          Failed to load templates. Is the LabForge API running on :8000?
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading &&
          Array.from({ length: 5 }).map((_, idx) => (
            <Skeleton key={idx} className="h-44 w-full" />
          ))}

        {templates?.map((t) => (
          <Card key={t.id} className="flex flex-col">
            <CardHeader>
              <CardTitle>{t.name}</CardTitle>
              <CardDescription className="line-clamp-3">{t.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto flex items-center justify-between gap-2">
              <div className="flex gap-1.5">
                <Badge variant="secondary">{t.node_count} nodes</Badge>
                <Badge variant="outline">{t.edge_count} edges</Badge>
              </div>
              <Button size="sm" onClick={() => handleLoad(t.id)}>
                Open
              </Button>
            </CardContent>
          </Card>
        ))}

        {!isLoading && templates?.length === 0 && (
          <div className="col-span-full flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> No templates installed.
          </div>
        )}
      </div>
    </main>
  );
}
