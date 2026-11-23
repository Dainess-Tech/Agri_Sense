"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { clearUserData } from "@/lib/client/offline-queue";
import { useApp } from "@/lib/client/hooks";
import { ConnectionStatus, InstallPrompt, useNotificationPoll } from "./pwa";
import { cx, Spinner } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "🏠", mobile: true },
  { href: "/farms", label: "Farms", icon: "🌾", mobile: true },
  { href: "/predictions", label: "Predictions", icon: "📈", mobile: true },
  { href: "/monitoring", label: "Monitoring", icon: "📡", mobile: true },
  { href: "/devices", label: "Devices", icon: "🔌" },
  { href: "/weather", label: "Weather & Soil", icon: "⛅" },
  { href: "/recommendations", label: "Recommendations", icon: "💡" },
  { href: "/notifications", label: "Notifications", icon: "🔔" },
  { href: "/reports", label: "Reports", icon: "📄" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 font-bold text-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/agrisense.svg" alt="" className="h-8 w-8 rounded-lg" />
      <span className="text-lg tracking-tight">AgriSense</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, farms, farmId, setFarmId, ready } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const unread = useNotificationPoll();
  const [moreOpen, setMoreOpen] = useState(false);
  const nav = user?.role === "admin" ? [...NAV, { href: "/admin", label: "Admin", icon: "🛡️" }] : NAV;
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    await clearUserData();
    router.push("/auth/login");
    router.refresh();
  };

  return (
    <div className="min-h-dvh lg:pl-64 print:pl-0">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-leaf-800 px-4 py-5 lg:flex">
        <Logo />
        <nav className="mt-8 flex-1 space-y-1 overflow-y-auto" aria-label="Main">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={cx("flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition", active(n.href) ? "bg-white/15 text-white" : "text-leaf-100 hover:bg-white/10")}>
              <span aria-hidden>{n.icon}</span>
              {n.label}
              {n.href === "/notifications" && unread > 0 && <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-xs font-bold text-stone-900">{unread}</span>}
            </Link>
          ))}
        </nav>
        {user && (
          <div className="mt-4 rounded-xl bg-white/10 p-3 text-sm text-leaf-50">
            <p className="truncate font-semibold">{user.fullName}</p>
            <p className="truncate text-xs text-leaf-200">
              {user.email} · <span className="capitalize">{user.role}</span>
            </p>
            <button onClick={logout} className="mt-2 text-xs font-semibold text-amber-300 hover:underline">
              Sign out
            </button>
          </div>
        )}
      </aside>

      {/* Top bar */}
      <header className="no-print sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
          <div className="lg:hidden">
            <Link href="/dashboard" className="flex items-center gap-2 font-bold text-leaf-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/agrisense.svg" alt="" className="h-7 w-7 rounded-lg" />
              <span className="hidden sm:inline">AgriSense</span>
            </Link>
          </div>
          {farms.length > 0 && (
            <label className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden text-stone-500 sm:inline">Farm</span>
              <select value={farmId ?? ""} onChange={(e) => setFarmId(e.target.value)} className="min-w-0 max-w-[11rem] truncate rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm font-medium sm:max-w-xs" aria-label="Select farm">
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="ml-auto flex items-center gap-2">
            <InstallPrompt compact />
            <ConnectionStatus />
            <Link href="/notifications" className="relative rounded-full p-1.5 hover:bg-stone-100" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <span aria-hidden>🔔</span>
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
        {ready ? children : <Spinner label="Loading AgriSense…" />}
      </main>

      {/* Mobile bottom navigation */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Main">
        <div className="grid grid-cols-5">
          {nav
            .filter((n) => "mobile" in n && n.mobile)
            .map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active(n.href) ? "text-leaf-800" : "text-stone-500")}>
                <span className="text-lg" aria-hidden>{n.icon}</span>
                {n.label}
              </Link>
            ))}
          <button onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-stone-500">
            <span className="text-lg" aria-hidden>☰</span>More
          </button>
        </div>
        {moreOpen && (
          <div className="absolute bottom-full left-0 right-0 border-t border-stone-200 bg-white p-3 shadow-2xl">
            <div className="grid grid-cols-3 gap-2">
              {nav
                .filter((n) => !("mobile" in n && n.mobile))
                .map((n) => (
                  <Link key={n.href} href={n.href} onClick={() => setMoreOpen(false)} className="flex flex-col items-center gap-1 rounded-xl p-3 text-xs font-medium text-stone-700 hover:bg-stone-50">
                    <span className="text-xl" aria-hidden>{n.icon}</span>
                    {n.label}
                  </Link>
                ))}
              <button onClick={logout} className="flex flex-col items-center gap-1 rounded-xl p-3 text-xs font-medium text-red-700 hover:bg-red-50">
                <span className="text-xl" aria-hidden>🚪</span>Sign out
              </button>
            </div>
          </div>
        )}
      </nav>
    </div>
  );
}
