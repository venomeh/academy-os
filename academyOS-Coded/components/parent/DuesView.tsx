"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import ReceiptModal, { type ReceiptData } from "@/components/ui/ReceiptModal";
import { api } from "@/convex/_generated/api";
import { fmt } from "@/lib/format";
import Pill from "@/components/ui/Pill";
import type { Tone } from "@/lib/format";
import type { Child } from "@/components/parent/ParentApp";

type Voucher = NonNullable<FunctionReturnType<typeof api.vouchers.getCurrentForGuardianChild>>;
type StatementRow = FunctionReturnType<typeof api.ledger.listForGuardian>["rows"][number];

const STATUS_TONE: Record<Voucher["status"], Tone> = { unpaid: "unpaid", partial: "partial", paid: "paid" };
const KIND_TONE: Record<string, Tone> = { payment: "paid", fine: "unpaid", discount: "partial", voucher: "neutral", adjustment: "neutral" };

function periodLabel(period: string) {
  return new Date(`${period}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function rowLabel(r: StatementRow) {
  if (r.kind === "voucher") return `${r.voucherPeriod ? periodLabel(r.voucherPeriod) : ""} voucher issued`.trim();
  if (r.kind === "payment") return `${r.method === "cash" ? "Cash" : "Stripe"} payment${r.reason ? " · " + r.reason : ""}`;
  if (r.kind === "fine") return `Late fine · ${r.studentName}`;
  if (r.kind === "discount") return "Sibling discount applied";
  return r.reason ? `Adjustment · ${r.reason}` : "Adjustment";
}

export default function DuesView({
  child,
  onPay,
}: {
  child: Child;
  onPay: () => void;
  flash?: (msg: string) => void;
}) {
  const voucher = useQuery(api.vouchers.getCurrentForGuardianChild, { studentId: child.id });
  const statement = useQuery(api.ledger.listForGuardian);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "dashFadeIn 240ms ease-out both" }}>
      {voucher && (
        <div style={{ padding: "19px 20px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>
              {periodLabel(voucher.period)}
            </span>
            <Pill tone={STATUS_TONE[voucher.status]}>{voucher.status}</Pill>
            <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#8A857C" }}>
              Due {new Date(`${voucher.dueDate}T12:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
          <div style={{ marginTop: 14, fontSize: "1.125rem", fontWeight: 900, letterSpacing: "-0.03em" }}>{child.name}</div>
          <div style={{ marginTop: 3, fontSize: "0.8125rem", color: "#6B6660" }}>{child.batches.join(", ") || "Unassigned"}</div>
          <div style={{ marginTop: 16, border: "1px solid #EFEDE7", borderRadius: 10, overflow: "hidden" }}>
            {voucher.lineItems.map((l, i) => (
              <div key={`${l.label}-${i}`} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "12px 15px", borderBottom: "1px solid #F1EFE9" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{l.label}</span>
                  <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{l.note}</span>
                </span>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {l.amount < 0 ? "−" : ""}
                  {fmt(l.amount)}
                </span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "14px 15px", background: "#FAF9F6" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>Total due</span>
              <span style={{ fontSize: "1.25rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{fmt(voucher.total)}</span>
            </div>
          </div>
          {voucher.status !== "paid" && (
            <button
              type="button"
              onClick={onPay}
              style={{ width: "100%", height: 48, marginTop: 16, background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 10, fontSize: "0.875rem", fontWeight: 700, cursor: "pointer" }}
            >
              Pay this voucher online
            </button>
          )}
        </div>
      )}

      {voucher === null && (
        <div style={{ padding: "40px 20px", textAlign: "center", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, color: "#8A857C", fontSize: "0.875rem" }}>
          No voucher issued for {child.name} this period.
        </div>
      )}

      {statement && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 18px", borderBottom: "1px solid #EFEDE7" }}>
            <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Statement</h2>
            <span style={{ marginLeft: "auto", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>Family</span>
          </div>
          {statement.rows.map((r) => (
            <div key={r.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid #F1EFE9" }}>
              <Pill tone={KIND_TONE[r.kind] ?? "neutral"}>{r.kind}</Pill>
              <span style={{ flex: "1 1 160px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{rowLabel(r)}</span>
                <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>
                  {new Date(r.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </span>
              <span style={{ fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: r.amount > 0 ? "#0B7A4B" : "#0D0D0D" }}>
                {r.amount > 0 ? "+" : "−"}
                {fmt(Math.abs(r.amount))}
              </span>
              <button
                type="button"
                onClick={() => r.receiptNumber && setReceipt({ receiptNumber: r.receiptNumber, amount: r.amount, method: r.method, createdAt: r.createdAt, studentName: r.studentName, voucherPeriod: r.voucherPeriod })}
                disabled={!r.receiptNumber}
                style={{
                  height: 30,
                  padding: "0 11px",
                  background: "#FFFFFF",
                  border: "1px solid #E8E5DE",
                  borderRadius: 7,
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  color: r.receiptNumber ? "#4A463F" : "#C9C4BB",
                  cursor: r.receiptNumber ? "pointer" : "not-allowed",
                  visibility: r.receiptNumber ? "visible" : "hidden",
                }}
              >
                Receipt
              </button>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "15px 18px", background: "#FAF9F6" }}>
            <span style={{ fontSize: "0.8125rem", fontWeight: 700 }}>Running balance</span>
            <span style={{ fontSize: "1rem", fontWeight: 900, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{fmt(statement.runningBalance)}</span>
          </div>
        </div>
      )}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
