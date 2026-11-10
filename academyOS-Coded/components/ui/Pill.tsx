import { TONE_STYLE, type Tone } from "@/lib/format";

export default function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = TONE_STYLE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 9px",
        background: t.bg,
        border: `1px solid ${t.bd}`,
        borderRadius: 6,
        fontSize: "0.6875rem",
        fontWeight: 500,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: t.fg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
