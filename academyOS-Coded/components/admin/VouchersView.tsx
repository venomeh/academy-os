"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fmt } from "@/lib/format";
import Pill from "@/components/ui/Pill";
import { BUCKET_LABEL, type AgingBucketKey } from "@/components/admin/types";

const TABS = ["All", "Unpaid", "Partial", "Paid"] as const;
type Tab = (typeof TABS)[number];

function lastPeriods(n: number): [string, string][] {
  const out: [string, string][] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    const value = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    out.push([value, label]);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function ageLabel(status: string, age: AgingBucketKey | "current"): string {
  if (status === "paid") return "settled";
  return BUCKET_LABEL[age] ?? "current";
}

export default function VouchersView({
  query,
  onView,
  onPay,
}: {
  query: string;
  onView: (voucherId: Id<"vouchers">) => void;
  onPay: (voucherId: Id<"vouchers">) => void;
}) {
  const [tab, setTab] = useState<Tab>("All");
  const PERIODS = lastPeriods(3);
  const [period, setPeriod] = useState(PERIODS[0][0]);

  const rows = useQuery(api.vouchers.list, { period, query, tab });
  const stats = useQuery(api.vouchers.getStats, { period });

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 3, padding: 3, background: "#EDEBE4", borderRadius: 8 }}>
          {TABS.map((t) => {
            const on = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-selected={on}
                style={{ padding: "6px 13px", border: 0, borderRadius: 6, cursor: "pointer", background: on ? "#FFFFFF" : "transparent", color: on ? "#0D0D0D" : "#6B6660", fontSize: "0.8125rem", fontWeight: on ? 700 : 500, boxShadow: on ? "0 1px 2px rgba(13,13,13,0.10)" : "none" }}
              >
                {t}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>Period</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label="Billing period"
            style={{ height: 34, padding: "0 10px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 500, cursor: "pointer" }}
          >
            {PERIODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 14 }}>
        {[
          { label: "Issued", value: stats ? String(stats.issued) : "—" },
          { label: "Collected", value: stats ? fmt(stats.collected) : "—" },
          { label: "Outstanding", value: stats ? fmt(stats.outstanding) : "—" },
          { label: "Collection rate", value: stats ? `${stats.rate}%` : "—" },
        ].map((v) => (
          <div key={v.label} style={{ padding: "15px 17px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>{v.label}</div>
            <div style={{ marginTop: 10, fontSize: "1.375rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{v.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 780, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Voucher", "Student", "Due", "Total", "Paid", "Status", ""].map((h, i) => (
                  <th
                    key={h + i}
                    scope="col"
                    style={{ padding: "11px 18px", textAlign: i === 3 || i === 4 ? "right" : "left", background: "#FAF9F6", borderBottom: "1px solid #E8E5DE", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((v) => (
                <tr key={v.id}>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9", fontSize: "0.8125rem", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{v.id.slice(-8)}</td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9", fontSize: "0.8125rem" }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontWeight: 700 }}>{v.student}</span>
                      <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{v.guardian}</span>
                    </span>
                  </td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9", fontSize: "0.8125rem" }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span>{new Date(v.dueDate).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}</span>
                      <span style={{ fontSize: "0.6875rem", color: v.status === "paid" ? "#A8A39A" : "#B4231F" }}>{ageLabel(v.status, v.age)}</span>
                    </span>
                  </td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9", textAlign: "right", fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(v.total)}</td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9", textAlign: "right", fontSize: "0.8125rem", color: "#4A463F", fontVariantNumeric: "tabular-nums" }}>{v.paid ? fmt(v.paid) : "—"}</td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9" }}>
                    <Pill tone={v.status}>{v.status}</Pill>
                  </td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9", textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => onView(v.id)}
                        style={{ height: 30, padding: "0 11px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => v.status !== "paid" && onPay(v.id)}
                        disabled={v.status === "paid"}
                        style={{ height: 30, padding: "0 11px", background: v.status === "paid" ? "#FAF9F6" : "#0D0D0D", color: v.status === "paid" ? "#A8A39A" : "#F7F6F3", border: v.status === "paid" ? "1px solid #EFEDE7" : "0", borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: v.status === "paid" ? "not-allowed" : "pointer" }}
                      >
                        Record cash
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && rows.length === 0 && (
          <div style={{ padding: "56px 20px", textAlign: "center" }}>
            <div style={{ fontSize: "0.9375rem", fontWeight: 700 }}>Nothing in this bucket.</div>
            <p style={{ margin: "8px 0 0", fontSize: "0.8125rem", color: "#8A857C" }}>
              {period === PERIODS[0][0] ? "Every voucher for this period is settled." : "No vouchers generated for this period yet."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
