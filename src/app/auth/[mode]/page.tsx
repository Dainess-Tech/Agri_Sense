"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Alert, Button, Field, Input } from "@/components/ui";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  login: { title: "Welcome back", subtitle: "Sign in to see what your land is saying." },
  register: { title: "Create your account", subtitle: "Start monitoring your farm in minutes. Only basic details needed." },
  forgot: { title: "Reset your password", subtitle: "We'll send a reset link to your email." },
  reset: { title: "Choose a new password", subtitle: "Enter a new password for your account." },
  verify: { title: "Verify email", subtitle: "Confirming your email address…" },
};

function AuthForm() {
  const { mode } = useParams<{ mode: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const token = search.get("token") ?? "";
  const next = search.get("next") || "/dashboard";
  const [form, setForm] = useState({ fullName: "", email: "", password: "", country: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const meta = TITLES[mode] ?? TITLES.login;

  useEffect(() => {
    if (mode === "verify" && token) {
      api<{ message: string }>("/auth/verify-email", { method: "POST", body: { token } })
        .then((r) => setMessage(r.message))
        .catch((e) => setError(errorMessage(e)));
    }
  }, [mode, token]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "login") {
        await api("/auth/login", { method: "POST", body: { email: form.email, password: form.password } });
        router.push(next.startsWith("/") ? next : "/dashboard");
      } else if (mode === "register") {
        const r = await api<{ devVerificationLink?: string }>("/auth/register", { method: "POST", body: { fullName: form.fullName, email: form.email, password: form.password, country: form.country || undefined } });
        if (r.devVerificationLink) sessionStorage.setItem("agrisense.devVerify", r.devVerificationLink);
        router.push("/farms?welcome=1");
      } else if (mode === "forgot") {
        const r = await api<{ message: string; devResetLink?: string }>("/auth/forgot-password", { method: "POST", body: { email: form.email } });
        setMessage(r.message);
        setDevLink(r.devResetLink ?? null);
      } else if (mode === "reset") {
        const r = await api<{ message: string }>("/auth/reset-password", { method: "POST", body: { token, password: form.password } });
        setMessage(r.message);
        setTimeout(() => router.push("/auth/login"), 1500);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <h1 className="text-2xl font-bold text-stone-900">{meta.title}</h1>
      <p className="mt-1 text-sm text-stone-600">{meta.subtitle}</p>
      <div className="mt-6 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {message && <Alert tone="success">{message}</Alert>}
        {devLink && (
          <Alert tone="info">
            Development mode (no email provider configured):{" "}
            <a className="font-semibold underline" href={devLink}>
              open reset link
            </a>
          </Alert>
        )}
        {mode === "verify" ? (
          <Link href="/dashboard" className="font-semibold text-leaf-800 underline">
            Continue to dashboard →
          </Link>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            {mode === "register" && (
              <Field label="Full name" htmlFor="fullName">
                <Input id="fullName" autoComplete="name" required minLength={2} value={form.fullName} onChange={set("fullName")} />
              </Field>
            )}
            {mode !== "reset" && (
              <Field label="Email address" htmlFor="email">
                <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
              </Field>
            )}
            {mode !== "forgot" && (
              <Field label={mode === "reset" ? "New password" : "Password"} htmlFor="password" hint={mode !== "login" ? "At least 8 characters" : undefined}>
                <Input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 8} value={form.password} onChange={set("password")} />
              </Field>
            )}
            {mode === "register" && (
              <Field label="Country (optional)" htmlFor="country">
                <Input id="country" autoComplete="country-name" value={form.country} onChange={set("country")} placeholder="e.g. Kenya" />
              </Field>
            )}
            <Button type="submit" loading={busy} className="w-full">
              {mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Update password"}
            </Button>
          </form>
        )}
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          {mode === "login" ? (
            <>
              <Link className="text-leaf-800 hover:underline" href="/auth/register">
                Create an account
              </Link>
              <Link className="text-stone-600 hover:underline" href="/auth/forgot">
                Forgot password?
              </Link>
            </>
          ) : (
            <Link className="text-leaf-800 hover:underline" href="/auth/login">
              ← Back to sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-leaf-800 p-10 text-white lg:flex">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/agrisense.svg" alt="" className="h-10 w-10 rounded-xl" /> AgriSense
        </Link>
        <div>
          <p className="text-3xl font-bold leading-tight">“What is happening on my farm? What is likely to happen to my crops? What should I pay attention to?”</p>
          <p className="mt-4 text-leaf-200">AgriSense answers all three — a land that can talk.</p>
        </div>
        <p className="text-xs text-leaf-300">Weather: Open-Meteo · Soil: ISRIC SoilGrids · Maps: © OpenStreetMap</p>
      </div>
      <main id="main" className="flex items-center justify-center px-6 py-12">
        <Suspense>
          <AuthForm />
        </Suspense>
      </main>
    </div>
  );
}
