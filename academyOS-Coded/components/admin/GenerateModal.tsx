"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import Modal from "@/components/ui/Modal";

type GenResult = { created: number; skipped: number; flaggedForReview: number; period: string };

const STEPS: [string, (r: GenResult) => string][] = [
  ["Read active enrollments and fee rules", (r) => `${r.created + r.skipped} students`],
  ["Compute tuition, discounts, arrears, fines", (r) => `${r.created + r.skipped} vouchers`],
  ["Insert with unique (student, period)", (r) => `${r.created} created · ${r.skipped} skipped`],
  ["Queue Resend voucher emails", (r) => `${r.created} scheduled`],
];

const CURRENT_PERIOD = new Date().toISOString().slice(0, 7);
const PERIOD_LABEL = new Date(`${CURRENT_PERIOD}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export default function GenerateModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const generateVouchers = useAction(api.vouchers.generateVouchers);
  const [stage, setStage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [notice, setNotice] = useState("");

  async function run() {
    setBusy(true);
    setNotice("");
    setStage(1);
    const t1 = setTimeout(() => setStage(2), 700);
    const t2 = setTimeout(() => setStage(3), 1400);
    const r = await generateVouchers({ period: CURRENT_PERIOD });
    clearTimeout(t1);
    clearTimeout(t2);
    setStage(4);
    setBusy(false);

    if ("skipped" in r && typeof r.skipped === "string") {
      setNotice(r.skipped);
      onDone(`Not run: ${r.skipped}.`);
      return;
    }
    const gen = r as GenResult;
    setResult(gen);
    const summary =
      gen.created > 0
        ? `${gen.created} vouchers created, ${gen.skipped} already invoiced, ${gen.flaggedForReview} flagged for review.`
        : `0 created, ${gen.skipped} skipped — already invoiced this period. Idempotent re-run, exactly as designed.`;
    onDone(summary);
  }

  const done = stage === 4;

  return (
    <Modal title={`Generate ${PERIOD_LABEL} vouchers`} onClose={onClose}>
      <div style={{ padding: 20 }}>
        <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.55, color: "#4A463F" }}>
          Runs voucher generation for {PERIOD_LABEL}. Generation is idempotent per student per period, so a re-run skips anyone already invoiced.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
          {STEPS.map(([label, metaFn], i) => {
            const stepDone = stage > i + 1 || stage === 4;
            const active = stage === i + 1;
            return (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 9 }}>
                <span
                  style={{
                    width: 22, height: 22, flex: "none", borderRadius: 9999,
                    background: stepDone ? "#0D0D0D" : active ? "#FF4E18" : "#EDEBE4",
                    color: stepDone ? "#FF4E18" : "#0D0D0D",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: 900,
                    animation: active ? "dashPulseDot 1.2s ease-in-out infinite" : "none",
                  }}
                >
                  {stepDone ? "✓" : active ? "·" : ""}
                </span>
                <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{label}</span>
                <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#8A857C", fontVariantNumeric: "tabular-nums" }}>
                  {stepDone && result ? metaFn(result) : active ? "running…" : "queued"}
                </span>
              </div>
            );
          })}
        </div>
        {done && result && (
          <div style={{ marginTop: 16, padding: "14px 15px", background: "#F1F7F3", border: "1px solid #D3E7DC", borderRadius: 10, fontSize: "0.8125rem", lineHeight: 1.5, color: "#0B5F3B", animation: "dashRiseIn 300ms ease-out both" }}>
            {result.created > 0
              ? `Created ${result.created} · skipped ${result.skipped} duplicates · flagged ${result.flaggedForReview} for review · queued ${result.created} guardian emails.`
              : `0 created · ${result.skipped} skipped (already invoiced this period) — proves re-running never duplicates a voucher.`}
          </div>
        )}
        {done && notice && (
          <div style={{ marginTop: 16, padding: "14px 15px", background: "#FFF6E8", border: "1px solid #F2E1C4", borderRadius: 10, fontSize: "0.8125rem", lineHeight: 1.5, color: "#8A5B0B", animation: "dashRiseIn 300ms ease-out both" }}>
            Not run: {notice}.
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={{ flex: "1 1 130px", height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}>
            Close
          </button>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            style={{ flex: "1 1 150px", height: 42, background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: busy ? "progress" : "pointer", opacity: busy ? 0.8 : 1 }}
          >
            {busy ? "Running…" : done ? "Re-run (idempotent)" : "Run generation"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
