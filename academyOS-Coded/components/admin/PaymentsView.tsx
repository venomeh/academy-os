"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { fmt } from "@/lib/format";
import Pill from "@/components/ui/Pill";
import type { Tone } from "@/lib/format";
import ReceiptModal, { type ReceiptData } from "@/components/ui/ReceiptModal";

function kindTone(kind: string): Tone {
  if (kind === "payment") return "paid";
  if (kind === "fine") return "unpaid";
  if (kind === "discount") return "partial";
  return "pending";
}

export default function PaymentsView() {
  const rows = useQuery(api.ledger.listEntries, { limit: 30 });
  const today = useQuery(api.ledger.getTodayCollections);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
        <div style={{ flex: "1 1 240px", padding: "17px 19px", background: "#0D0D0D", color: "#F7F6F3", borderRadius: 11 }}>
          <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Collected today</div>
          <div style={{ marginTop: 11, fontSize: "1.875rem", fontWeight: 900, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", color: "#FF4E18" }}>{today ? fmt(today.total) : "—"}</div>
          <div style={{ marginTop: 9, fontSize: "0.75rem", color: "#8A857C" }}>{today ? `cash ${fmt(today.cash)} · Stripe ${fmt(today.stripe)} · ${today.receipts} receipts` : ""}</div>
        </div>
        <div style={{ flex: "2 1 420px", padding: "17px 19px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
          <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Ledger integrity</div>
          <p style={{ margin: "11px 0 0", fontSize: "0.875rem", lineHeight: 1.5, color: "#4A463F" }}>
            Entries are append-only. Stripe rows are written by the signature-verified webhook and are idempotent on the Stripe event ID. Corrections post as new adjustments with a reason.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            <span style={{ padding: "5px 10px", background: "#F1F7F3", border: "1px solid #D3E7DC", borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0B7A4B" }}>Webhook verified</span>
            <span style={{ padding: "5px 10px", background: "#F1F7F3", border: "1px solid #D3E7DC", borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0B7A4B" }}>0 replays credited</span>
            <span style={{ padding: "5px 10px", background: "#FAF9F6", border: "1px solid #E8E5DE", borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B6660" }}>Stripe test mode</span>
          </div>
        </div>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 18px", borderBottom: "1px solid #E8E5DE" }}>
          <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Ledger entries</h2>
          <span style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>Append-only</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 800, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Entry", "Kind", "Family / student", "Method", "Amount", "Recorded", ""].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    style={{ padding: "11px 18px", textAlign: i === 4 ? "right" : "left", background: "#FAF9F6", borderBottom: "1px solid #E8E5DE", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((l) => (
                <tr key={l.id}>
                  <td style={{ padding: "12px 18px", borderBottom: "1px solid #F1EFE9", fontSize: "0.75rem", fontFamily: "ui-monospace, Menlo, monospace", color: "#6B6660" }}>{l.id.slice(-8)}</td>
                  <td style={{ padding: "12px 18px", borderBottom: "1px solid #F1EFE9" }}>
                    <Pill tone={kindTone(l.kind)}>{l.kind}</Pill>
                  </td>
                  <td style={{ padding: "12px 18px", borderBottom: "1px solid #F1EFE9", fontSize: "0.8125rem" }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 500 }}>{l.guardian}</span>
                      <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{l.student}{l.voucherPeriod ? ` · ${l.voucherPeriod}` : ""}{l.reason ? ` · ${l.reason}` : ""}{l.receiptNumber ? ` · ${l.receiptNumber}` : ""}</span>
                    </span>
                  </td>
                  <td style={{ padding: "12px 18px", borderBottom: "1px solid #F1EFE9", fontSize: "0.8125rem" }}>{l.method ? l.method[0].toUpperCase() + l.method.slice(1) : "System"}</td>
                  <td style={{ padding: "12px 18px", borderBottom: "1px solid #F1EFE9", textAlign: "right", fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ color: l.amount > 0 ? "#0B7A4B" : "#0D0D0D" }}>{l.amount > 0 ? "+" : "−"}{fmt(l.amount)}</span>
                  </td>
                  <td style={{ padding: "12px 18px", borderBottom: "1px solid #F1EFE9", fontSize: "0.75rem", color: "#8A857C" }}>
                    {new Date(l.createdAt).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                  </td>
                  <td style={{ padding: "8px 18px 8px 0", borderBottom: "1px solid #F1EFE9", textAlign: "right" }}>
                    {l.receiptNumber && (
                      <button
                        type="button"
                        onClick={() => setReceipt({ receiptNumber: l.receiptNumber!, amount: l.amount, method: l.method, createdAt: l.createdAt, studentName: l.student, voucherPeriod: l.voucherPeriod, guardianName: l.guardian })}
                        style={{ height: 28, padding: "0 10px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 7, fontSize: "0.6875rem", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        Receipt
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
