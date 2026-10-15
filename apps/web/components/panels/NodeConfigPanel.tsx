"use client";

import * as React from "react";
import { Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CVESearchPanel } from "./CVESearchPanel";
import { IconPicker } from "./IconPicker";
import { NodeAttackTagsPanel } from "./NodeAttackTagsPanel";
import { VendorIconInner } from "@/components/icons/VendorIcon";
import {
  encodeRole,
  lookupVendor,
  parseRole,
  type VendorEntry,
} from "@/lib/icons/catalog";
import {
  type NodeType,
  type OsType,
  OS_LABELS,
} from "@labforge/schema";
import {
  findIssuesForNode,
  useTopologyStore,
  type FlowNode,
} from "@/lib/store/topology-store";

const OS_BY_TYPE: Record<NodeType, OsType[]> = {
  workstation: [
    "windows_10",
    "windows_11",
    "macos_sonoma",
    "macos_sequoia",
    "ubuntu_2204",
    "ubuntu_2404",
    "debian_12",
    "fedora_40",
    "opensuse_tumbleweed",
    "arch_rolling",
    "tails_6",
    "whonix_17",
    "parrot_security",
  ],
  server: [
    "ubuntu_2204",
    "ubuntu_2404",
    "debian_12",
    "rhel_9",
    "centos_stream_9",
    "fedora_40",
    "opensuse_tumbleweed",
    "alpine_latest",
    "freebsd_14",
    "windows_server_2019",
    "windows_server_2022",
  ],
  domain_controller: ["windows_server_2019", "windows_server_2022"],
  router: [
    "openwrt_23",
    "vyos_1_4",
    "routeros_7",
    "cisco_ios_xe",
    "juniper_junos_22",
    "ubuntu_2204",
    "debian_12",
    "alpine_latest",
  ],
  firewall: [
    "pfsense_2_7",
    "opnsense_24",
    "fortios_7",
    "panos_11",
    "sophos_xg_19",
    "ubuntu_2204",
    "debian_12",
    "alpine_latest",
  ],
  attacker: [
    "kali_rolling",
    "parrot_security",
    "blackarch_rolling",
    "tails_6",
    "whonix_17",
    "ubuntu_2204",
    "debian_12",
    "arch_rolling",
  ],
  target: [
    "ubuntu_2204",
    "ubuntu_2404",
    "debian_12",
    "centos_stream_9",
    "rhel_9",
    "alpine_latest",
    "freebsd_14",
    "windows_10",
    "windows_server_2019",
    "raspbian_12",
  ],
  database: [
    "ubuntu_2204",
    "debian_12",
    "rhel_9",
    "centos_stream_9",
    "alpine_latest",
    "windows_server_2019",
  ],
  ics_plc: [
    "siemens_simatic",
    "schneider_modicon",
    "vxworks_7",
    "qnx_neutrino",
    "raspbian_12",
    "ubuntu_2204",
    "alpine_latest",
  ],
  ics_hmi: [
    "windows_10",
    "windows_11",
    "ubuntu_2204",
    "debian_12",
    "raspbian_12",
  ],
  camera: [
    "ip_camera_firmware",
    "raspbian_12",
    "alpine_latest",
    "ubuntu_2204",
    "debian_12",
  ],
  internet: ["ubuntu_2204"],
};

