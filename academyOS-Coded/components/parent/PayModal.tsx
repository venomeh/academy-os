"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Modal from "@/components/ui/Modal";
import { fmt } from "@/lib/format";
import type { Child } from "@/components/parent/ParentApp";

function PayRow({ child, onBusyChange }: { child: Child; onBusyChange: (busy: boolean) => void }) {
  const voucher = useQuery(api.vouchers.getCurrentForGuardianChild, { studentId: child.id });
  const createCheckoutSession = useAction(api.stripe.createCheckoutSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (!voucher) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const { url } = await createCheckoutSession({ voucherId: voucher.id });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 15px", borderBottom: "1px solid #F1EFE9" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: "0.8125rem" }}>{child.name}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(child.due)}</span>
          <button
            type="button"
            onClick={pay}
            disabled={busy || voucher === undefined || !voucher}
            style={{
              height: 32,
              padding: "0 14px",
              background: "#0D0D0D",
              color: "#F7F6F3",
              border: 0,
              borderRadius: 8,
              fontSize: "0.75rem",
              fontWeight: 700,
              cursor: busy || !voucher ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Opening…" : "Pay"}
          </button>
        </span>
      </div>
      {error && <span style={{ fontSize: "0.6875rem", color: "#B4231F" }}>{error}</span>}
    </div>
  );
}

export default function PayModal({
  children,
  familyTotal,
  onClose,
}: {
  children: Child[];
  familyTotal: number;
  onClose: () => void;
}) {
  const [anyBusy, setAnyBusy] = useState(false);
  const owing = children.filter((c) => c.due > 0);

  return (
    <Modal title="Pay with card" onClose={onClose}>
      <div style={{ padding: 20 }}>
        <p style={{ margin: "0 0 0", fontSize: "0.8125rem", lineHeight: 1.55, color: "#6B6660" }}>
          You&apos;ll be handed to Stripe Checkout, one child at a time. Card details never touch AcademyOS, and each balance updates only once Stripe confirms.
        </p>
        <div style={{ marginTop: 16, border: "1px solid #EFEDE7", borderRadius: 11, overflow: "hidden" }}>
          {owing.map((c) => (
            <PayRow key={c.id} child={c} onBusyChange={setAnyBusy} />
          ))}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "14px 15px", background: "#FAF9F6" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>Total outstanding</span>
            <span style={{ fontSize: "1.25rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{fmt(familyTotal)}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={anyBusy}
            style={{ flex: "1 1 110px", height: 46, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 10, fontSize: "0.8125rem", fontWeight: 700, cursor: anyBusy ? "not-allowed" : "pointer" }}
          >
            Close
          </button>
        </div>
        <div style={{ marginTop: 12, fontSize: "0.625rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "#A8A39A", textAlign: "center" }}>
          Stripe test mode · card 4242 4242 4242 4242
        </div>
      </div>
    </Modal>
  );
}
