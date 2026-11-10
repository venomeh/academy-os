"use client";

import { useState } from "react";

const FAQS = [
  [
    "Do I need to be technical?",
    "No. If you can use WhatsApp, you can run AcademyOS. Setup is done for you before you start.",
  ],
  [
    "Does it work on my phone?",
    "It's built phone-first. Teachers mark attendance on theirs, parents check dues on theirs.",
  ],
  [
    "What happens to my old records?",
    "Bring the last few months of fees and we'll load them in, so arrears carry forward correctly from day one.",
  ],
  [
    "Can parents pay online?",
    "Yes — a pay link sits inside every voucher. Cash at the front desk is recorded the same way, with a receipt.",
  ],
  [
    "Is my academy's data safe?",
    "Every family can only ever see their own children’s records. That’s enforced at the database level, not by hiding buttons.",
  ],
  [
    "What does it cost?",
    "Pricing is being finalised. Waitlist academies get the launch rate, locked for the first year.",
  ],
];

export default function Faq() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section
      id="faq"
      style={{
        background: "#F7F5F0",
        padding: "var(--pad-y) var(--gutter)",
      }}
    >
      <div style={{ maxWidth: 1360, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            color: "#0D0D0D",
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
            Questions
          </span>
        </div>

        <h2
          style={{
            margin: "24px 0 clamp(48px, 6vw, 72px) -0.05em",
            fontSize: "clamp(2.25rem, 8vw, 5rem)",
            fontWeight: 900,
            letterSpacing: "-0.04em",
            lineHeight: 0.92,
          }}
        >
          Questions, answered.
        </h2>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {FAQS.map(([q, a], i) => {
            const open = openIndex === i;
            return (
              <div
                key={i}
                style={{ borderTop: "1px solid rgba(13,13,13,0.12)" }}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenIndex(open ? -1 : i)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 24,
                    background: "none",
                    border: 0,
                    padding: "28px 0",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "opacity 160ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.6";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                >
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {q}
                  </span>
                  <span
                    style={{
                      fontSize: 24,
                      fontWeight: 500,
                      flex: "none",
                      transform: open ? "rotate(45deg)" : "none",
                      transition: "transform 300ms ease",
                    }}
                  >
                    +
                  </span>
                </button>
                <div
                  role="region"
                  style={{
                    display: "grid",
                    gridTemplateRows: open ? "1fr" : "0fr",
                    transition: "grid-template-rows 300ms ease",
                    overflow: "hidden",
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 28px",
                      maxWidth: "62ch",
                      fontSize: "1.0625rem",
                      lineHeight: 1.6,
                      color: "#6B6B66",
                      overflow: "hidden",
                    }}
                  >
                    {a}
                  </p>
                </div>
              </div>
            );
          })}
          <div style={{ borderTop: "1px solid rgba(13,13,13,0.12)" }} />
        </div>
      </div>
    </section>
  );
}
