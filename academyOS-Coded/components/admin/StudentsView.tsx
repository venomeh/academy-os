"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fmt, initials } from "@/lib/format";
import Pill from "@/components/ui/Pill";
import StudentAvatar from "@/components/ui/StudentAvatar";
import EnrollStudentModal from "@/components/admin/EnrollStudentModal";
import type { Tone } from "@/lib/format";

const FILTERS = ["All", "Owing", "Paid up", "Siblings", "Left"] as const;
type Filter = (typeof FILTERS)[number];

export default function StudentsView({
  query,
  onOpenStudent,
  flash,
}: {
  query: string;
  onOpenStudent: (id: Id<"students">) => void;
  flash: (msg: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("All");
  const [showEnroll, setShowEnroll] = useState(false);
  const rows = useQuery(api.students.listForAdmin, { query, filter });
  const photoUrls = useQuery(api.files.getPhotoUrls, rows ? { studentIds: rows.map((r) => r.id) } : "skip");

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 14 }}>
        {FILTERS.map((f) => {
          const on = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{ height: 34, padding: "0 13px", background: on ? "#0D0D0D" : "#FFFFFF", color: on ? "#F7F6F3" : "#4A463F", border: `1px solid ${on ? "#0D0D0D" : "#DDD9D0"}`, borderRadius: 8, fontSize: "0.8125rem", fontWeight: on ? 700 : 500, cursor: "pointer" }}
            >
              {f}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#8A857C" }}>{rows?.length ?? 0} shown</span>
        <button
          type="button"
          onClick={() => setShowEnroll(true)}
          style={{ height: 34, padding: "0 14px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 8, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
        >
          Enroll student
        </button>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Student", "Guardian", "Batch", "Attendance", "", "Status"].map((h, i) => (
                  <th
                    key={h + i}
                    scope="col"
                    style={{ padding: "11px 18px", textAlign: i === 4 ? "right" : "left", background: "#FAF9F6", borderBottom: "1px solid #E8E5DE", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}
                  >
                    {i === 4 ? "Balance" : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((s) => (
                <tr key={s.id} onClick={() => onOpenStudent(s.id)} style={{ cursor: "pointer" }}>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <StudentAvatar photoUrl={photoUrls?.[s.id]} initials={initials(s.name)} tone={s.balance > 0 ? "#FFE9E1" : "#EDEBE4"} />
                      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: "0.875rem", fontWeight: 700, letterSpacing: "-0.01em" }}>{s.name}</span>
                        <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>Grade {s.grade ?? "—"} · joined {new Date(s.joinedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                      </span>
                    </span>
                  </td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9", fontSize: "0.8125rem" }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span>{s.guardian}</span>
                      <span style={{ fontSize: "0.6875rem", color: s.siblingCount > 1 ? "#8A5B0B" : "#A8A39A" }}>
                        {s.siblingCount > 1 ? `${s.siblingCount} children · sibling discount` : "single child"}
                      </span>
                    </span>
                  </td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9", fontSize: "0.8125rem" }}>{s.batches.join(", ") || "Unassigned"}</td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9", fontSize: "0.8125rem", fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 42, height: 5, background: "#F1EFE9", borderRadius: 9999, overflow: "hidden", display: "block" }}>
                        <span style={{ display: "block", height: "100%", width: `${s.attendancePct}%`, background: s.attendancePct >= 85 ? "#0B7A4B" : s.attendancePct >= 70 ? "#C99A2E" : "#B4231F", borderRadius: 9999 }} />
                      </span>
                      {s.attendancePct}%
                    </span>
                  </td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9", textAlign: "right", fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {s.balance > 0 ? fmt(s.balance) : "—"}
                  </td>
                  <td style={{ padding: "13px 18px", borderBottom: "1px solid #F1EFE9" }}>
                    <Pill tone={s.status as Tone}>{s.status}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && rows.length === 0 && (
          <div style={{ padding: "56px 20px", textAlign: "center" }}>
            <div style={{ fontSize: "0.9375rem", fontWeight: 700 }}>No students match that.</div>
            <p style={{ margin: "8px 0 0", fontSize: "0.8125rem", color: "#8A857C" }}>Try a different filter or clear the search.</p>
          </div>
        )}
      </div>

      {showEnroll && <EnrollStudentModal onClose={() => setShowEnroll(false)} flash={flash} />}
    </div>
  );
}
