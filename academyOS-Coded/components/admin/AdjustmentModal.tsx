"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fmt } from "@/lib/format";
import Modal from "@/components/ui/Modal";
import Pill from "@/components/ui/Pill";
import { friendlyError } from "@/lib/errors";

type Kind = "discount" | "adjustment";
type Direction = "credit" | "charge";

const inputStyle: React.CSSProperties = {
  height: 40,
  padding: "0 12px",
  background: "#FFFFFF",
  border: "1px solid #DDD9D0",
  borderRadius: 8,
  fontSize: "0.8125rem",
  width: "100%",
};

const labelStyle: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 500, color: "#4A463F", display: "block", marginBottom: 6 };

/**
 * Posts a correction against one voucher (§8.3, §15 Rule 1). Money is never
 * edited — this appends a ledger row with a reason, and the balance every
 * screen shows is recomputed from it. The mid-month "review the first
 * voucher" flag clears when one is posted, since that is what the review is.
 */
export default function AdjustmentModal({
  voucherId,
  onClose,
  onPosted,
}: {
  voucherId: Id<"vouchers">;
  onClose: () => void;
  onPosted: (msg: string) => void;
}) {
  const voucher = useQuery(api.vouchers.get, { voucherId });
  const postAdjustment = useMutation(api.ledger.postAdjustment);

  const [kind, setKind] = useState<Kind>("adjustment");
  const [direction, setDirection] = useState<Direction>("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const numeric = Number(amount) || 0;
  const effectiveDirection: Direction = kind === "discount" ? "credit" : direction;
  const signed = effectiveDirection === "credit" ? numeric : -numeric;
  const outstanding = voucher?.outstanding ?? 0;
  const after = Math.max(0, outstanding - signed);
  const tooMuch = effectiveDirection === "credit" && numeric > outstanding;
  const valid = numeric > 0 && reason.trim().length > 0 && !tooMuch;

  async function onSubmit() {
    if (!valid) {
      setError(tooMuch ? `A credit can't exceed the ${fmt(outstanding)} outstanding.` : "Enter an amount and a reason.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await postAdjustment({ voucherId, amount: signed, kind, reason: reason.trim() });
      onPosted(`${kind === "discount" ? "Discount" : "Adjustment"} posted · ${result.outstanding > 0 ? `${fmt(result.outstanding)} still due` : "voucher settled"}`);
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Could not post the adjustment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Post an adjustment" onClose={onClose} width={460}>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        {voucher && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 14px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 9 }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>{voucher.student}</span>
              <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>{voucher.period} · {voucher.guardian}</span>
            </span>
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <Pill tone={voucher.status}>{voucher.status}</Pill>
              <span style={{ fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(outstanding)} due</span>
            </span>
          </div>
        )}

        <div>
          <label style={labelStyle}>Type</label>
          <div style={{ display: "flex", gap: 6 }}>
            {(
              [
                ["adjustment", "Adjustment", "Correction, proration, goodwill"],
                ["discount", "Discount", "Always reduces the balance"],
              ] as [Kind, string, string][]
            ).map(([value, title, hint]) => {
              const on = kind === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  aria-pressed={on}
                  style={{ flex: 1, padding: "10px 12px", textAlign: "left", background: on ? "#0D0D0D" : "#FFFFFF", color: on ? "#F7F6F3" : "#0D0D0D", border: `1px solid ${on ? "#0D0D0D" : "#DDD9D0"}`, borderRadius: 8, cursor: "pointer" }}
                >
                  <span style={{ display: "block", fontSize: "0.8125rem", fontWeight: 700 }}>{title}</span>
                  <span style={{ display: "block", marginTop: 2, fontSize: "0.6875rem", color: on ? "#B9B4AB" : "#8A857C" }}>{hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {kind === "adjustment" && (
          <div>
            <label style={labelStyle}>Direction</label>
            <div style={{ display: "flex", gap: 3, padding: 3, background: "#F4F2EC", borderRadius: 8 }}>
              {(
                [
                  ["credit", "Reduce what they owe"],
                  ["charge", "Add a charge"],
                ] as [Direction, string][]
              ).map(([value, title]) => {
                const on = direction === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDirection(value)}
                    aria-pressed={on}
                    style={{ flex: 1, height: 34, border: 0, borderRadius: 6, cursor: "pointer", background: on ? "#FFFFFF" : "transparent", color: on ? "#0D0D0D" : "#8A857C", fontSize: "0.75rem", fontWeight: on ? 700 : 500, boxShadow: on ? "0 1px 2px rgba(13,13,13,0.12)" : "none" }}
                  >
                    {title}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="adj-amount">Amount (PKR)</label>
            <input id="adj-amount" style={{ ...inputStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }} inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9]/g, "")); setError(""); }} placeholder="0" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="adj-reason">Reason (required, shown on the statement)</label>
            <input id="adj-reason" style={inputStyle} value={reason} onChange={(e) => { setReason(e.target.value); setError(""); }} placeholder={kind === "discount" ? "Hardship concession — agreed with owner" : "Joined on the 18th — half month"} />
          </div>
        </div>

        {voucher && numeric > 0 && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "11px 14px", background: tooMuch ? "#FDECEC" : "#F1F7F3", border: `1px solid ${tooMuch ? "#F6CFCC" : "#D3E7DC"}`, borderRadius: 9, fontSize: "0.8125rem", color: tooMuch ? "#B4231F" : "#0B7A4B" }}>
            {tooMuch ? (
              <span>That credit exceeds what&apos;s outstanding.</span>
            ) : (
              <>
                <span>After posting:</span>
                <span style={{ marginLeft: "auto", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{after > 0 ? `${fmt(after)} due` : "settled"}</span>
              </>
            )}
          </div>
        )}

        {error && <div role="alert" style={{ fontSize: "0.75rem", color: "#B4231F" }}>{error}</div>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ flex: "1 1 100px", height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !valid}
            style={{ flex: "1 1 150px", height: 42, background: busy || !valid ? "#EDEBE4" : "#0D0D0D", color: busy || !valid ? "#A8A39A" : "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: busy || !valid ? "not-allowed" : "pointer" }}
          >
            {busy ? "Posting…" : "Post to ledger"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
