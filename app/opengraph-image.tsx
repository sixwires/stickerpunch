import { ImageResponse } from "next/og";

import { listStickers } from "./actions/stickers";

export const runtime = "nodejs";
export const alt = "Sticker Punch";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG() {
  let stickers: { id: string; url: string; width: number; height: number }[] = [];
  try {
    const page = await listStickers(null, 12);
    stickers = page.items;
  } catch {
    stickers = [];
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #fdf2f8 0%, #fffbeb 100%)",
          fontFamily: "sans-serif",
          padding: 64,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 9999,
              background: "linear-gradient(135deg, #f472b6 0%, #fcd34d 100%)",
              boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
            }}
          />
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -1 }}>
            Sticker Punch
          </div>
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 32,
            color: "#525252",
            maxWidth: 760,
            lineHeight: 1.2,
          }}
        >
          Punch subjects out of notebook photos with jelly-soft selection.
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
            padding: "260px 80px 80px",
            pointerEvents: "none",
          }}
        >
          {stickers.slice(0, 12).map((s, i) => (
            <img
              key={s.id}
              src={s.url}
              width={140}
              height={140}
              alt=""
              style={{
                objectFit: "contain",
                transform: `rotate(${((i * 73) % 16) - 8}deg)`,
                filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.15))",
              }}
            />
          ))}
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
