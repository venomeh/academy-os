"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fmt } from "@/lib/format";
import type { Tone } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Pill from "@/components/ui/Pill";
import ReceiptModal, { type ReceiptData } from "@/components/ui/ReceiptModal";

const KIND_TONE: Record<string, Tone> = { payment: "paid", fine: "unpaid", discount: "partial", voucher: "neutral", adjustment: "neutral" };

function periodLabel(period: string | null) {
  if (!period) return "";
  return new Date(`${period}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Admin's per-family statement (§8.3) — the same append-only rows the parent sees, for the front desk. */
export default function FamilyStatementModal({ guardianId, onClose }: { guardianId: Id<"guardians">; onClose: () => void }) {
  const data = useQuery(api.ledger.listForFamily, { guardianId });
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  return (
    <>
      <Modal title="Family statement" onClose={onClose} width={620}>
        {data === null && <div style={{ padding: 32, textAlign: "center", fontSize: "0.8125rem", color: "#8A857C" }}>Family not found.</div>}
        {data && (
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 14 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: "1.0625rem", fontWeight: 900, letterSpacing: "-0.025em" }}>{data.guardian.name}</span>
                <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>
                  {data.guardian.email ?? "no email"} · {data.guardian.phone ?? "no phone"} · {data.guardian.languagePref === "ur" ? "اردو" : "English"}
                </span>
                {data.guardian.remindersPaused && (
                  <span style={{ marginTop: 4, fontSize: "0.75rem", color: "#8A5B0B" }}>Reminders paused · {data.guardian.remindersPausedReason ?? "no reason recorded"}</span>
                )}
              </span>
              <span style={{ marginLeft: "auto", textAlign: "right" }}>
                <span style={{ display: "block", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Family balance</span>
                <span style={{ display: "block", marginTop: 4, fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums" }}>{fmt(data.runningBalance)}</span>
              </span>
            </div>

            {data.children.length > 1 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {data.children.map((c) => (
                  <span key={c.studentId} style={{ padding: "7px 11px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 8, fontSize: "0.75rem" }}>
                    <span style={{ fontWeight: 700 }}>{c.name}</span> <span style={{ color: "#8A857C", fontVariantNumeric: "tabular-nums" }}>· {c.balance > 0 ? `${fmt(c.balance)} due` : "settled"}</span>
                  </span>
                ))}
              </div>
            )}

            <div style={{ border: "1px solid #EFEDE7", borderRadius: 10, overflow: "hidden" }}>
              {data.rows.map((r) => (
                <div key={r.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "11px 14px", borderBottom: "1px solid #F1EFE9" }}>
                  <Pill tone={KIND_TONE[r.kind] ?? "neutral"}>{r.kind}</Pill>
                  <span style={{ flex: "1 1 180px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>
                      {r.studentName}
                      {r.voucherPeriod ? ` · ${periodLabel(r.voucherPeriod)}` : ""}
                      {r.method ? ` · ${r.method}` : ""}
                    </span>
                    <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>
                      {new Date(r.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                      {r.reason ? ` · ${r.reason}` : ""}
                      {r.receiptNumber ? ` · ${r.receiptNumber}` : ""}
                    </span>
                  </span>
                  <span style={{ fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: r.amount > 0 ? "#0B7A4B" : "#0D0D0D" }}>
                    {r.amount > 0 ? "+" : "−"}
                    {fmt(Math.abs(r.amount))}
                  </span>
                  {r.receiptNumber && (
                    <button
                      type="button"
                      onClick={() => setReceipt({ receiptNumber: r.receiptNumber!, amount: r.amount, method: r.method, createdAt: r.createdAt, studentName: r.studentName, voucherPeriod: r.voucherPeriod, guardianName: data.guardian.name })}
                      style={{ height: 28, padding: "0 10px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 7, fontSize: "0.6875rem", fontWeight: 500, cursor: "pointer" }}
                    >
                      Receipt
                    </button>
                  )}
                </div>
              ))}
              {data.rows.length === 0 && <div style={{ padding: "28px 14px", textAlign: "center", fontSize: "0.8125rem", color: "#A8A39A" }}>No ledger activity for this family yet.</div>}
            </div>
            <p style={{ margin: 0, fontSize: "0.6875rem", lineHeight: 1.5, color: "#A8A39A" }}>Every balance on this page is computed from these rows. Nothing here is ever edited — corrections are posted as adjustments from the voucher.</p>
          </div>
        )}
      </Modal>
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}
