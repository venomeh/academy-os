"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Child } from "@/components/parent/ParentApp";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CURRENT_PERIOD = new Date().toISOString().slice(0, 7);

type DayStatus = "present" | "absent" | "late" | "leave" | "off" | "unmarked";

const TONE: Record<DayStatus, [string, string]> = {
  present: ["#0D0D0D", "#F7F6F3"],
  late: ["#FFF6E8", "#8A5B0B"],
  absent: ["#FDECEC", "#B4231F"],
  leave: ["#FDECEC", "#B4231F"],
  off: ["#F7F6F3", "#C9C4BB"],
  unmarked: ["#FFFFFF", "#C9C4BB"],
};

const LEGEND: { label: string; tone: string }[] = [
  { label: "Present", tone: "#0D0D0D" },
  { label: "Absent", tone: "#FDECEC" },
  { label: "Late", tone: "#FFF6E8" },
  { label: "No class", tone: "#F7F6F3" },
];

export default function AttendanceView({ child }: { child: Child }) {
  const data = useQuery(api.attendance.getCalendar, { studentId: child.id, period: CURRENT_PERIOD });

  if (!data) return null;

  const monthLabel = new Date(`${CURRENT_PERIOD}-01T12:00:00`).toLocaleDateString("en-US", { month: "long" });
  const leadingBlanks = new Date(`${CURRENT_PERIOD}-01T12:00:00`).getDay();
  const offset = (leadingBlanks + 6) % 7; // Monday-first grid

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "dashFadeIn 240ms ease-out both" }}>
      <div style={{ padding: "19px 20px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{monthLabel} attendance</h2>
          <span style={{ marginLeft: "auto", fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums" }}>{data.pct}%</span>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "#8A857C" }}>
          {data.sessionCount} sessions{data.absences ? ` · ${data.absences} ${data.absences === 1 ? "absence" : "absences"}` : " · no absences"}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginTop: 18 }}>
          {WEEKDAYS.map((d) => (
            <span key={d} style={{ textAlign: "center", fontSize: "0.625rem", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A8A39A" }}>
              {d}
            </span>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {data.days.map((d) => {
            const status = d.status as DayStatus;
            const [bg, fg] = TONE[status] ?? TONE.unmarked;
            return (
              <span
                key={d.day}
                title={`${d.day} ${monthLabel} · ${status === "off" ? "no class" : status}`}
                style={{
                  height: 34,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: bg,
                  color: fg,
                  border: status === "off" || status === "unmarked" ? "1px solid #EFEDE7" : "1px solid transparent",
                  borderRadius: 7,
                  fontSize: "0.75rem",
                  fontWeight: status === "present" ? 700 : 500,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {d.day}
              </span>
            );
          })}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 18, paddingTop: 15, borderTop: "1px solid #F1EFE9" }}>
          {LEGEND.map((l) => (
            <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "0.75rem", color: "#4A463F" }}>
              <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: 4, background: l.tone, border: l.tone === "#F7F6F3" ? "1px solid #EFEDE7" : "none", display: "block" }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
