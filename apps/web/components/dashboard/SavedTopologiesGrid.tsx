"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookmarkIcon, FolderOpen, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { useTopologyStore } from "@/lib/store/topology-store";

/**
 * Dashboard card listing topologies the user has saved via the canvas
 * "Save topology" action. Distinct from <TopologiesGrid />, which
 * surfaces bundled, read-only templates.
 *
 * Hidden entirely when the user has nothing saved — empty-state is a
 * nudge in the existing TopologiesGrid card, not a second empty box.
 */
export function SavedTopologiesGrid() {
  const router = useRouter();
  const loadTopology = useTopologyStore((s) => s.loadTopology);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["stored-topologies"],
    queryFn: () => api.listStoredTopologies(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  // First render before the network round-trip lands: render a slim
  // skeleton so the dashboard layout doesn't shift.
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-1 h-3 w-72" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return null; // silently degrade — the dashboard has plenty else to show
  }

  const topologies = data ?? [];
  if (topologies.length === 0) return null;

  const handleOpen = async (slug: string): Promise<void> => {
    try {
      const topo = await api.getStoredTopology(slug);
      loadTopology(topo);
      toast.success("Topology loaded into canvas");
      router.push("/");
    } catch (err) {
      const e = err as { detail?: string };
      toast.error("Could not load topology", { description: e.detail });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookmarkIcon className="h-4 w-4" /> Saved topologies
          </CardTitle>
          <CardDescription className="text-xs">
            Designs you saved from the canvas — click to load and continue editing.
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="outline" className="h-8">
          <Link href="/">
            <Plus className="mr-1 h-3.5 w-3.5" />
            New
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {topologies.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => handleOpen(t.slug)}
              className="group flex flex-col rounded-md border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent/40"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{t.name}</p>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              {t.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {t.description}
                </p>
              )}
              <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <FolderOpen className="h-3 w-3" />
                Updated {new Date(t.updated_at).toLocaleString()}
              </p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
