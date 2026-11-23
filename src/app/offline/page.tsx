import Link from "next/link";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-leaf-800 px-6 text-center text-white">
      <div className="text-6xl" aria-hidden>
        📴
      </div>
      <h1 className="mt-4 text-2xl font-bold">You&apos;re offline</h1>
      <p className="mt-2 max-w-md text-leaf-100">
        This page hasn&apos;t been saved on this device yet. Pages you visited before — like your dashboard, farms and previous predictions — are still available.
        New predictions need an internet connection for weather and soil data.
      </p>
      <div className="mt-6 flex gap-3">
        <Link href="/dashboard" className="rounded-xl bg-white px-4 py-2.5 font-semibold text-leaf-800">
          Open dashboard
        </Link>
        <Link href="/farms" className="rounded-xl border border-white/40 px-4 py-2.5 font-semibold">
          My farms
        </Link>
      </div>
    </main>
  );
}
