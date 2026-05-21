"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Boxes, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTemplates } from "@/lib/api/hooks";

export function TopologiesGrid() {
  const { data: templates, isLoading } = useTemplates();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-4 w-4" /> Topologies
          </CardTitle>
          <CardDescription className="text-xs">
            Saved designs and bundled templates — click to open the canvas.
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="outline" className="h-8">
          <Link href="/build">
            <Plus className="mr-1 h-3.5 w-3.5" />
            New
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading &&
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          {templates?.map((t) => (
            <Link
              key={t.id}
              href={`/build/${t.id}`}
              className="group rounded-md border bg-card p-3 transition-colors hover:border-primary hover:bg-accent/40"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{t.name}</p>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {t.description}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <Badge variant="secondary" className="text-[10px]">
                  {t.node_count} nodes
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {t.edge_count} edges
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
