"use client";

export default function Marquee() {
  const items =
    "Monthly vouchers ◆ Sibling discounts ◆ Arrears carried forward ◆ Late fines ◆ Cash & online ◆ Attendance in 60 seconds ◆ AI progress remarks ◆ Parent portal ◆";

  return (
    <section
      aria-hidden="true"
      style={{
        background: "#0D0D0D",
        height: 56,
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          width: "max-content",
          animation: "marquee 36s linear infinite",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.animationPlayState = "paused";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.animationPlayState = "running";
        }}
      >
        <MarqueeSpan text={items} />
        <MarqueeSpan text={items} />
      </div>
    </section>
  );
}

function MarqueeSpan({ text }: { text: string }) {
  const parts = text.split("◆");
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        paddingRight: 20,
        color: "#F7F5F0",
        fontSize: "0.6875rem",
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {parts.map((part, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {part.trim()}
          {i < parts.length - 1 && (
            <span style={{ color: "#FF4E18" }}>◆</span>
          )}
        </span>
      ))}
    </span>
  );
}
