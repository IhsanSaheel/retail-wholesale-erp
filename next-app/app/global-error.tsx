"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!posthog.__loaded) return;
    const safeError = new Error("Application root rendering failed");
    safeError.name = /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(error?.name || "")
      ? error.name
      : "ApplicationError";
    safeError.stack = error?.stack;
    posthog.captureException(safeError);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "Arial, sans-serif", color: "#172b4d" }}>
        <main style={{ maxWidth: 440, textAlign: "center" }}>
          <h1>Etihad Prime Supplies</h1>
          <h2>Something went wrong</h2>
          <p>The application could not start this screen. Please try again.</p>
          <button onClick={() => reset()} style={{ padding: "12px 20px", border: 0, borderRadius: 8, background: "#172b4d", color: "white", fontWeight: 600 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
