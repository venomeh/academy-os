"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Child } from "@/components/parent/ParentApp";

export default function ResultsView({ child }: { child: Child }) {
  const results = useQuery(api.assessments.getPublishedResults, { studentId: child.id });

  if (!results) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "dashFadeIn 240ms ease-out both" }}>
      {results.map((r) => {
        const scorePct = Math.round((r.score / r.maxMarks) * 100);
        const avgPct = Math.round((r.average / r.maxMarks) * 100);
        const above = r.score >= r.average;
        return (
          <div key={`${r.subject}-${r.date}`} style={{ padding: "19px 20px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", animation: "dashRiseIn 340ms ease-out both" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{r.subject}</span>
              <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>
                {new Date(`${r.date}T12:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
              </span>
              <span style={{ marginLeft: "auto", fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums" }}>
                {r.score}/{r.maxMarks}
              </span>
            </div>
            <div style={{ position: "relative", height: 30, marginTop: 16 }}>
              <span style={{ position: "absolute", inset: "11px 0 auto", height: 8, background: "#F1EFE9", borderRadius: 9999, display: "block" }} />
              <span
                style={{
                  position: "absolute",
                  top: 11,
                  left: 0,
                  height: 8,
                  width: `${scorePct}%`,
                  background: "#0D0D0D",
                  borderRadius: 9999,
                  display: "block",
                  transition: "width 600ms cubic-bezier(0.16,1,0.3,1)",
                }}
              />
              <span style={{ position: "absolute", top: 4, left: `${avgPct}%`, width: 2, height: 22, background: "#FF4E18", display: "block" }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12, fontSize: "0.75rem", color: "#4A463F" }}>
              <span>
                Your child {r.score}/{r.maxMarks}
              </span>
              <span style={{ color: "#8A857C" }}>Batch average {r.average}/{r.maxMarks}</span>
              <span style={{ marginLeft: "auto", fontWeight: 700, color: above ? "#0B7A4B" : "#B4231F" }}>
                {above ? "+" : ""}
                {r.score - r.average} vs batch
              </span>
            </div>
          </div>
        );
      })}
      {results.length === 0 && (
        <div style={{ padding: "40px 20px", textAlign: "center", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, color: "#8A857C", fontSize: "0.875rem" }}>
          No published results yet for {child.name}.
        </div>
      )}
      <div style={{ padding: "15px 18px", background: "#FAF9F6", border: "1px dashed #DDD9D0", borderRadius: 12, fontSize: "0.8125rem", lineHeight: 1.55, color: "#6B6660" }}>
        Only published tests appear here. Unpublished drafts stay with the teacher.
      </div>
    </div>
  );
}
