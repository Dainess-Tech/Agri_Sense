"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { clearUserData } from "@/lib/client/offline-queue";
import { useApi, useApp, type SessionUser } from "@/lib/client/hooks";
import { InstallPrompt } from "@/components/pwa";
import { PushToggle } from "@/components/push-toggle";
import { useTheme } from "@/components/theme-provider";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";

interface Prefs { riskAlerts: boolean; predictionReady: boolean; deviceOffline: boolean; harvestReminders: boolean; systemAnnouncements: boolean; pushEnabled: boolean; minSeverity: string }
interface ProfileInput { fullName: string; phone: string; country: string; language: string; measurementSystem: string }

function ProfileFields({ user, onSave }: { user: SessionUser; onSave: (profile: ProfileInput) => void }) {
  const [profile, setProfile] = useState<ProfileInput>(() => ({
    fullName: user.fullName,
    phone: user.phone ?? "",
    country: user.country ?? "",
    language: user.language,
    measurementSystem: user.measurementSystem,
  }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(profile);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Full name"><Input required value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone (optional)"><Input type="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field>
        <Field label="Country"><Input value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value })} /></Field>
        <Field label="Preferred language"><Select value={profile.language} onChange={(e) => setProfile({ ...profile, language: e.target.value })}><option value="en">English</option><option value="sw">Kiswahili</option><option value="fr">Français</option><option value="pl">Polski</option></Select></Field>
        <Field label="Measurement units"><Select value={profile.measurementSystem} onChange={(e) => setProfile({ ...profile, measurementSystem: e.target.value })}><option value="metric">Metric</option><option value="imperial">Imperial</option></Select></Field>
      </div>
      <p className="text-xs text-stone-500">Role: <span className="capitalize">{user.role}</span>. AgriSense only asks for information needed to provide the service.</p>
      <Button type="submit">Save profile</Button>
    </form>
  );
}

export default function SettingsPage() {
  const { user, refreshUser } = useApp();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const prefsQ = useApi<{ preferences: Prefs }>("/users/preferences");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [del, setDel] = useState("");
  useEffect(() => { document.title = "Settings · AgriSense"; }, []);

  const run = async (fn: () => Promise<unknown>, ok: string, onFailure?: () => void) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
    } catch (e) {
      onFailure?.();
      setMsg({ tone: "error", text: errorMessage(e) });
    }
  };
  const saveProfile = (profile: ProfileInput) => { void run(async () => { await api("/users/profile", { method: "PATCH", body: { ...profile, phone: profile.phone || null, country: profile.country || null } }); await refreshUser(); }, "Profile saved."); };
  const setPref = (k: keyof Prefs, v: boolean | string) => {
    const previous = prefsQ.data?.preferences[k];
    prefsQ.setData((d) => (d ? { preferences: { ...d.preferences, [k]: v } } : d));
    void run(() => api("/users/preferences", { method: "PATCH", body: { [k]: v } }), "Notification preferences saved.", () => {
      prefsQ.setData((d) => (d && previous !== undefined ? { preferences: { ...d.preferences, [k]: previous } } : d));
      void prefsQ.reload();
    });
  };
  const changePw = (e: FormEvent) => { e.preventDefault(); void run(async () => { await api("/users/password", { method: "PATCH", body: pw }); setPw({ currentPassword: "", newPassword: "" }); }, "Password changed."); };
  const resend = () => run(async () => { const r = await api<{ devVerificationLink?: string }>("/auth/resend-verification", { method: "POST" }); if (r.devVerificationLink) window.location.href = r.devVerificationLink; }, "Verification email sent.");
  const deleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirm("Delete your account and ALL farms, devices, readings and predictions permanently?")) return;
    try {
      await api("/users/profile", { method: "DELETE", body: { password: del } });
      await clearUserData();
      router.push("/");
    } catch (e2) {
      setMsg({ tone: "error", text: errorMessage(e2) });
    }
  };
  const p = prefsQ.data?.preferences;
  const toggles: [keyof Prefs, string, string][] = [
    ["riskAlerts", "Environmental & risk alerts", "Drought, heavy rain, heat, low soil moisture…"],
    ["predictionReady", "New predictions", "When a yield prediction is ready"],
    ["deviceOffline", "Device disconnections", "When a sensor station stops reporting"],
    ["harvestReminders", "Harvest-window reminders", "A week before the estimated harvest window"],
    ["systemAnnouncements", "System announcements", "Updates from AgriSense administrators"],
  ];

  return (
    <>
      <PageHeader title="Profile & settings" description="Manage your account, preferences and data." />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Profile" subtitle={user ? `${user.email} · member since ${new Date(user.createdAt).toLocaleDateString()}` : undefined} action={user && (user.emailVerified ? <Badge tone="green">Email verified</Badge> : <Button size="sm" variant="secondary" onClick={resend}>Verify email</Button>)}>
          {user ? <ProfileFields key={user.id} user={user} onSave={saveProfile} /> : <p className="text-sm text-stone-500">Loading profile…</p>}
        </Card>
        <Card title="Appearance">
          <Field label="Theme" hint="This preference is saved on this device.">
            <Select
              value={theme}
              onChange={(e) => {
                try {
                  setTheme(e.target.value === "dark" ? "dark" : "light");
                } catch (e) {
                  setMsg({ tone: "error", text: errorMessage(e) });
                }
              }}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          </Field>
        </Card>
        <Card title="Notification preferences">
          {!p ? <p className="text-sm text-stone-500">Loading…</p> : (
            <div className="space-y-3">
              {toggles.map(([k, label, hint]) => (
                <label key={k} className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-leaf-700" checked={Boolean(p[k])} onChange={(e) => setPref(k, e.target.checked)} />
                  <span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-stone-500">{hint}</span></span>
                </label>
              ))}
              <Field label="Minimum risk severity to notify"><Select value={p.minSeverity} onChange={(e) => setPref("minSeverity", e.target.value)}>{["info", "low", "medium", "high", "critical"].map((s) => <option key={s}>{s}</option>)}</Select></Field>
              <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4 accent-leaf-700" checked={p.pushEnabled} onChange={(e) => setPref("pushEnabled", e.target.checked)} /><span className="text-sm font-medium">Send push notifications to my devices</span></label>
              <PushToggle />
            </div>
          )}
        </Card>
        <Card title="Install AgriSense">
          <p className="mb-3 text-sm text-stone-600">Install the app on your phone or computer for full-screen access and offline use.</p>
          <InstallPrompt />
        </Card>
        <Card title="Change password">
          <form onSubmit={changePw} className="space-y-3">
            <Field label="Current password"><Input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
            <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" minLength={8} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            <Button type="submit">Change password</Button>
          </form>
        </Card>
        <Card title="Your data">
          <p className="text-sm text-stone-600">Download everything AgriSense stores about you and your farms (JSON).</p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- This endpoint returns a file download. */}
          <a href="/api/v1/users/export" className="mt-3 inline-flex rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold hover:bg-stone-50">⬇ Export my data</a>
        </Card>
        <Card title="Delete account" className="border-red-200">
          <form onSubmit={deleteAccount} className="space-y-3">
            <p className="text-sm text-stone-600">Permanently deletes your account and all associated farms, devices, readings and predictions.</p>
            <Field label="Confirm with your password"><Input type="password" required value={del} onChange={(e) => setDel(e.target.value)} /></Field>
            <Button type="submit" variant="danger">Delete my account</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
