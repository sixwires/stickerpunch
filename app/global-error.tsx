"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "#fafafa",
          color: "#171717",
        }}
      >
        <div style={{ textAlign: "center", padding: 32 }}>
          <h1 style={{ fontSize: 28, marginBottom: 8 }}>Sticker Punch crashed.</h1>
          <p style={{ color: "#525252", marginBottom: 16 }}>
            Reload the page to keep punching.
          </p>
          {error.digest ? (
            <code style={{ color: "#737373" }}>ref: {error.digest}</code>
          ) : null}
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "8px 16px",
                borderRadius: 9999,
                background: "#171717",
                color: "white",
                border: 0,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
