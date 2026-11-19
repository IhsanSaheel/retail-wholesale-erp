"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!posthog.__loaded) return;
    const safeError = new globalThis.Error("Application route rendering failed");
    safeError.name = /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(error?.name || "")
      ? error.name
      : "ApplicationError";
    safeError.stack = error?.stack;
    posthog.captureException(safeError);
  }, [error]);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "Arial, sans-serif", color: "#172b4d" }}>
      <section style={{ maxWidth: 440, textAlign: "center" }}>
        <h1>Something went wrong</h1>
        <p>Etihad Prime Supplies could not display this section. Your saved business records have not been changed by this screen error.</p>
        <button onClick={() => reset()} style={{ padding: "12px 20px", border: 0, borderRadius: 8, background: "#172b4d", color: "white", fontWeight: 600 }}>
          Try again
        </button>
      </section>
    </main>
  );
}
