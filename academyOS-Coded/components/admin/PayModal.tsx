"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fmt } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Pill from "@/components/ui/Pill";

export default function PayModal({
  voucherId,
  onClose,
  onPaid,
}: {
  voucherId: Id<"vouchers">;
  onClose: () => void;
  onPaid: () => void;
}) {
  const voucher = useQuery(api.vouchers.get, { voucherId });
  const recordCashPayment = useMutation(api.vouchers.recordCashPayment);
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (voucher) setAmount(fmt(voucher.outstanding));
  }, [voucher?.id]);

  if (!voucher) return <Modal title="Record cash payment" onClose={onClose}><div style={{ padding: 20 }} /></Modal>;

  const numeric = Number(amount.replace(/[^0-9]/g, ""));
  const invalid = touched && (!numeric || numeric > voucher.outstanding);
  const remaining = Math.max(0, voucher.outstanding - (numeric || 0));
  const resultStatus = !numeric || numeric > voucher.outstanding ? null : remaining === 0 ? "paid" : "partial";

  async function onConfirm() {
    setTouched(true);
    if (!numeric || numeric > voucher!.outstanding) return;
    setBusy(true);
    setError("");
    try {
      await recordCashPayment({ voucherId: voucher!.id, amount: numeric });
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not record the payment.");
      return;
    }
    setBusy(false);
    onPaid();
    onClose();
  }

  return (
    <Modal title="Record cash payment" onClose={onClose}>
      <div style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "14px 15px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 10 }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>{voucher.student}</span>
            <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>{voucher.period} · outstanding</span>
          </span>
          <span style={{ fontSize: "1.25rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{fmt(voucher.outstanding)}</span>
        </div>

        <label htmlFor="amount" style={{ display: "block", margin: "18px 0 7px", fontSize: "0.8125rem", fontWeight: 500, color: "#4A463F" }}>
          Amount received
        </label>
        <input
          id="amount"
          type="text"
          inputMode="numeric"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setTouched(true);
          }}
          aria-invalid={invalid}
          style={{ width: "100%", height: 46, padding: "0 14px", background: "#FFFFFF", border: `1px solid ${invalid ? "#E0645E" : "#DDD9D0"}`, borderRadius: 9, fontSize: "1.125rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
          {[
            { label: `Full ${fmt(voucher.outstanding)}`, value: fmt(voucher.outstanding) },
            { label: `Half ${fmt(Math.round(voucher.outstanding / 2))}`, value: fmt(Math.round(voucher.outstanding / 2)) },
            { label: "1,000", value: "1,000" },
          ].map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setAmount(p.value);
                setTouched(true);
              }}
              style={{ padding: "7px 11px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 7, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {invalid && (
          <div role="alert" style={{ marginTop: 11, padding: "11px 13px", background: "#FDECEC", border: "1px solid #F6CFCC", borderRadius: 8, fontSize: "0.8125rem", lineHeight: 1.45, color: "#8E1C18" }}>
            {!numeric ? "Enter an amount." : `Overpayment is blocked — the maximum is ${fmt(voucher.outstanding)}.`}
          </div>
        )}
        {error && (
          <div role="alert" style={{ marginTop: 11, padding: "11px 13px", background: "#FDECEC", border: "1px solid #F6CFCC", borderRadius: 8, fontSize: "0.8125rem", lineHeight: 1.45, color: "#8E1C18" }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 16, padding: "14px 15px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.8125rem" }}>
            <span style={{ color: "#6B6660" }}>Resulting status</span>
            {resultStatus ? <Pill tone={resultStatus}>{resultStatus}</Pill> : <span style={{ color: "#A8A39A" }}>—</span>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10, fontSize: "0.8125rem" }}>
            <span style={{ color: "#6B6660" }}>Remaining after payment</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(remaining)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={{ flex: "1 1 130px", height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{ flex: "1 1 150px", height: 42, background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: busy ? "progress" : "pointer", opacity: busy ? 0.8 : 1 }}
          >
            {busy ? "Posting…" : "Post to ledger"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
