"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

type Receipt = FunctionReturnType<typeof api.stripe.getSessionReceipt>;

const POLL_MS = 2000;
const MAX_ATTEMPTS = 20; // ~40s — the webhook lands within seconds in practice

function periodLabel(period: string) {
  return new Date(`${period}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function SuccessInner() {
  const sessionId = useSearchParams().get("session_id");
  const getSessionReceipt = useAction(api.stripe.getSessionReceipt);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const attempts = useRef(0);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    cancelled.current = false;

    async function poll() {
      const result = await getSessionReceipt({ sessionId: sessionId! });
      if (cancelled.current) return;
      setReceipt(result);
      attempts.current += 1;
      if (result.status !== "pending") return;
      // Give up spinning rather than leaving the parent staring at it: the
      // card is already charged, the ledger just hasn't caught up.
      if (attempts.current >= MAX_ATTEMPTS) setTimedOut(true);
      else setTimeout(poll, POLL_MS);
    }
    poll();

    return () => {
      cancelled.current = true;
    };
  }, [sessionId, getSessionReceipt]);

  const stage = !sessionId
    ? "empty"
    : timedOut
      ? "slow"
      : !receipt || receipt.status === "pending"
        ? "pending"
        : receipt.status === "not_found"
          ? "empty"
          : "done";

  return (
    <div style={{ minHeight: "100svh", display: "flex", flexDirection: "column", alignItems: "center", padding: "clamp(28px, 7vh, 72px) clamp(16px, 4vw, 24px) 56px" }}>
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, justifyContent: "center" }}>
          <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: 4, background: "#FF4E18", display: "block" }} />
          <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: "-0.03em" }}>AcademyOS</span>
        </div>

        <div style={{ marginTop: "clamp(28px, 6vh, 52px)", textAlign: "center" }}>
          {stage === "pending" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span aria-hidden="true" style={{ width: 62, height: 62, borderRadius: 9999, border: "3px solid #E3DFD6", borderTopColor: "#0D0D0D", display: "block", animation: "dashSpin 900ms linear infinite" }} />
              <h1 style={{ margin: "26px 0 0", fontSize: "clamp(1.5rem, 6vw, 2rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.05 }}>Confirming with Stripe…</h1>
              <p style={{ maxWidth: "34ch", margin: "12px 0 0", fontSize: "0.9375rem", lineHeight: 1.55, color: "#6B6660" }}>
                Your card has been charged. The balance updates the moment the signed webhook lands — never before.
              </p>
            </div>
          )}

          {stage === "slow" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span aria-hidden="true" style={{ width: 62, height: 62, borderRadius: 9999, background: "#FFF6E8", border: "1px solid #F2E1C4", color: "#8A5B0B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 900 }}>
                !
              </span>
              <h1 style={{ margin: "26px 0 0", fontSize: "clamp(1.5rem, 6vw, 2rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.05 }}>Payment received, still confirming.</h1>
              <p style={{ maxWidth: "38ch", margin: "12px 0 0", fontSize: "0.9375rem", lineHeight: 1.55, color: "#6B6660" }}>
                Your card was charged — that part is done. The balance updates only when Stripe&apos;s signed confirmation reaches us, which is taking longer than usual. It normally lands within a few minutes; the academy can see the payment either way.
              </p>
              <Link
                href="/parent"
                style={{ marginTop: 24, height: 48, padding: "0 24px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#0D0D0D", color: "#F7F6F3", borderRadius: 10, fontSize: "0.875rem", fontWeight: 700 }}
              >
                Back to the portal
              </Link>
            </div>
          )}

          {stage === "empty" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 6vw, 2rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.05 }}>No payment in progress.</h1>
              <p style={{ maxWidth: "34ch", margin: "12px 0 0", fontSize: "0.9375rem", lineHeight: 1.55, color: "#6B6660" }}>
                Start a payment from the parent portal — this page confirms a checkout session, it isn&apos;t reachable directly.
              </p>
              <Link
                href="/parent"
                style={{ marginTop: 24, height: 48, padding: "0 24px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#0D0D0D", color: "#F7F6F3", borderRadius: 10, fontSize: "0.875rem", fontWeight: 700 }}
              >
                Back to the portal
              </Link>
            </div>
          )}

          {stage === "done" && receipt && receipt.status === "paid" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span aria-hidden="true" style={{ position: "relative", width: 68, height: 68, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: 9999, background: "#FF4E18", opacity: 0.35, display: "block", animation: "dashHaloOut 900ms ease-out 120ms both" }} />
                <span style={{ position: "relative", width: 62, height: 62, borderRadius: 9999, background: "#0D0D0D", display: "flex", alignItems: "center", justifyContent: "center", animation: "dashRingIn 380ms cubic-bezier(0.16,1,0.3,1) both" }}>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
                    <path d="M7 15.5 L13 21 L23 9.5" stroke="#FF4E18" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={42} style={{ animation: "dashDrawTick 480ms cubic-bezier(0.16,1,0.3,1) 260ms both" }} />
                  </svg>
                </span>
              </span>
              <h1 style={{ margin: "26px 0 0", fontSize: "clamp(1.75rem, 7vw, 2.5rem)", fontWeight: 900, letterSpacing: "-0.045em", lineHeight: 0.95 }}>
                <span style={{ display: "block", overflow: "hidden", paddingBottom: "0.14em", marginBottom: "-0.14em" }}>
                  <span style={{ display: "block", animation: "dashMaskUp 620ms cubic-bezier(0.16,1,0.3,1) 180ms both" }}>Payment received.</span>
                </span>
              </h1>
              <p style={{ maxWidth: "36ch", margin: "12px 0 0", fontSize: "0.9375rem", lineHeight: 1.55, color: "#6B6660", animation: "dashFadeIn 500ms ease-out 520ms both" }}>
                The voucher is settled and the reminder sequence has stopped. A receipt is on its way to your email.
              </p>
            </div>
          )}
        </div>

        {stage === "done" && receipt && receipt.status === "paid" && (
          <>
            <div style={{ marginTop: 30, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 14, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", overflow: "hidden", animation: "dashRiseIn 520ms cubic-bezier(0.16,1,0.3,1) 420ms both" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "1px solid #EFEDE7" }}>
                <span style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>
                  {receipt.receiptNumber ?? "Receipt"}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 9px", background: "#F1F7F3", border: "1px solid #D3E7DC", borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "#0B7A4B" }}>Paid</span>
                <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#8A857C" }}>
                  {receipt.paidAt ? new Date(receipt.paidAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : ""}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "14px 18px", borderBottom: "1px solid #F1EFE9" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: "0.875rem", fontWeight: 700, letterSpacing: "-0.01em" }}>{receipt.studentName}</span>
                  <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{periodLabel(receipt.period)} voucher</span>
                </span>
                <span style={{ fontSize: "0.9375rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{receipt.amount.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "17px 18px", background: "#0D0D0D", color: "#F7F6F3" }}>
                <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>Charged to card</span>
                <span style={{ fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", color: "#FF4E18" }}>{receipt.amount.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 24px", padding: "16px 18px", background: "#FAF9F6" }}>
                {[
                  { label: "Method", value: "Card via Stripe", mono: false },
                  { label: "Stripe session", value: sessionId ?? "—", mono: true },
                  { label: "Event ID", value: receipt.eventId ?? "—", mono: true },
                  { label: "Ledger entry", value: receipt.ledgerEntryId ?? "—", mono: true },
                ].map((m) => (
                  <span key={m.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: "0.625rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#A8A39A" }}>{m.label}</span>
                    <span style={{ fontSize: "0.8125rem", fontWeight: m.mono ? 500 : 700, fontFamily: m.mono ? "ui-monospace, Menlo, monospace" : "inherit", color: "#2A2723" }}>{m.value}</span>
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18, animation: "dashFadeIn 500ms ease-out 720ms both" }}>
              <button
                type="button"
                onClick={() => setDownloaded(true)}
                style={{ flex: "1 1 170px", height: 48, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 10, fontSize: "0.875rem", fontWeight: 700, cursor: "pointer" }}
              >
                {downloaded ? "Receipt downloaded" : "Download receipt"}
              </button>
              <Link
                href="/parent"
                style={{ flex: "1 1 170px", height: 48, display: "flex", alignItems: "center", justifyContent: "center", background: "#0D0D0D", color: "#F7F6F3", borderRadius: 10, fontSize: "0.875rem", fontWeight: 700 }}
              >
                Back to the portal
              </Link>
            </div>

            <p style={{ margin: "22px 0 0", fontSize: "0.75rem", lineHeight: 1.6, color: "#A8A39A", textAlign: "center", animation: "dashFadeIn 500ms ease-out 800ms both" }}>
              This entry was written by the signature-verified Stripe webhook and is idempotent on its event ID. A replayed event will never credit twice.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessInner />
    </Suspense>
  );
}
