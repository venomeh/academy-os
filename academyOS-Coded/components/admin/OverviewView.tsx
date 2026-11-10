"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { fmt } from "@/lib/format";
import Pill from "@/components/ui/Pill";
import type { ViewKey } from "@/components/admin/nav";
import { BUCKET_LABEL, type AgingBucketKey } from "@/components/admin/types";

const CURRENT_PERIOD = new Date().toISOString().slice(0, 7);

export default function OverviewView({
  onGoDefaulters,
  onGoView,
}: {
  onGoDefaulters: (bucket?: AgingBucketKey) => void;
  onGoView: (v: ViewKey) => void;
}) {
  const collectedToday = useQuery(api.ledger.getTodayCollections);
  const aging = useQuery(api.ledger.getAgingBuckets);
  const today = useQuery(api.attendance.getTodayOverview);
  const activeStudents = useQuery(api.students.countActive);
  const voucherStats = useQuery(api.vouchers.getStats, { period: CURRENT_PERIOD });
  const feed = useQuery(api.ledger.listEntries, { limit: 8 });

  const outstanding = aging?.reduce((s, a) => s + a.amount, 0) ?? 0;
  const agingMax = Math.max(1, ...(aging?.map((a) => a.amount) ?? [1]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, animation: "dashFadeIn 260ms ease-out both" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
        {[
          { label: "Collected today", value: collectedToday ? fmt(collectedToday.total) : "—", note: "so far today", live: true },
          { label: "Outstanding", value: aging ? fmt(outstanding) : "—", note: "across 4 buckets", live: false },
          { label: "Attendance marked", value: today ? `${today.markedCount}/${today.totalBatches}` : "—", note: "batches today", live: true },
          { label: "Active students", value: activeStudents !== undefined ? String(activeStudents) : "—", note: "across every batch", live: false },
        ].map((m) => (
          <div key={m.label} style={{ position: "relative", padding: "17px 18px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", animation: "dashRiseIn 380ms cubic-bezier(0.16,1,0.3,1) both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>{m.label}</span>
              {m.live && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: "#3ECF8E", display: "block", animation: "dashPulseDot 2s ease-in-out infinite" }} />}
            </div>
            <div style={{ marginTop: 12, fontSize: "1.875rem", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{m.value}</div>
            <div style={{ marginTop: 11, fontSize: "0.75rem", color: "#8A857C" }}>{m.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <div style={{ gridColumn: "span 2", minWidth: 0, padding: 20, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>This period</h2>
            <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>{CURRENT_PERIOD}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 18, marginTop: 22 }}>
            {[
              { label: "Issued", value: voucherStats ? String(voucherStats.issued) : "—" },
              { label: "Collected", value: voucherStats ? fmt(voucherStats.collected) : "—" },
              { label: "Outstanding", value: voucherStats ? fmt(voucherStats.outstanding) : "—" },
              { label: "Collection rate", value: voucherStats ? `${voucherStats.rate}%` : "—" },
            ].map((s) => (
              <div key={s.label}>
                <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>{s.label}</div>
                <div style={{ marginTop: 8, fontSize: "1.625rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ minWidth: 0, padding: 20, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Live activity</h2>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: "#3ECF8E", display: "block", animation: "dashPulseDot 2s ease-in-out infinite" }} />
            <span style={{ marginLeft: "auto", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>Realtime</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 6, maxHeight: 292, overflowY: "auto" }}>
            {(feed ?? []).map((f) => {
              const icon = f.kind === "payment" ? (f.method === "stripe" ? "S" : "₨") : f.kind === "voucher" ? "V" : f.kind === "fine" ? "!" : f.kind === "discount" ? "%" : "?";
              const money = f.kind === "payment";
              const label = f.kind === "payment" ? `${f.method === "stripe" ? "Stripe" : "Cash"} payment · ${f.student}` : f.kind === "voucher" ? `Voucher issued · ${f.student}` : f.kind === "fine" ? `Late fine · ${f.student}` : `${f.kind} · ${f.student}`;
              return (
                <div key={f.id} style={{ display: "flex", gap: 11, padding: "13px 0", borderBottom: "1px solid #F1EFE9", animation: "dashRiseIn 320ms ease-out both" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 26, height: 26, flex: "none", borderRadius: 7,
                      background: money ? "#F1F7F3" : "#FAF9F6",
                      border: `1px solid ${money ? "#D3E7DC" : "#EFEDE7"}`,
                      color: money ? "#0B7A4B" : "#6B6660",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700,
                    }}
                  >
                    {icon}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 3 }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 500, lineHeight: 1.35 }}>{label}</span>
                    <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{new Date(f.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                  </span>
                  {money && (
                    <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: "0.8125rem", fontWeight: 700, color: "#0B7A4B", fontVariantNumeric: "tabular-nums" }}>+{fmt(f.amount)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <div style={{ minWidth: 0, padding: 20, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Outstanding by age</h2>
            <button type="button" onClick={() => onGoDefaulters()} style={{ marginLeft: "auto", background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: "0.8125rem", fontWeight: 500, color: "#6B6660" }}>
              Defaulter list →
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
            {(aging ?? []).map((a) => (
              <button
                key={a.bucket}
                type="button"
                onClick={() => onGoDefaulters(a.bucket)}
                style={{ display: "block", width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.8125rem" }}>
                  <span style={{ fontWeight: 500 }}>{BUCKET_LABEL[a.bucket]}</span>
                  <span style={{ color: "#8A857C", fontVariantNumeric: "tabular-nums" }}>{fmt(a.amount)} · {a.families}</span>
                </div>
                <div style={{ height: 8, marginTop: 8, background: "#F1EFE9", borderRadius: 9999, overflow: "hidden" }}>
                  <span
                    style={{
                      display: "block", height: "100%", width: `${Math.round((a.amount / agingMax) * 100)}%`,
                      background: a.bucket === "current" ? "#0D0D0D" : a.bucket === "7d_gentle" ? "#C99A2E" : a.bucket === "14d_firm" ? "#D9791F" : "#B4231F",
                      borderRadius: 9999, transition: "width 600ms cubic-bezier(0.16,1,0.3,1)",
                    }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ minWidth: 0, padding: 20, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Attendance today</h2>
            <button type="button" onClick={() => onGoView("attendance")} style={{ marginLeft: "auto", background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: "0.8125rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {today ? `${today.markedCount}/${today.totalBatches}` : "—"}
            </button>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "#8A857C" }}>
            {today && today.markedCount >= today.totalBatches ? "Every batch marked today." : `${today ? today.totalBatches - today.markedCount : 0} batches still unmarked · cutoff 6:30 pm`}
          </p>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
            {(today?.batches ?? []).map((b) => (
              <div key={b.batchId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: "1px solid #F1EFE9" }}>
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{b.name}</span>
                  <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{b.teacher} · {b.time}</span>
                </span>
                <Pill tone={b.status === "marked" ? "marked" : b.status === "flagged" ? "flagged" : "pending"}>{b.status}</Pill>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
