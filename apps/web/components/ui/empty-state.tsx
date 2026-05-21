"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface EmptyStateProps {
  Icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  className?: string;
}

/**
 * Reusable empty state. Use anywhere a list might be empty — labs,
 * monitor, templates, activity feed. Centralised so the tone and
 * spacing stay consistent across the app.
 */
export function EmptyState({
  Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-card/30 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="rounded-full border bg-background p-3 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="max-w-md text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <Button asChild={!!action.href} variant="outline" size="sm" onClick={action.onClick}>
          {action.href ? <a href={action.href}>{action.label}</a> : action.label}
        </Button>
      )}
    </div>
  );
}
