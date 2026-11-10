"use client";

import Modal from "@/components/ui/Modal";
import { fmt } from "@/lib/format";

export interface ReceiptData {
  receiptNumber: string;
  amount: number;
  method: "cash" | "stripe" | null;
  createdAt: number;
  studentName: string;
  voucherPeriod: string | null;
  guardianName?: string | null;
}

function periodLabel(period: string | null) {
  if (!period) return "—";
  return new Date(`${period}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * A printable receipt for one payment row. Rendered from the ledger row
 * itself — there is no separate "receipts" table, the ledger *is* the
 * record (§8.2: receipt number auto-issued on every payment).
 */
export default function ReceiptModal({ receipt, onClose }: { receipt: ReceiptData; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Receipt no.", receipt.receiptNumber],
    ["Student", receipt.studentName],
    ...(receipt.guardianName ? ([["Guardian", receipt.guardianName]] as [string, string][]) : []),
    ["Voucher", periodLabel(receipt.voucherPeriod)],
    ["Method", receipt.method === "stripe" ? "Card · Stripe" : receipt.method === "cash" ? "Cash · front desk" : "—"],
    ["Recorded", new Date(receipt.createdAt).toLocaleString("en-US", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" })],
  ];

  return (
    <Modal title="Payment receipt" onClose={onClose} width={440}>
      <div style={{ padding: 20 }}>
        <div className="receipt-sheet" style={{ padding: "22px 22px 18px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: 4, background: "#FF4E18", display: "block" }} />
            <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: "-0.03em" }}>AcademyOS</span>
            <span style={{ marginLeft: "auto", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Receipt</span>
          </div>
          <div style={{ marginTop: 20, fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Amount received</div>
          <div style={{ marginTop: 6, fontSize: "2.25rem", fontWeight: 900, letterSpacing: "-0.045em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ fontSize: "1rem", fontWeight: 700, color: "#8A857C", marginRight: 6 }}>PKR</span>
            {fmt(receipt.amount)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 14, padding: "10px 0", borderTop: "1px solid #EFEDE7", fontSize: "0.8125rem" }}>
                <span style={{ color: "#8A857C", flex: "0 0 100px" }}>{k}</span>
                <span style={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{v}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: "16px 0 0", fontSize: "0.6875rem", lineHeight: 1.5, color: "#A8A39A" }}>
            Recorded in the append-only ledger. A receipt is never edited — a correction would appear as a separate adjustment entry.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}>
            Close
          </button>
          <button type="button" onClick={() => window.print()} style={{ flex: 1, height: 42, background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}>
            Print
          </button>
        </div>
      </div>
    </Modal>
  );
}
