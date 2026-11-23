import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AppProvider } from "@/lib/client/hooks";

/** Protected application area (guarded by src/proxy.ts + server-side checks on every API call). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
