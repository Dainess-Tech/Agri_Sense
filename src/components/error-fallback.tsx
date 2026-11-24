"use client";

import { useEffect } from "react";

export function ErrorFallback({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("AgriSense page failed to render:", error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-bold text-stone-900">We couldn&apos;t load this page</h1>
      <p className="mt-2 max-w-lg text-sm text-stone-600">
        Something went wrong. Your data is safe. Try again, or return to the dashboard.
      </p>
      {error.digest && <p className="mt-2 text-xs text-stone-500">Reference: {error.digest}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-leaf-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-leaf-800"
        >
          Try again
        </button>
        <a
          href="/dashboard"
          className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 hover:bg-stone-50"
        >
          Go to dashboard
        </a>
      </div>
    </main>
  );
}
