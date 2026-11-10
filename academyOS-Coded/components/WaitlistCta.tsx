"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function WaitlistCta() {
  const join = useMutation(api.waitlist.join);
  const [email, setEmail] = useState("");
  const [form, setForm] = useState<"idle" | "loading" | "error" | "failed" | "success">(
    "idle"
  );

  const loading = form === "loading";
  const invalid = form === "error";
  const failed = form === "failed";
  const submitted = form === "success";

  // Writes to the `waitlist` table (§13); the confirmation email is
  // scheduled server-side the moment the row lands.
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!ok) {
      setForm("error");
      return;
    }
    setForm("loading");
    try {
      await join({ email: email.trim(), source: "landing" });
      setForm("success");
    } catch {
      setForm("failed");
    }
  }

  return (
    <section
      id="waitlist"
      style={{
        background: "#FF4E18",
        color: "#0D0D0D",
        padding: "calc(var(--pad-y) * 1.25) var(--gutter)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          maxWidth: 1360,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
            The ask
          </span>
        </div>

        <h2
          style={{
            margin: "24px 0 0",
            fontSize: "clamp(2.25rem, 8vw, 5rem)",
            fontWeight: 900,
            letterSpacing: "-0.04em",
            lineHeight: 0.92,
          }}
        >
          Ready to close
          <br />
          the register?
        </h2>

        <p
          style={{
            maxWidth: "38ch",
            margin: "24px 0 40px",
            fontSize: "clamp(1.125rem, 3.6vw, 1.5rem)",
            lineHeight: 1.45,
            letterSpacing: "-0.01em",
            color: "rgba(13,13,13,0.8)",
          }}
        >
          Join the waitlist. We&apos;re onboarding a small first group of
          academies.
        </p>

        {submitted ? (
          <div
            aria-live="polite"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              minHeight: 58,
            }}
          >
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: 9999,
                background: "#0D0D0D",
                color: "#FF4E18",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              ✓
            </span>
            <span
              style={{
                fontSize: "1.5rem",
                fontWeight: 900,
                letterSpacing: "-0.03em",
              }}
            >
              You&apos;re on the list.
            </span>
            <span
              style={{ fontSize: "1.0625rem", color: "rgba(13,13,13,0.7)" }}
            >
              A confirmation is on its way to {email.trim().toLowerCase()}.
            </span>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ width: "100%", maxWidth: 560 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
              }}
            >
              <label
                htmlFor="wl-email"
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  overflow: "hidden",
                  clipPath: "inset(50%)",
                }}
              >
                Email address
              </label>
              <input
                id="wl-email"
                type="email"
                placeholder="your@academy.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setForm("idle");
                }}
                aria-invalid={invalid}
                disabled={loading}
                style={{
                  flex: "2 1 260px",
                  height: 58,
                  padding: "0 24px",
                  borderRadius: 9999,
                  border: `1px solid ${
                    invalid ? "#0D0D0D" : "rgba(13,13,13,0.12)"
                  }`,
                  background: "transparent",
                  fontSize: 16,
                  color: "#0D0D0D",
                  opacity: loading ? 0.6 : 1,
                }}
              />
              <button
                type="submit"
                style={{
                  flex: "1 1 140px",
                  height: 58,
                  border: 0,
                  borderRadius: 9999,
                  background: "#0D0D0D",
                  color: "#F7F5F0",
                  fontWeight: 700,
                  fontSize: 16,
                  cursor: "pointer",
                  transition: "background 160ms, color 160ms",
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
                {loading ? "Joining…" : "Join"}
              </button>
            </div>
            {invalid && (
              <div
                style={{ marginTop: 12, fontSize: 14, textAlign: "left" }}
              >
                Enter a valid email address.
              </div>
            )}
            {failed && (
              <div
                role="alert"
                style={{ marginTop: 12, fontSize: 14, textAlign: "left" }}
              >
                Couldn&apos;t save that just now — please try again in a moment.
              </div>
            )}
            <div
              style={{
                marginTop: 20,
                fontSize: "0.6875rem",
                fontWeight: 500,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(13,13,13,0.65)",
              }}
            >
              One email when we open. Nothing else.
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
