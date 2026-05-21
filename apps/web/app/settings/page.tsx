"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Moon,
  Settings as SettingsIcon,
  Sun,
  XCircle,
  Zap,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface HealthResponse {
  status: string;
  version?: string;
  auth_required?: boolean;
  nvd_key_set?: boolean;
}

const TOKEN_KEY = "labforge.token";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  const handle = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Copy failed");
    }
  };
  return (
    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handle}>
      {copied ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function Snippet({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
      <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all">{text}</pre>
      <CopyButton value={text} />
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const [tokenInput, setTokenInput] = React.useState("");
  const [storedToken, setStoredToken] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const t = window.localStorage.getItem(TOKEN_KEY);
      setStoredToken(t);
      setTokenInput(t ?? "");
    } catch {
      // localStorage may be blocked; ignore
    }
  }, []);

  const startedAt = React.useRef<number>(Date.now());
  const healthQ = useQuery<HealthResponse & { _latencyMs: number }>({
    queryKey: ["api-health"],
    queryFn: async () => {
      const start = performance.now();
      const res = await fetch("/api/v1/health", { cache: "no-store" });
      const latency = Math.round(performance.now() - start);
      if (!res.ok) throw new Error(`${res.status}`);
      const body = (await res.json()) as HealthResponse;
      return { ...body, _latencyMs: latency };
    },
    refetchInterval: 10_000,
    retry: 1,
  });
  void startedAt;

  const saveToken = (): void => {
    try {
      const trimmed = tokenInput.trim();
      if (trimmed) {
        window.localStorage.setItem(TOKEN_KEY, trimmed);
        setStoredToken(trimmed);
        toast.success("Token saved", {
          description: "Sent on writes to /api/v1/labs and /api/v1/topologies.",
        });
      } else {
        window.localStorage.removeItem(TOKEN_KEY);
        setStoredToken(null);
        toast.success("Token cleared");
      }
    } catch {
      toast.error("Could not access localStorage");
    }
  };

  const apiOnline = healthQ.data?.status === "ok";
  const authRequired = healthQ.data?.auth_required ?? false;
  const nvdSet = healthQ.data?.nvd_key_set ?? false;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <SettingsIcon className="h-5 w-5" /> Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure how the web app talks to the LabForge API and the agent.
        </p>
      </header>

      {/* API connection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">API connection</CardTitle>
          <CardDescription>
            Routed via the Next.js proxy at <code className="rounded bg-muted px-1">/api/v1</code>
            {" "}→ <code className="rounded bg-muted px-1">LABFORGE_API_URL</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            {healthQ.isLoading ? (
              <Badge variant="outline">Checking…</Badge>
            ) : apiOnline ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Online
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="mr-1 h-3 w-3" /> Offline
              </Badge>
            )}
            {healthQ.data && (
              <span className="text-xs text-muted-foreground">
                v{healthQ.data.version ?? "?"} · {healthQ.data._latencyMs}ms
              </span>
            )}
          </div>
          {!apiOnline && !healthQ.isLoading && (
            <p className="text-xs text-muted-foreground">
              Start the API with{" "}
              <code className="rounded bg-muted px-1">
                uvicorn labforge_core.api.main:app --app-dir apps/api --host 127.0.0.1 --port 8000
              </code>
              .
            </p>
          )}
        </CardContent>
      </Card>

      {/* Theme */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Theme used by the canvas and dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {(["light", "dark", "system"] as const).map((t) => {
              const active = mounted && theme === t;
              const Icon = t === "light" ? Sun : t === "dark" ? Moon : Zap;
              return (
                <Button
                  key={t}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className="capitalize"
                  onClick={() => setTheme(t)}
                  suppressHydrationWarning
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Bearer token */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Agent bearer token
          </CardTitle>
          <CardDescription>
            Sent as <code className="rounded bg-muted px-1">Authorization: Bearer …</code> on lab
            writes. Required only if the API was started with{" "}
            <code className="rounded bg-muted px-1">LABFORGE_AGENT_TOKEN</code> set.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">API requires token:</span>
            {healthQ.isLoading ? (
              <Badge variant="outline">…</Badge>
            ) : authRequired ? (
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">Yes</Badge>
            ) : (
              <Badge variant="secondary">No (open)</Badge>
            )}
            <Separator orientation="vertical" className="mx-1 h-4" />
            <span className="text-xs text-muted-foreground">Stored locally:</span>
            <Badge variant={storedToken ? "default" : "outline"}>
              {storedToken ? "Yes" : "No"}
            </Badge>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="token-input" className="text-xs">
              Token (stored in <code className="rounded bg-muted px-1">localStorage</code> on this
              browser only)
            </Label>
            <div className="flex gap-2">
              <Input
                id="token-input"
                type="password"
                placeholder="paste token…"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                autoComplete="off"
              />
              <Button onClick={saveToken} size="sm">
                Save
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Agent CLI quick-start:</p>
            <Snippet
              text={`labforge init --provider virtualbox --api-base http://127.0.0.1:8000 --token <paste-same-token>`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Local state */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Local state</CardTitle>
          <CardDescription>
            The canvas auto-saves to your browser. Clearing it does not delete anything
            on the API.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              try {
                window.localStorage.removeItem("labforge.canvas.v1");
                toast.success("Canvas cleared — reload /build to start fresh.");
              } catch {
                toast.error("Could not clear localStorage");
              }
            }}
          >
            Clear cached canvas
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              try {
                window.localStorage.removeItem("labforge.onboarding.v1");
                toast.success("Onboarding tour will replay on next /build visit.");
              } catch {
                toast.error("Could not clear localStorage");
              }
            }}
          >
            Replay onboarding tour
          </Button>
        </CardContent>
      </Card>

      {/* NVD */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">NVD CVE lookups</CardTitle>
          <CardDescription>
            Optional NIST API key for faster, higher-rate CVE searches.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">API key on backend:</span>
            <Badge variant={nvdSet ? "default" : "outline"}>
              {healthQ.isLoading ? "…" : nvdSet ? "Set" : "Unset (rate-limited)"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Set it on the API host, then restart uvicorn:
          </p>
          <Snippet
            text={`# Windows PowerShell\n$env:LABFORGE_NVD_API_KEY = "<your-key>"\n# macOS / Linux\nexport LABFORGE_NVD_API_KEY=<your-key>`}
          />
        </CardContent>
      </Card>
    </main>
  );
}
