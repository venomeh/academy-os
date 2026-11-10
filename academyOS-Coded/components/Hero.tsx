"use client";

export default function Hero() {
  return (
    <section
      style={{
        background: "#FF4E18",
        overflow: "hidden",
        minHeight: "92svh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "clamp(140px, 20vh, 220px) clamp(20px, 5vw, 64px) 0",
        textAlign: "center",
      }}
    >
      <div
        style={{
          maxWidth: 1360,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            color: "#0D0D0D",
            animation: "fadeUp 500ms ease-out 120ms both",
          }}
        >
          <span
            style={{
              width: 24,
              height: 1,
              background: "currentColor",
              opacity: 0.4,
              display: "block",
            }}
          />
          <span
            style={{
              fontSize: "0.6875rem",
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              lineHeight: 1,
            }}
          >
            Now onboarding academies
          </span>
        </div>

        {/* Headline */}
        <h1
          style={{
            margin: "clamp(24px, 4vw, 40px) 0 0",
            fontSize: "clamp(3.25rem, 13vw, 9rem)",
            fontWeight: 900,
            letterSpacing: "-0.045em",
            lineHeight: 0.88,
            color: "#0D0D0D",
          }}
        >
          <span
            style={{
              display: "block",
              overflow: "hidden",
              paddingBottom: "0.16em",
              marginBottom: "-0.16em",
            }}
          >
            <span
              style={{
                display: "block",
                animation:
                  "heroLine 700ms cubic-bezier(0.16,1,0.3,1) both",
              }}
            >
              Your fee
            </span>
          </span>
          <span
            style={{
              display: "block",
              overflow: "hidden",
              paddingBottom: "0.16em",
              marginBottom: "-0.16em",
            }}
          >
            <span
              style={{
                display: "block",
                animation:
                  "heroLine 700ms cubic-bezier(0.16,1,0.3,1) 90ms both",
              }}
            >
              register.
            </span>
          </span>
          <span
            style={{
              display: "block",
              overflow: "hidden",
              paddingBottom: "0.16em",
              marginBottom: "-0.16em",
            }}
          >
            <span
              style={{
                display: "block",
                animation:
                  "heroLine 700ms cubic-bezier(0.16,1,0.3,1) 180ms both",
              }}
            >
              Finally digital.
            </span>
          </span>
        </h1>

        {/* Lead paragraph */}
        <p
          style={{
            maxWidth: "38ch",
            margin: "clamp(20px, 3vw, 32px) 0 0",
            fontSize: "clamp(1.125rem, 3.6vw, 1.5rem)",
            fontWeight: 400,
            letterSpacing: "-0.01em",
            lineHeight: 1.45,
            color: "rgba(13,13,13,0.8)",
            animation: "fadeUp 500ms ease-out 380ms both",
          }}
        >
          Vouchers, payments, attendance, marks and parent updates — one
          platform for the whole academy.
        </p>

        {/* CTA button */}
        <a
          href="#waitlist"
          style={{
            marginTop: 32,
            background: "#0D0D0D",
            color: "#F7F5F0",
            fontWeight: 700,
            fontSize: 16,
            padding: "18px 32px",
            borderRadius: 9999,
            transition: "background 160ms, color 160ms",
            animation: "fadeUp 500ms ease-out 380ms both",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#F7F5F0";
            e.currentTarget.style.color = "#0D0D0D";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#0D0D0D";
            e.currentTarget.style.color = "#F7F5F0";
          }}
        >
          Join the waitlist
        </a>

        {/* Reassurance row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "12px 32px",
            marginTop: 28,
            color: "rgba(13,13,13,0.65)",
            fontSize: "0.6875rem",
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            animation: "fadeUp 500ms ease-out 460ms both",
          }}
        >
          <span>No card required</span>
          <span>Setup done for you</span>
          <span>One email when we open</span>
        </div>

        {/* Voucher card */}
        <div
          aria-hidden="true"
          style={{
            width: "92%",
            maxWidth: 560,
            margin: "clamp(48px, 7vw, 88px) auto min(-14vh, -150px)",
            background: "#F7F5F0",
            borderRadius: 20,
            padding: 24,
            textAlign: "left",
            animation:
              "riseUp 800ms cubic-bezier(0.16,1,0.3,1) 620ms both",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              paddingBottom: 16,
              borderBottom: "1px solid rgba(13,13,13,0.12)",
            }}
          >
            <span
              style={{
                fontSize: "0.6875rem",
                fontWeight: 500,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#6B6B66",
              }}
            >
              Voucher &middot; March 2026
            </span>
            <span
              style={{
                background: "#0D0D0D",
                color: "#F7F5F0",
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontWeight: 500,
                padding: "6px 14px",
                borderRadius: 9999,
              }}
            >
              Unpaid
            </span>
          </div>

          {/* Student */}
          <div
            style={{
              padding: "16px 0",
              borderBottom: "1px solid rgba(13,13,13,0.12)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 18, color: "#0D0D0D" }}>
              Ayesha Khan
            </div>
            <div style={{ fontSize: 14, color: "#6B6B66", marginTop: 4 }}>
              Batch 9-B &middot; Due 10 March
            </div>
          </div>

          {/* Line items */}
          <VoucherLine label="Monthly tuition" amount="4,500" />
          <VoucherLine label="Sibling discount" amount="−450" />
          <VoucherLine label="Arrears carried forward" amount="4,500" />
          <VoucherLine label="Late fine" amount="200" />

          {/* Total */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 16,
              paddingTop: 18,
              borderTop: "2px solid #0D0D0D",
              marginTop: 6,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 20 }}>Total due</span>
            <span
              style={{
                fontWeight: 900,
                fontSize: 28,
                letterSpacing: "-0.03em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              8,750
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function VoucherLine({ label, amount }: { label: string; amount: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 0",
        borderBottom: "1px solid rgba(13,13,13,0.12)",
        fontSize: 15,
      }}
    >
      <span style={{ color: "#6B6B66" }}>{label}</span>
      <span style={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
        {amount}
      </span>
    </div>
  );
}
