"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api/client";

interface DeleteLabButtonProps {
  labId: number;
  labName: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  label?: string;
  className?: string;
  onDeleted?: () => void;
}

export function DeleteLabButton({
  labId,
  labName,
  variant = "ghost",
  size = "icon",
  label,
  className,
  onDeleted,
}: DeleteLabButtonProps) {
  const [open, setOpen] = React.useState(false);
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: () => api.destroyLab(labId),
    onSuccess: () => {
      toast.success("Lab deleted", { description: labName });
      qc.invalidateQueries({ queryKey: ["labs"] });
      qc.invalidateQueries({ queryKey: ["lab", labId] });
      qc.invalidateQueries({ queryKey: ["lab-activity"] });
      setOpen(false);
      onDeleted?.();
    },
    onError: (err: unknown) => {
      const e = err as { detail?: string; message?: string };
      toast.error("Delete failed", { description: e.detail ?? e.message });
    },
  });

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Delete ${labName}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Destroy this lab?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-medium text-foreground">{labName}</span> will be{" "}
                  <span className="font-medium">destroyed</span>: its running VMs or containers,
                  networks, volumes and workspace directory are removed, then the dashboard entry.
                  This cannot be undone.
                </p>
                <p>
                  If the teardown fails the lab is kept and marked{" "}
                  <code className="rounded bg-muted px-1 text-xs">destroy_failed</code> so nothing
                  is left running unnoticed.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={mut.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => mut.mutate()}
              disabled={mut.isPending}
            >
              {mut.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
