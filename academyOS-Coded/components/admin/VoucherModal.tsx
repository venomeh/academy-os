"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fmt } from "@/lib/format";
import type { Tone } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Pill from "@/components/ui/Pill";

const KIND_TONE: Record<string, Tone> = { payment: "paid", fine: "unpaid", discount: "partial", adjustment: "neutral", voucher: "neutral" };

function entryLabel(e: { kind: string; method: string | null; reason: string | null; receiptNumber: string | null }): string {
  if (e.kind === "voucher") return "Voucher issued";
  if (e.kind === "payment") return `${e.method === "stripe" ? "Card" : "Cash"} payment${e.receiptNumber ? ` · ${e.receiptNumber}` : ""}`;
  if (e.kind === "fine") return "Late fine accrued";
  if (e.kind === "discount") return `Discount · ${e.reason ?? ""}`;
  return `Adjustment · ${e.reason ?? ""}`;
}

export default function VoucherModal({
  voucherId,
  onClose,
  onPay,
  onAdjust,
  flash,
}: {
  voucherId: Id<"vouchers">;
  onClose: () => void;
  onPay: (voucherId: Id<"vouchers">) => void;
  onAdjust: (voucherId: Id<"vouchers">) => void;
  flash: (msg: string) => void;
}) {
  const voucher = useQuery(api.vouchers.get, { voucherId });
  const [copied, setCopied] = useState(false);

  const sibLine = voucher?.lineItems.find((l) => l.label.toLowerCase().includes("sibling"));
  const fineEntry = voucher?.entries.find((e) => e.kind === "fine");
  // Everything that happened after issue — payments, fines, corrections.
  const activity = (voucher?.entries ?? []).filter((e) => e.kind !== "voucher");

  return (
    <Modal title="Voucher detail" onClose={onClose}>
      {voucher && (
        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>{voucher.period}</span>
            <Pill tone={voucher.status}>{voucher.status}</Pill>
            <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#8A857C" }}>Due {voucher.dueDate}</span>
          </div>
          <div style={{ marginTop: 14, fontSize: "1.125rem", fontWeight: 900, letterSpacing: "-0.03em" }}>{voucher.student}</div>
          <div style={{ marginTop: 3, fontSize: "0.8125rem", color: "#6B6660" }}>{voucher.guardian}</div>

          <div style={{ marginTop: 18, border: "1px solid #EFEDE7", borderRadius: 10, overflow: "hidden" }}>
            {voucher.lineItems.map((l, i) => (
              <div key={`${l.label}-${i}`} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "12px 15px", borderBottom: "1px solid #F1EFE9" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{l.label}</span>
                  {l.note && <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{l.note}</span>}
                </span>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{l.amount < 0 ? "−" : ""}{fmt(l.amount)}</span>
              </div>
            ))}
            {fineEntry && (
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "12px 15px", borderBottom: "1px solid #F1EFE9" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>Late fine</span>
                  <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>Accrued after the due date, per the snapshotted rule</span>
                </span>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(fineEntry.amount)}</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "14px 15px", background: "#FAF9F6" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>Total</span>
              <span style={{ fontSize: "1.25rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{fmt(voucher.total)}</span>
            </div>
          </div>

          <div style={{ marginTop: 12, border: "1px solid #EFEDE7", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "9px 15px", background: "#FAF9F6", borderBottom: "1px solid #EFEDE7", fontSize: "0.625rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Ledger activity</div>
            {activity.map((e) => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", borderBottom: "1px solid #F1EFE9" }}>
                <Pill tone={KIND_TONE[e.kind] ?? "neutral"}>{e.kind}</Pill>
                <span style={{ minWidth: 0, flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: "0.8125rem" }}>{entryLabel(e)}</span>
                  <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{new Date(e.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}</span>
                </span>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: e.amount > 0 ? "#0B7A4B" : "#0D0D0D" }}>
                  {e.amount > 0 ? "+" : "−"}
                  {fmt(Math.abs(e.amount))}
                </span>
              </div>
            ))}
            {activity.length === 0 && <div style={{ padding: "14px 15px", fontSize: "0.75rem", color: "#A8A39A" }}>No payments, fines or adjustments yet.</div>}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "12px 15px", background: voucher.outstanding > 0 ? "#FFFFFF" : "#F1F7F3" }}>
              <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: voucher.outstanding > 0 ? "#0D0D0D" : "#0B7A4B" }}>{voucher.outstanding > 0 ? "Outstanding" : "Settled"}</span>
              <span style={{ fontSize: "1rem", fontWeight: 900, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: voucher.outstanding > 0 ? "#0D0D0D" : "#0B7A4B" }}>{fmt(voucher.outstanding)}</span>
            </div>
          </div>

          <p style={{ margin: "14px 0 0", fontSize: "0.75rem", lineHeight: 1.55, color: "#8A857C" }}>
            Snapshotted rules: sibling discount {sibLine ? "applied" : "n/a"} · late fine {fineEntry ? "accrued" : "not yet"}. Balance is computed from the ledger rows above; the pay link token resolves server-side.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
            <button
              type="button"
              onClick={() => {
                const url = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? ""}/pay/${voucher.token}`;
                if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
                setCopied(true);
                flash("Pay link copied · token resolves server-side");
              }}
              style={{ flex: "1 1 130px", height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
            >
              {copied ? "Link copied" : "Copy pay link"}
            </button>
            <button
              type="button"
              onClick={() => onAdjust(voucher.id)}
              style={{ flex: "1 1 130px", height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
            >
              Post adjustment
            </button>
            <button
              type="button"
              onClick={() => onPay(voucher.id)}
              disabled={voucher.status === "paid"}
              style={{ flex: "1 1 150px", height: 42, background: voucher.status === "paid" ? "#FAF9F6" : "#0D0D0D", color: voucher.status === "paid" ? "#A8A39A" : "#F7F6F3", border: voucher.status === "paid" ? "1px solid #EFEDE7" : "0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: voucher.status === "paid" ? "not-allowed" : "pointer" }}
            >
              Record cash payment
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
