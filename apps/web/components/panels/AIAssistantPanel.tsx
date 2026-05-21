"use client";

import * as React from "react";
import { Bot, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useTopologyStore } from "@/lib/store/topology-store";
import type { NodeType } from "@labforge/schema";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * AI assistant scaffolding.
 *
 * This component is intentionally a *local rule-based* assistant for now:
 * it parses simple intents like "add a vulnerable apache server" or
 * "show me an active directory lab" and mutates the canvas via the
 * Zustand store. There is NO outbound API call — that lets it ship
 * without a vendor key. Wire it to ``/api/v1/assist`` later by replacing
 * the ``localCompletion`` function with a fetch.
 *
 * The point is: the seam exists. The chat-UI plumbing, message history,
 * and command dispatch are real; the model is swappable.
 */

const INTENT_PATTERNS: { match: RegExp; reply: (m: RegExpMatchArray) => string }[] = [
  {
    match: /add (?:a |an )?(?:vulnerable )?apache/i,
    reply: () =>
      "Adding a vulnerable Apache target with Log4Shell pinned. Drop in a CVE search to pick the exact version.",
  },
  {
    match: /add (?:a |an )?(?:domain |windows )?(?:controller|dc)\b/i,
    reply: () => "Adding a Windows Server 2019 domain controller with AD-Domain-Services pre-applied.",
  },
  {
    match: /add (?:a |an )?(?:kali|attacker)\b/i,
    reply: () => "Adding a Kali Rolling attacker on the lab subnet with nmap and Impacket.",
  },
  {
    match: /add (?:a |an )?(?:plc|ot)\b/i,
    reply: () => "Adding an OpenPLC node with Modbus-TCP. You'll want an HMI to talk to it.",
  },
  {
    match: /add (?:a |an )?camera/i,
    reply: () => "Adding an IP-camera node with MediaMTX (RTSP listener on :8554).",
  },
];

function intentToAdd(text: string): NodeType | null {
  if (/apache|web server|nginx|target/i.test(text)) return "target";
  if (/domain controller|\bdc\b|active directory/i.test(text)) return "domain_controller";
  if (/kali|attacker|red team/i.test(text)) return "attacker";
  if (/\bplc\b|openplc|modbus/i.test(text)) return "ics_plc";
  if (/\bhmi\b|scada|rapid scada/i.test(text)) return "ics_hmi";
  if (/camera|rtsp/i.test(text)) return "camera";
  if (/database|mysql|postgres|mongo/i.test(text)) return "database";
  if (/firewall|pfsense|opnsense/i.test(text)) return "firewall";
  return null;
}

export function AIAssistantPanel({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! Try: \"add a vulnerable apache target\", \"add a kali attacker\", or \"set up a basic AD lab\". I'm rule-based for now — point me at an LLM endpoint later.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const addNode = useTopologyStore((s) => s.addNode);

  const submit = (): void => {
    const text = input.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");

    const matched = INTENT_PATTERNS.find((p) => p.match.test(text));
    const reply =
      matched?.reply(text.match(matched.match)!) ??
      "I'm not sure what to add yet. Try a more specific phrase like \"add a Kali attacker\".";

    const nodeType = intentToAdd(text);
    if (nodeType) {
      addNode(nodeType, { x: 200, y: 200 });
      toast.success(`Added ${nodeType.replace(/_/g, " ")}`);
    }
    setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="flex w-[380px] flex-col p-0 sm:w-[440px]">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" /> Lab assistant
          </SheetTitle>
          <SheetDescription>
            Natural-language helper that mutates the canvas. Rule-based today, model-backed
            tomorrow.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1 px-4 py-3">
          <div className="space-y-3">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={
                  m.role === "user"
                    ? "ml-8 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground"
                    : "mr-8 rounded-md bg-muted px-3 py-2 text-xs"
                }
              >
                {m.content}
              </div>
            ))}
          </div>
        </ScrollArea>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex gap-2 border-t p-3"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add a vulnerable Apache target…"
          />
          <Button type="submit" size="icon" aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
