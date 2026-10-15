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
import { getStoredToken } from "@/lib/api/client";

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
    mutationFn: async () => {
      const token = getStoredToken();
      const res = await fetch(`/api/v1/labs/${labId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
    },
    onSuccess: () => {
      toast.success("Lab deleted", { description: labName });
      qc.invalidateQueries({ queryKey: ["labs"] });
      qc.invalidateQueries({ queryKey: ["lab", labId] });
      qc.invalidateQueries({ queryKey: ["lab-activity"] });
      setOpen(false);
      onDeleted?.();
    },
    onError: (err: Error) => {
      toast.error("Delete failed", { description: err.message });
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
            <DialogTitle>Delete this lab?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-medium text-foreground">{labName}</span> will be removed
                  from the dashboard. The Vagrant workspace on disk and any running VMs are{" "}
                  <span className="font-medium">not</span> touched.
                </p>
                <p>
                  If a build is still in flight, stop it from{" "}
                  <span className="font-medium">Monitor → Stop</span> first. To tear the VMs down
                  afterwards, either run{" "}
                  <code className="rounded bg-muted px-1 text-xs">vagrant destroy -f</code> in
                  the workspace directory or{" "}
                  <code className="rounded bg-muted px-1 text-xs">labforge destroy &lt;name&gt;</code>{" "}
                  from the CLI.
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
