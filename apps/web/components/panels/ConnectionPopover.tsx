"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Protocol } from "@labforge/schema";

const PROTOCOLS: { value: Protocol; label: string; defaultPort: number | null }[] = [
  { value: "tcp", label: "TCP", defaultPort: null },
  { value: "udp", label: "UDP", defaultPort: null },
  { value: "icmp", label: "ICMP", defaultPort: null },
  { value: "http", label: "HTTP", defaultPort: 80 },
  { value: "https", label: "HTTPS", defaultPort: 443 },
  { value: "ssh", label: "SSH", defaultPort: 22 },
  { value: "rdp", label: "RDP", defaultPort: 3389 },
  { value: "smb", label: "SMB", defaultPort: 445 },
  { value: "ldap", label: "LDAP", defaultPort: 389 },
  { value: "kerberos", label: "Kerberos", defaultPort: 88 },
  { value: "custom", label: "Custom", defaultPort: null },
];

interface ConnectionPopoverProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (protocol: Protocol, port: number | null) => void;
}

export function ConnectionPopover({ open, onCancel, onConfirm }: ConnectionPopoverProps) {
  const [protocol, setProtocol] = React.useState<Protocol>("tcp");
  const [port, setPort] = React.useState<string>("");

  React.useEffect(() => {
    if (open) {
      setProtocol("tcp");
      setPort("");
    }
  }, [open]);

  const handleProtocolChange = (next: string): void => {
    const entry = PROTOCOLS.find((p) => p.value === next);
    setProtocol((entry?.value ?? "tcp") as Protocol);
    if (entry?.defaultPort != null) {
      setPort(String(entry.defaultPort));
    } else {
      setPort("");
    }
  };

  const handleSubmit = (): void => {
    const parsed = port.trim() === "" ? null : Number.parseInt(port, 10);
    onConfirm(protocol, Number.isFinite(parsed) ? parsed : null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New connection</DialogTitle>
          <DialogDescription>
            Pick the protocol — port is optional and used in the generated firewall rules and
            README.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Protocol</Label>
            <Select value={protocol} onValueChange={handleProtocolChange}>
              <SelectTrigger>
                <SelectValue placeholder="Protocol" />
              </SelectTrigger>
              <SelectContent>
                {PROTOCOLS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="port">Port (optional)</Label>
            <Input
              id="port"
              type="number"
              placeholder="e.g. 443"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              min={1}
              max={65535}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Connect</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
