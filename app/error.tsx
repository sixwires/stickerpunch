"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[stickerpunch] route error", error);
  }, [error]);

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Something didn&apos;t punch out right.
      </h1>
      <p className="max-w-md text-neutral-600">
        Try again — if it keeps failing, the model or storage may be in a bad
        state.
      </p>
      {error.digest ? (
        <code className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-500">
          ref: {error.digest}
        </code>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 transition-colors"
        >
          Retry
        </button>
        <Link
          href="/"
          className="rounded-full bg-neutral-100 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-200 transition-colors"
        >
          Go home
        </Link>
      </div>
    </section>
  );
}
