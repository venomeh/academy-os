import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "AcademyOS — the paper fee register, closed.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social preview card (§13 "OG/meta tags set"). Generated at request time
 * from markup so it needs no binary asset in the repo and always matches
 * the landing page's palette.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#FF4E18",
          color: "#0D0D0D",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "#0D0D0D" }} />
          <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: -2 }}>AcademyOS</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 118, fontWeight: 900, letterSpacing: -6, lineHeight: 0.92 }}>The register</div>
          <div style={{ fontSize: 118, fontWeight: 900, letterSpacing: -6, lineHeight: 0.92 }}>is closed.</div>
          <div style={{ marginTop: 34, fontSize: 32, lineHeight: 1.3, maxWidth: 900, color: "rgba(13,13,13,0.78)" }}>
            Fee vouchers, attendance, marks, AI progress remarks and a parent portal — for tuition academies in Pakistan.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(13,13,13,0.6)" }}>
          <div>Owner · Teacher · Parent</div>
          <div>English · اردو</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
