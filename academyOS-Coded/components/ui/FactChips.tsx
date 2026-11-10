/**
 * The numbers a remark draft was grounded in (§9), shown beside the text in
 * both review queues so the reviewer checks every figure against its
 * source instead of trusting the model.
 */
export interface RemarkFacts {
  attendancePct: number | null;
  presentDays: number | null;
  totalDays: number | null;
  tests: { subject: string; pct: number; obtained: number; maxMarks: number; batchAveragePct: number | null }[];
  avgPct: number | null;
  previousAvgPct: number | null;
  trend: string | null;
}

export default function FactChips({ facts }: { facts: RemarkFacts }) {
  const chips: string[] = [];
  if (facts.attendancePct !== null && facts.totalDays) chips.push(`Attendance ${facts.attendancePct}% · ${facts.presentDays}/${facts.totalDays} days`);
  for (const t of facts.tests.slice(0, 4)) chips.push(`${t.subject} ${t.obtained}/${t.maxMarks} (${t.pct}%${t.batchAveragePct !== null ? ` vs batch ${t.batchAveragePct}%` : ""})`);
  if (facts.tests.length > 4) chips.push(`+${facts.tests.length - 4} more tests`);
  if (facts.avgPct !== null && facts.previousAvgPct !== null) chips.push(`${facts.trend ?? "vs last month"} · ${facts.previousAvgPct}% → ${facts.avgPct}%`);
  if (chips.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 14 }}>
      <span style={{ fontSize: "0.625rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#A8A39A", marginRight: 2 }}>Grounded in</span>
      {chips.map((c) => (
        <span key={c} style={{ padding: "4px 9px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, color: "#4A463F", fontVariantNumeric: "tabular-nums" }}>
          {c}
        </span>
      ))}
    </div>
  );
}
