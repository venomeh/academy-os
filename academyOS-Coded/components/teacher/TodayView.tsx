"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Pill from "@/components/ui/Pill";
import type { View } from "@/components/teacher/TeacherApp";

interface BatchListItem {
  id: Id<"batches">;
  name: string;
  startTime: string | null;
  rosterCount: number;
}

const CUTOFF = "18:30";

export default function TodayView({
  batches,
  goTo,
  remarksPending,
}: {
  batches: BatchListItem[];
  goTo: (view: View, batchId?: Id<"batches">) => void;
  remarksPending: number;
}) {
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div style={{ animation: "dashFadeIn 240ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.035em" }}>{dateLabel}</h1>
        <span style={{ fontSize: "0.8125rem", color: "#8A857C" }}>{remarksPending} remark{remarksPending === 1 ? "" : "s"} to review</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        {batches.map((b) => (
          <BatchCard key={b.id} batch={b} goTo={goTo} />
        ))}
      </div>

      <RemarksTodo remarksPending={remarksPending} goTo={goTo} batches={batches} />
    </div>
  );
}

function BatchCard({ batch, goTo }: { batch: BatchListItem; goTo: (view: View, batchId?: Id<"batches">) => void }) {
  const attendance = useQuery(api.attendance.getForBatch, { batchId: batch.id });
  const latest = useQuery(api.assessments.getLatestForBatch, { batchId: batch.id });
  const grid = useQuery(api.assessments.getMarksGrid, latest ? { assessmentId: latest.id } : "skip");
  const subjects = useQuery(api.assessments.listSubjectsForBatch, { batchId: batch.id });

  if (attendance === undefined) return null;
  const saved = attendance.saved;

  let lastTestAvg: number | null = null;
  if (latest && grid) {
    const scored = grid.rows.filter((r) => !r.absent && r.value.trim() !== "").map((r) => Number(r.value));
    lastTestAvg = scored.length ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length) : null;
  }
  const subjectLabel = subjects?.[0]?.name ?? "—";

  return (
    <div style={{ padding: "19px 20px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", animation: "dashRiseIn 360ms cubic-bezier(0.16,1,0.3,1) both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: "1rem", fontWeight: 900, letterSpacing: "-0.025em" }}>{batch.name}</span>
        <Pill tone={saved ? "marked" : "pending"}>{saved ? "marked" : "pending"}</Pill>
      </div>
      <div style={{ marginTop: 7, fontSize: "0.8125rem", color: "#8A857C" }}>
        {batch.startTime ?? "—"} · {batch.rosterCount} students · {subjectLabel}
      </div>
      <div style={{ display: "flex", gap: 22, marginTop: 17, paddingTop: 15, borderTop: "1px solid #F1EFE9" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: "1.125rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{batch.rosterCount}</span>
          <span style={{ fontSize: "0.6875rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>Roster size</span>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: "1.125rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{lastTestAvg ?? "—"}</span>
          <span style={{ fontSize: "0.6875rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>Last test avg</span>
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 17 }}>
        <button
          type="button"
          onClick={() => goTo("attendance", batch.id)}
          style={{
            flex: "1 1 130px",
            height: 40,
            background: saved ? "#FFFFFF" : "#0D0D0D",
            color: saved ? "#4A463F" : "#F7F6F3",
            border: saved ? "1px solid #DDD9D0" : "0",
            borderRadius: 9,
            fontSize: "0.8125rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {saved ? "View attendance" : "Mark attendance"}
        </button>
        <button
          type="button"
          onClick={() => goTo("marks", batch.id)}
          style={{ flex: "1 1 120px", height: 40, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
        >
          Enter marks
        </button>
      </div>
    </div>
  );
}

function RemarksTodo({
  remarksPending,
  goTo,
  batches,
}: {
  remarksPending: number;
  goTo: (view: View, batchId?: Id<"batches">) => void;
  batches: BatchListItem[];
}) {
  return (
    <div style={{ marginTop: 14, padding: "18px 20px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Needs you this week</h2>
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: "#FF4E18", display: "block" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
        {batches.map((b) => (
          <TodoRow key={b.id} batch={b} goTo={goTo} />
        ))}
        {remarksPending > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "13px 0", borderTop: "1px solid #F1EFE9" }}>
            <Pill tone="pending">Remarks</Pill>
            <span style={{ flex: "1 1 200px", fontSize: "0.875rem", fontWeight: 500 }}>
              {remarksPending} remark{remarksPending === 1 ? "" : "s"} awaiting your approval
            </span>
            <button
              type="button"
              onClick={() => goTo("remarks")}
              style={{ height: 32, padding: "0 13px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}
            >
              Review
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TodoRow({ batch, goTo }: { batch: BatchListItem; goTo: (view: View, batchId?: Id<"batches">) => void }) {
  const attendance = useQuery(api.attendance.getForBatch, { batchId: batch.id });
  const latest = useQuery(api.assessments.getLatestForBatch, { batchId: batch.id });
  const grid = useQuery(api.assessments.getMarksGrid, latest ? { assessmentId: latest.id } : "skip");

  if (!attendance) return null;
  const rows: React.ReactNode[] = [];

  if (!attendance.saved) {
    const cutoffPast = (batch.startTime ?? "") <= CUTOFF;
    rows.push(
      <div key={`att-${batch.id}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "13px 0", borderTop: "1px solid #F1EFE9" }}>
        <Pill tone="flagged">Attendance</Pill>
        <span style={{ flex: "1 1 200px", fontSize: "0.875rem", fontWeight: 500 }}>
          {cutoffPast ? `${batch.name} is unmarked — cutoff is 6:30 pm` : `${batch.name} is unmarked`}
        </span>
        <button type="button" onClick={() => goTo("attendance", batch.id)} style={{ height: 32, padding: "0 13px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
          Mark now
        </button>
      </div>
    );
  }

  if (latest && !latest.published && grid) {
    const scored = grid.rows.some((r) => !r.absent && r.value.trim() !== "");
    if (scored) {
      rows.push(
        <div key={`marks-${batch.id}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "13px 0", borderTop: "1px solid #F1EFE9" }}>
          <Pill tone="flagged">Marks</Pill>
          <span style={{ flex: "1 1 200px", fontSize: "0.875rem", fontWeight: 500 }}>
            {latest.subject} test marks saved as draft, not yet published · {batch.name}
          </span>
          <button type="button" onClick={() => goTo("marks", batch.id)} style={{ height: 32, padding: "0 13px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
            Open grid
          </button>
        </div>
      );
    }
  }

  return <>{rows}</>;
}