export function NodeConfigPanel() {
  const selectedId = useTopologyStore((s) => s.selectedNodeId);
  const node = useTopologyStore((s) => {
    const n = s.nodes.find((x) => x.id === s.selectedNodeId);
    if (!n || n.type === "zone") return undefined;
    return (n as FlowNode).data.topologyNode;
  });
  const updateNodeConfig = useTopologyStore((s) => s.updateNodeConfig);
  const removeNode = useTopologyStore((s) => s.removeNode);
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const issues = useTopologyStore(
    useShallow((s) =>
      selectedId ? findIssuesForNode(s.validationIssues, selectedId) : [],
    ),
  );

  const [showPassword, setShowPassword] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [customRoleDraft, setCustomRoleDraft] = React.useState("");
  const open = !!selectedId && !!node;

  if (!node || !selectedId) {
    return (
      <Sheet open={false} onOpenChange={() => setSelectedNode(null)}>
        <SheetContent />
      </Sheet>
    );
  }

  type NodeConfig = NonNullable<typeof node>["config"];
  const update = (
    updater: (config: NodeConfig) => NodeConfig,
  ): void => {
    updateNodeConfig(selectedId, (n) => ({ ...n, config: updater(n.config) }));
  };

  const setLabel = (label: string): void => {
    updateNodeConfig(selectedId, (n) => ({ ...n, label }));
  };

  // Partition the roles array into vendor entries (with logos + versions) vs
  // plain custom roles (flat strings like AD-Domain-Services).
  const vendorRoles: { role: string; entry: VendorEntry; version: string | null }[] = [];
  const customRoles: string[] = [];
  for (const role of node.config.roles) {
    const entry = lookupVendor(role);
    if (entry) {
      vendorRoles.push({ role, entry, version: parseRole(role).version });
    } else {
      customRoles.push(role);
    }
  }

  /**
   * Toggle a vendor by its catalog id. Removes any existing role pointing at
   * the vendor regardless of version; otherwise adds the role with the
   * default (most-recent) version when the vendor declares versions.
   */
  const togglePicker = (vendorId: string): void => {
    update((c) => {
      const matches = c.roles.filter((r) => parseRole(r).id === vendorId);
      if (matches.length > 0) {
        return { ...c, roles: c.roles.filter((r) => !matches.includes(r)) };
      }
      const entry = lookupVendor(vendorId);
      const defaultVersion = entry?.versions?.[0] ?? null;
      return { ...c, roles: [...c.roles, encodeRole(vendorId, defaultVersion)] };
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && setSelectedNode(null)}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between gap-2">
            <span>{node.config.hostname}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:bg-destructive/10"
              onClick={() => removeNode(selectedId)}
              aria-label="Delete node"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </SheetTitle>
          <SheetDescription>
            {node.type.replace("_", " ")} · {OS_LABELS[node.config.os]}
          </SheetDescription>
        </SheetHeader>

        {issues.length > 0 && (
          <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {issues.map((i, idx) => (
              <div key={idx}>{i.message}</div>
            ))}
          </div>
        )}

        <Tabs defaultValue="general" className="mt-4 flex-1 overflow-hidden">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="network">Net</TabsTrigger>
            <TabsTrigger value="cves">CVEs</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
            <TabsTrigger value="vendors">Vendors</TabsTrigger>
            <TabsTrigger value="attack">Attack</TabsTrigger>
            <TabsTrigger value="creds">Creds</TabsTrigger>
          </TabsList>

          <ScrollArea className="mt-3 h-[calc(100vh-220px)]">
            <div className="pr-3">
              <TabsContent value="general" className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="label">Display label</Label>
                  <Input
                    id="label"
                    value={node.label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="hostname">Hostname</Label>
                  <Input
                    id="hostname"
                    value={node.config.hostname}
                    onChange={(e) =>
                      update((c) => ({ ...c, hostname: e.target.value }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Operating system</Label>
                  <Select
                    value={node.config.os}
                    onValueChange={(value) =>
                      update((c) => ({ ...c, os: value as OsType }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OS_BY_TYPE[node.type].map((os) => (
                        <SelectItem key={os} value={os}>
                          {OS_LABELS[os]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="grid gap-2">
                  <Label>
                    Memory ({(node.config.memory_mb / 1024).toFixed(1)} GB)
                  </Label>
                  <Slider
                    min={512}
                    max={16384}
                    step={512}
                    value={[node.config.memory_mb]}
                    onValueChange={([v]) =>
                      update((c) => ({ ...c, memory_mb: v ?? c.memory_mb }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>CPUs ({node.config.cpus})</Label>
                  <Slider
                    min={1}
                    max={8}
                    step={1}
                    value={[node.config.cpus]}
                    onValueChange={([v]) =>
                      update((c) => ({ ...c, cpus: v ?? c.cpus }))
                    }
                  />
                </div>
              </TabsContent>

              <TabsContent value="network" className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="ip">IP address</Label>
                  <Input
                    id="ip"
                    value={node.config.ip}
                    onChange={(e) => update((c) => ({ ...c, ip: e.target.value }))}
                    placeholder="192.168.56.10"
                    className="font-mono"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="gateway">Gateway</Label>
                  <Input
                    id="gateway"
                    value={node.config.gateway ?? ""}
                    onChange={(e) =>
                      update((c) => ({
                        ...c,
                        gateway: e.target.value || null,
                      }))
                    }
                    placeholder="192.168.56.1"
                    className="font-mono"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="vlan">VLAN tag</Label>
                  <Input
                    id="vlan"
                    type="number"
                    value={node.config.vlan ?? ""}
                    onChange={(e) =>
                      update((c) => ({
                        ...c,
                        vlan: e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                    placeholder="optional"
                    min={1}
                    max={4094}
                  />
                </div>
              </TabsContent>

              <TabsContent value="cves" className="h-[calc(100vh-280px)]">
                <CVESearchPanel
                  attached={node.config.cves}
                  onAdd={(cve) =>
                    update((c) =>
                      c.cves.includes(cve) ? c : { ...c, cves: [...c.cves, cve] },
                    )
                  }
                  onRemove={(cve) =>
                    update((c) => ({ ...c, cves: c.cves.filter((x) => x !== cve) }))
                  }
                />
              </TabsContent>

              <TabsContent value="roles" className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Generic roles / config flags. For branded products (Splunk, Wazuh, MDE,
                  ICS PLCs, AI tools) use the <span className="font-medium">Vendors</span> tab.
                </p>

                {customRoles.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                    No custom roles. Examples: <code>domain-joined</code>,{" "}
                    <code>AD-Domain-Services</code>, <code>iptables-persistent</code>.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {customRoles.map((role) => (
                      <div
                        key={role}
                        className="flex items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5"
                      >
                        <code className="truncate text-xs">{role}</code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            update((c) => ({
                              ...c,
                              roles: c.roles.filter((r) => r !== role),
                            }))
                          }
                          aria-label={`Remove ${role}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <Separator />
                <div className="grid gap-2">
                  <Label htmlFor="custom-role" className="text-xs">
                    Add custom role
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="custom-role"
                      placeholder="e.g. iptables-persistent"
                      value={customRoleDraft}
                      onChange={(e) => setCustomRoleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && customRoleDraft.trim()) {
                          const value = customRoleDraft.trim();
                          update((c) =>
                            c.roles.includes(value) ? c : { ...c, roles: [...c.roles, value] },
                          );
                          setCustomRoleDraft("");
                        }
                      }}
                      className="h-8"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const value = customRoleDraft.trim();
                        if (!value) return;
                        update((c) =>
                          c.roles.includes(value) ? c : { ...c, roles: [...c.roles, value] },
                        );
                        setCustomRoleDraft("");
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Plain roles drive the Vagrant provisioner but don&apos;t show a logo on the canvas.
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="vendors" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Security tools, AI services, ICS gear, observability stacks. Logo badges
                    show on the canvas.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => setPickerOpen(true)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Browse
                  </Button>
                </div>

                {vendorRoles.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                    No vendors attached. Click <span className="font-medium">Browse</span> to
                    pick from Splunk, Wazuh, MDE, Siemens, OpenAI, Claude, and more.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {vendorRoles.map(({ role, entry, version }) => (
                      <div
                        key={role}
                        className="flex items-center justify-between gap-2 rounded-md border bg-card p-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background"
                            style={{ borderColor: entry.color + "55" }}
                          >
                            <VendorIconInner entry={entry} size={18} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">{entry.label}</p>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {entry.category}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          {entry.versions && entry.versions.length > 0 ? (
                            <Select
                              value={version ?? entry.versions[0] ?? ""}
                              onValueChange={(v) => {
                                update((c) => ({
                                  ...c,
                                  roles: c.roles.map((r) =>
                                    r === role ? encodeRole(entry.id, v) : r,
                                  ),
                                }));
                              }}
                            >
                              <SelectTrigger className="h-7 w-[120px] text-[11px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {entry.versions.map((v) => (
                                  <SelectItem
                                    key={v}
                                    value={v}
                                    className="text-[11px]"
                                  >
                                    {v}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">no versions</span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              update((c) => ({
                                ...c,
                                roles: c.roles.filter((r) => r !== role),
                              }))
                            }
                            aria-label={`Remove ${entry.label}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="attack" className="space-y-3 p-0">
                <NodeAttackTagsPanel
                  nodeId={selectedId}
                  tags={node.attack_tags ?? []}
                />
              </TabsContent>

              <TabsContent value="creds" className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={node.config.credentials.username}
                    onChange={(e) =>
                      update((c) => ({
                        ...c,
                        credentials: { ...c.credentials, username: e.target.value },
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={node.config.credentials.password}
                      onChange={(e) =>
                        update((c) => ({
                          ...c,
                          credentials: { ...c.credentials, password: e.target.value },
                        }))
                      }
                      className="pr-10 font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-0 top-0 h-9 w-9"
                      aria-label="Toggle password visibility"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  These credentials are embedded into the provisioner scripts. Use long, unique
                  passwords for any lab that touches the public internet.
                </p>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </SheetContent>
      <IconPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selected={node.config.roles.map((r: string) => parseRole(r).id)}
        onToggle={togglePicker}
      />
    </Sheet>
  );
}
