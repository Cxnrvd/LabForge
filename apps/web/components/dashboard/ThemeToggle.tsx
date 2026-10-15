"use client";

import * as React from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils/cn";

/**
 * Three-state theme picker. The trigger shows the resolved icon (sun in
 * light, moon in dark) so the current state is obvious at a glance; the
 * dropdown surfaces the explicit Light / Dark / System choices.
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const TriggerIcon = !mounted
    ? null
    : resolvedTheme === "dark"
      ? Moon
      : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2"
          aria-label="Change theme"
          suppressHydrationWarning
        >
          {TriggerIcon ? <TriggerIcon className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5" />}
          <span className="hidden text-xs capitalize sm:inline">
            {mounted ? (theme ?? "system") : "theme"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(
          [
            { value: "light", label: "Light", Icon: Sun },
            { value: "dark", label: "Dark", Icon: Moon },
            { value: "system", label: "System", Icon: Laptop },
          ] as const
        ).map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            className={cn(
              "gap-2",
              mounted && theme === value && "bg-accent text-accent-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
