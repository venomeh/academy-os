"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Child } from "@/components/parent/ParentApp";

function periodLabel(period: string) {
  return new Date(`${period}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function RemarksView({ child }: { child: Child }) {
  const remarks = useQuery(api.remarks.getApprovedForStudent, { studentId: child.id });

  if (!remarks) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "dashFadeIn 240ms ease-out both" }}>
      {remarks.map((r) => (
        <div key={r.period} style={{ padding: "19px 20px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", animation: "dashRiseIn 340ms ease-out both" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{periodLabel(r.period)}</span>
            <span style={{ marginLeft: "auto", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8A857C" }}>
              {r.language === "ur" ? "اردو" : "English"}
            </span>
          </div>
          <p style={{ margin: "14px 0 0", fontSize: "0.9375rem", lineHeight: 1.65, color: "#2A2723", direction: r.language === "ur" ? "rtl" : "ltr" }}>{r.text}</p>
        </div>
      ))}
      {remarks.length === 0 && (
        <div style={{ padding: "40px 20px", textAlign: "center", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, color: "#8A857C", fontSize: "0.875rem" }}>
          No approved remarks yet for {child.name}.
        </div>
      )}
    </div>
  );
}
