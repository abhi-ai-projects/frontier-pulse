import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Frontier Pulse — Compare frontier AI models side by side";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Three big dots — centrepiece */}
        <div
          style={{
            display: "flex",
            gap: 36,
            alignItems: "center",
            marginBottom: 56,
          }}
        >
          <div style={{ width: 100, height: 100, borderRadius: "50%", background: "#ff9f6b", boxShadow: "0 0 80px rgba(255,159,107,0.6)", display: "flex" }} />
          <div style={{ width: 100, height: 100, borderRadius: "50%", background: "#63d68d", boxShadow: "0 0 80px rgba(99,214,141,0.6)", display: "flex" }} />
          <div style={{ width: 100, height: 100, borderRadius: "50%", background: "#6ab4f5", boxShadow: "0 0 80px rgba(106,180,245,0.6)", display: "flex" }} />
        </div>

        {/* Wordmark */}
        <span
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "#f5f5f7",
            letterSpacing: "-2px",
            lineHeight: 1,
            marginBottom: 24,
          }}
        >
          Frontier Pulse
        </span>

        {/* Tagline — single line, large */}
        <span
          style={{
            fontSize: 30,
            fontWeight: 400,
            color: "#c8c8cc",
            letterSpacing: "-0.3px",
          }}
        >
          One prompt. Three frontier models. See who says what.
        </span>

        {/* Bottom accent line */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 4,
            background: "linear-gradient(to right, #ff9f6b, #63d68d, #6ab4f5)",
            display: "flex",
          }}
        />
      </div>
    ),
    {
      ...size,
    },
  );
}
