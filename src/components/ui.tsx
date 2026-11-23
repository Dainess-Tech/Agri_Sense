"use client";
import Link from "next/link";
import { useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({ variant = "primary", size = "md", className, loading, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2.5 text-sm",
        variant === "primary" && "bg-leaf-700 text-white shadow-sm hover:bg-leaf-800",
        variant === "secondary" && "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
        variant === "ghost" && "text-leaf-800 hover:bg-leaf-50",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500",
        variant === "primary" ? "bg-leaf-700 text-white hover:bg-leaf-800" : "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Card({ title, action, children, className, subtitle }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-stone-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-stone-600">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

const SEV: Record<string, string> = {
  info: "bg-sky-100 text-sky-800",
  low: "bg-stone-100 text-stone-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};
export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize", SEV[severity] ?? SEV.low)}>{severity}</span>;
}

export function Badge({ children, tone = "stone" }: { children: ReactNode; tone?: "stone" | "green" | "amber" | "red" | "sky" | "violet" }) {
  const tones = { stone: "bg-stone-100 text-stone-700", green: "bg-leaf-100 text-leaf-800", amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-700", sky: "bg-sky-100 text-sky-800", violet: "bg-violet-100 text-violet-800" };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

/** Labels data provenance: measured vs modelled vs forecast vs calculated (SRS Module 5). */
export function DataTypeBadge({ type }: { type: string }) {
  const map: Record<string, ["green" | "sky" | "violet" | "amber" | "stone", string]> = {
    measured: ["green", "Measured"],
    modelled: ["sky", "Modelled"],
    forecast: ["violet", "Forecast"],
    calculated: ["amber", "Calculated"],
    assumed: ["stone", "Assumed"],
  };
  const [tone, label] = map[type] ?? ["stone", type];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      {htmlFor ? (
        <>
          <label htmlFor={htmlFor} className="block text-sm font-medium text-stone-800">{label}</label>
          {children}
        </>
      ) : (
        <label className="block text-sm font-medium text-stone-800">
          {label}
          {children}
        </label>
      )}
      {hint && !error && <p className="text-xs text-stone-500">{hint}</p>}
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-200";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, p.className)} />;

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-sm text-stone-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-leaf-600 border-t-transparent motion-reduce:animate-none" aria-hidden />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-xl bg-stone-200/70 motion-reduce:animate-none", className)} aria-hidden />;
}

export function EmptyState({ icon = "🌱", title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 bg-stone-50/60 px-6 py-10 text-center">
      <div className="text-4xl" aria-hidden>{icon}</div>
      <h3 className="mt-3 font-semibold text-stone-900">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-stone-600">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  const t = { info: "border-sky-200 bg-sky-50 text-sky-900", error: "border-red-200 bg-red-50 text-red-800", success: "border-leaf-200 bg-leaf-50 text-leaf-900", warning: "border-amber-200 bg-amber-50 text-amber-900" };
  return <div className={cx("rounded-xl border px-4 py-3 text-sm", t[tone])} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function SavedDataNotice({ savedAt }: { savedAt: string | null }) {
  if (!savedAt) return null;
  return <Alert tone="warning">📴 Offline — showing data saved on {new Date(savedAt).toLocaleString()}.</Alert>;
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-stone-500">
        {label}
        {icon && <span aria-hidden className="text-lg">{icon}</span>}
      </div>
      <div className="mt-1 text-2xl font-bold text-stone-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, children }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; children?: ReactNode }) {
  const baseId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!tabs.length || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    onChange(tabs[next].id);
    buttons.current[next]?.focus();
  };
  return (
    <>
      <div role="tablist" className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-stone-200 px-1">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { buttons.current[i] = el; }}
            id={`${baseId}-tab-${t.id}`}
            role="tab"
            aria-controls={`${baseId}-panel-${t.id}`}
            aria-selected={value === t.id}
            tabIndex={value === t.id ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition", value === t.id ? "border-leaf-700 text-leaf-800" : "border-transparent text-stone-500 hover:text-stone-800")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {children !== undefined && (
        <div id={`${baseId}-panel-${value}`} role="tabpanel" aria-labelledby={`${baseId}-tab-${value}`} tabIndex={0}>
          {children}
        </div>
      )}
    </>
  );
}
