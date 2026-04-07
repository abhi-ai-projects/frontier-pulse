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
          alignItems: "center",
          padding: "0 100px",
          position: "relative",
          overflow: "hidden",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Subtle glow behind the dots */}
        <div
          style={{
            position: "absolute",
            right: 80,
            top: "50%",
            width: 460,
            height: 460,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(99,214,141,0.06) 0%, rgba(106,180,245,0.04) 50%, transparent 80%)",
            display: "flex",
            transform: "translateY(-50%)",
          }}
        />

        {/* Left content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            zIndex: 1,
          }}
        >
          {/* Logo row */}
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 32 }}>
            <svg width="48" height="32" viewBox="0 0 28 18" fill="none">
              <circle cx="4"  cy="9" r="4" fill="#ff9f6b" />
              <circle cx="14" cy="9" r="4" fill="#63d68d" />
              <circle cx="24" cy="9" r="4" fill="#6ab4f5" />
            </svg>
            <span
              style={{
                fontSize: 60,
                fontWeight: 700,
                color: "#f5f5f7",
                letterSpacing: "-2px",
                lineHeight: 1,
              }}
            >
              Frontier Pulse
            </span>
          </div>

          {/* Tagline */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              marginBottom: 44,
            }}
          >
            <span style={{ fontSize: 28, fontWeight: 400, color: "#c8c8cc", lineHeight: 1.5 }}>
              One prompt.{" "}
              <span style={{ color: "#ffffff", fontWeight: 700 }}>Three frontier models.</span>
            </span>
            <span style={{ fontSize: 28, fontWeight: 400, color: "#c8c8cc", lineHeight: 1.5 }}>
              See who says what — and how they differ.
            </span>
          </div>

          {/* URL */}
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#8e8e93",
              letterSpacing: "0.5px",
            }}
          >
            frontierpulse.org
          </span>
        </div>

        {/* Right — three large dots */}
        <div
          style={{
            position: "absolute",
            right: 108,
            top: "50%",
            display: "flex",
            gap: 20,
            alignItems: "center",
            zIndex: 1,
            transform: "translateY(-50%)",
          }}
        >
          <div style={{ width: 76, height: 76, borderRadius: "50%", background: "#ff9f6b", boxShadow: "0 0 52px rgba(255,159,107,0.45)", display: "flex" }} />
          <div style={{ width: 76, height: 76, borderRadius: "50%", background: "#63d68d", boxShadow: "0 0 52px rgba(99,214,141,0.45)", display: "flex" }} />
          <div style={{ width: 76, height: 76, borderRadius: "50%", background: "#6ab4f5", boxShadow: "0 0 52px rgba(106,180,245,0.45)", display: "flex" }} />
        </div>

        {/* Bottom accent line */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
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
