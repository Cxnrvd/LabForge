"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

import { ThemeProvider } from "./theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <ThemeProvider
      // Drive BOTH shadcn (`.dark` class) and the design-system CSS
      // (`[data-theme="..."]` attribute) from a single next-themes
      // instance, so flipping one toggle re-themes both.
      attribute={["class", "data-theme"]}
      defaultTheme="dark"
      enableSystem
    >
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster theme="system" richColors closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
