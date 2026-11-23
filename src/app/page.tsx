import Link from "next/link";
import { InstallPrompt } from "@/components/pwa";

const FEATURES = [
  { icon: "🌾", title: "Farm management", body: "Register multiple farms with GPS or manual coordinates, track crops, varieties, planting seasons and harvests." },
  { icon: "📡", title: "IoT monitoring", body: "ESP32 stations stream soil moisture, soil temperature, air temperature and humidity. Sensor faults are detected, not mistaken for drought." },
  { icon: "📈", title: "Yield prediction", body: "Transparent, rule-based estimates: yield range, total production, harvest window, risks and the factors behind every number." },
  { icon: "⛅", title: "Environmental intelligence", body: "Open-Meteo weather history & forecasts combined with ISRIC SoilGrids soil properties — clearly labelled as measured, modelled or forecast." },
  { icon: "⚠️", title: "Risk alerts", body: "Crop-specific thresholds flag drought, heavy rain, waterlogging, heat, cold and soil pH concerns — with explanations." },
  { icon: "📴", title: "Works offline", body: "Install it like an app. Cached farms and predictions stay viewable offline; records you save sync when you reconnect." },
];

const STEPS = ["Register your account", "Add your farm & location", "Record a maize planting", "Connect an ESP32 sensor station", "Request a yield prediction", "Act on risks & recommendations"];

export default function Landing() {
  return (
    <main id="main" className="bg-stone-50">
      <section className="relative isolate overflow-hidden bg-leaf-900 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/agrisense.svg" alt="" className="absolute inset-0 -z-10 ml-auto h-full w-full max-w-2xl object-contain object-right p-12 opacity-15" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-leaf-900 via-leaf-900/95 to-leaf-900/70" />
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/agrisense.svg" alt="" className="h-9 w-9 rounded-xl" />
            AgriSense
          </Link>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link href="/auth/login" className="rounded-xl px-3 py-2 hover:bg-white/10">
              Sign in
            </Link>
            <Link href="/auth/register" className="rounded-xl bg-white px-4 py-2 text-leaf-800 hover:bg-leaf-50">
              Get started
            </Link>
          </div>
        </nav>
        <div className="mx-auto max-w-6xl px-6 pb-24 pt-14 sm:pt-24">
          <p className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-amber-300">A land that can talk</p>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-tight sm:text-6xl">Understand your farm through data — and act before problems grow.</h1>
          <p className="mt-5 max-w-2xl text-lg text-leaf-100">
            AgriSense combines on-farm sensors, weather forecasts and soil science to estimate crop yields, flag risks and tell you what deserves attention today.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/auth/register" className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-leaf-800 shadow hover:bg-leaf-50">
              Create free account
            </Link>
            <InstallPrompt />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-sm font-bold uppercase tracking-widest text-leaf-700">Three questions, answered</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            ["What is happening on my farm?", "Monitoring", "📡"],
            ["What is likely to happen to my crops?", "Prediction", "📈"],
            ["What should I pay attention to?", "Agricultural intelligence", "💡"],
          ].map(([q, a, i]) => (
            <div key={a} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
              <div className="text-3xl" aria-hidden>{i}</div>
              <p className="mt-3 text-lg font-semibold text-stone-900">{q}</p>
              <p className="mt-1 text-sm font-medium text-leaf-700">{a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-bold text-stone-900">Everything in one platform</h2>
          <p className="mt-2 max-w-2xl text-stone-600">Not three disconnected projects — every sensor reading, weather record and prediction contributes to the same farm record.</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-stone-200 p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-leaf-50 text-2xl" aria-hidden>
                  {f.icon}
                </div>
                <h3 className="mt-4 font-semibold text-stone-900">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold text-stone-900">From sign-up to first prediction</h2>
            <ol className="mt-6 space-y-3">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-leaf-700 text-sm font-bold text-white">{i + 1}</span>
                  <span className="text-stone-800">{s}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-3xl bg-leaf-800 p-8 text-white shadow-xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-amber-300">Honest predictions</p>
            <p className="mt-3 text-xl font-semibold leading-snug">AgriSense never invents numbers with a chatbot. Every estimate is calculated from crop parameters, weather, soil and sensors — and shows its data quality and limitations.</p>
            <p className="mt-4 text-sm text-leaf-200">Rule engine version, inputs and data sources are saved with each prediction, so history stays trustworthy.</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-8 text-sm text-stone-500 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} AgriSense · Investing in the last mile of agriculture</p>
          <p>Weather data by Open-Meteo.com (CC BY 4.0) · Soil data ISRIC SoilGrids (CC BY 4.0) · Maps © OpenStreetMap contributors</p>
        </div>
      </footer>
    </main>
  );
}
