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
          padding: "0 96px",
          position: "relative",
          overflow: "hidden",
          fontFamily: "sans-serif",
        }}
      >
        {/* Dot grid texture */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.045) 1px, transparent 1px)",
            backgroundSize: "36px 36px",
          }}
        />

        {/* Glow behind dots */}
        <div
          style={{
            position: "absolute",
            right: 100,
            top: "50%",
            width: 420,
            height: 420,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(255,159,107,0.08) 0%, rgba(99,214,141,0.05) 40%, rgba(106,180,245,0.04) 70%, transparent 100%)",
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
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 28 }}>
            {/* Three dots SVG */}
            <svg width="44" height="30" viewBox="0 0 28 18" fill="none">
              <circle cx="4"  cy="9" r="4" fill="#ff9f6b" />
              <circle cx="14" cy="9" r="4" fill="#63d68d" />
              <circle cx="24" cy="9" r="4" fill="#6ab4f5" />
            </svg>
            <span
              style={{
                fontSize: 58,
                fontWeight: 700,
                color: "#f5f5f7",
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              Frontier Pulse
            </span>
          </div>

          {/* Tagline */}
          <p
            style={{
              fontSize: 24,
              fontWeight: 400,
              color: "#6e6e73",
              letterSpacing: "-0.01em",
              lineHeight: 1.4,
              maxWidth: 520,
              marginBottom: 40,
              margin: "0 0 40px 0",
            }}
          >
            One prompt.{" "}
            <span style={{ color: "#a1a1a6", fontWeight: 600 }}>
              Three frontier models.
            </span>{" "}
            See exactly who says what — and how they differ.
          </p>

          {/* URL */}
          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: "#3a3a3c",
              letterSpacing: "0.02em",
            }}
          >
            frontierpulse.org
          </span>
        </div>

        {/* Right — three large dots */}
        <div
          style={{
            position: "absolute",
            right: 112,
            top: "50%",
            display: "flex",
            gap: 22,
            alignItems: "center",
            zIndex: 1,
            transform: "translateY(-50%)",
          }}
        >
          {[
            { color: "#ff9f6b", shadow: "rgba(255,159,107,0.4)" },
            { color: "#63d68d", shadow: "rgba(99,214,141,0.4)" },
            { color: "#6ab4f5", shadow: "rgba(106,180,245,0.4)" },
          ].map(({ color, shadow }) => (
            <div
              key={color}
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: color,
                boxShadow: `0 0 48px ${shadow}`,
              }}
            />
          ))}
        </div>

        {/* Bottom gradient accent line */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            background: "linear-gradient(to right, #ff9f6b, #63d68d, #6ab4f5)",
            opacity: 0.5,
          }}
        />
      </div>
    ),
    { ...size },
  );
}
