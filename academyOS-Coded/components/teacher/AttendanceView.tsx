"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { initials } from "@/lib/format";
import StudentAvatar from "@/components/ui/StudentAvatar";
import Pill from "@/components/ui/Pill";
import StatusToggle, { type AttendanceStatus } from "@/components/ui/StatusToggle";

interface BatchListItem {
  id: Id<"batches">;
  name: string;
  startTime: string | null;
}

const NOTE: Record<AttendanceStatus, string> = {
  present: "default present",
  absent: "marked absent today",
  late: "arrived late",
  leave: "leave approved",
};

export default function AttendanceView({
  batches,
  activeBatchId,
  setActiveBatchId,
  flash,
}: {
  batches: BatchListItem[];
  activeBatchId: Id<"batches"> | "";
  setActiveBatchId: (id: Id<"batches">) => void;
  flash: (msg: string) => void;
}) {
  const attendance = useQuery(api.attendance.getForBatch, activeBatchId ? { batchId: activeBatchId } : "skip");
  const save = useMutation(api.attendance.save);

  const [rows, setRows] = useState<{ studentId: Id<"students">; name: string; status: AttendanceStatus; corrected: boolean }[]>([]);
  const photoUrls = useQuery(api.files.getPhotoUrls, rows.length ? { studentIds: rows.map((r) => r.studentId) } : "skip");
  const [saving, setSaving] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const loadedFor = useRef<Id<"batches"> | "">("");

  // Load a fresh working copy whenever the batch changes or the server's
  // saved rows change out from under us — but not on every keystroke of
  // our own edits (Convex's live query would otherwise clobber local taps).
  useEffect(() => {
    if (!attendance) return;
    if (loadedFor.current !== activeBatchId) {
      setRows(attendance.rows);
      setStartedAt(null);
      setElapsed(0);
      loadedFor.current = activeBatchId;
    }
  }, [attendance, activeBatchId]);

  useEffect(() => {
    clearInterval(tickRef.current);
    if (!attendance || attendance.saved || startedAt === null) return;
    tickRef.current = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(tickRef.current);
  }, [attendance, startedAt]);

  function touch() {
    setStartedAt((cur) => cur ?? Date.now());
  }

  function setStatus(studentId: Id<"students">, status: AttendanceStatus) {
    touch();
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, status } : r)));
  }

  function allPresent() {
    touch();
    setRows((prev) => prev.map((r) => ({ ...r, status: "present" as AttendanceStatus })));
    flash(`All ${rows.length} students set to present`);
  }

  async function onSave() {
    if (!activeBatchId || !attendance) return;
    setSaving(true);
    try {
      await save({ batchId: activeBatchId, date: attendance.date, rows: rows.map((r) => ({ studentId: r.studentId, status: r.status })) });
      const batch = batches.find((b) => b.id === activeBatchId);
      flash(`${batch?.name ?? "Batch"} attendance saved · admin dashboard updated live`);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Couldn't save attendance.");
    } finally {
      setSaving(false);
    }
  }

  const saved = attendance?.saved ?? false;
  const counts: Record<AttendanceStatus, number> = { present: 0, absent: 0, late: 0, leave: 0 };
  rows.forEach((r) => { counts[r.status] += 1; });

  return (
    <div style={{ animation: "dashFadeIn 240ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <select
          value={activeBatchId}
          onChange={(e) => setActiveBatchId(e.target.value as Id<"batches">)}
          aria-label="Batch"
          style={{ height: 40, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.9375rem", fontWeight: 700, cursor: "pointer" }}
        >
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {b.startTime ?? "—"}
            </option>
          ))}
        </select>
        <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 40, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 9, fontSize: "0.8125rem", color: "#6B6660" }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: "#3ECF8E", display: "block", animation: "dashPulseDot 2s ease-in-out infinite" }} />
          Date locked to today
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "0.75rem", color: "#8A857C", fontVariantNumeric: "tabular-nums" }}>
            {saved ? "saved" : startedAt ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s on this batch` : "tap to start"}
          </span>
          <button
            type="button"
            onClick={allPresent}
            style={{ height: 40, padding: "0 14px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
          >
            Mark all present
          </button>
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        {(["present", "absent", "late", "leave"] as AttendanceStatus[]).map((k) => (
          <div
            key={k}
            style={{
              flex: "1 1 120px",
              display: "flex",
              flexDirection: "column",
              gap: 5,
              padding: "13px 15px",
              background: k === "present" ? "#0D0D0D" : "#FFFFFF",
              color: k === "present" ? "#F7F6F3" : "#0D0D0D",
              border: `1px solid ${k === "present" ? "#0D0D0D" : "#E8E5DE"}`,
              borderRadius: 11,
              boxShadow: "0 1px 2px rgba(13,13,13,0.04)",
            }}
          >
            <span style={{ fontSize: "1.25rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{counts[k]}</span>
            <span style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase" }}>{k}</span>
          </div>
        ))}
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", overflow: "hidden" }}>
        {rows.map((r) => (
          <div key={r.studentId} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: "1px solid #F1EFE9" }}>
            <StudentAvatar photoUrl={photoUrls?.[r.studentId]} initials={initials(r.name)} tone={r.status === "absent" ? "#FDECEC" : r.status === "late" ? "#FFF6E8" : "#EDEBE4"} />
            <span style={{ flex: "1 1 160px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, letterSpacing: "-0.01em" }}>{r.name}</span>
                {r.corrected && <Pill tone="partial">corrected by admin</Pill>}
              </span>
              <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{NOTE[r.status]}</span>
            </span>
            <StatusToggle value={r.status} label={`Attendance for ${r.name}`} onChange={(status) => setStatus(r.studentId, status)} />
          </div>
        ))}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 16 }}>
          <span style={{ flex: "1 1 220px", fontSize: "0.75rem", lineHeight: 1.5, color: "#8A857C" }}>
            {saved ? "Saved. You can edit same-day only — later corrections go through the admin." : "One row per student per date. Saving twice updates the same rows, it never duplicates them."}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 9,
              height: 44,
              padding: "0 20px",
              background: saved ? "#FFFFFF" : "#0D0D0D",
              color: saved ? "#0D0D0D" : "#F7F6F3",
              border: saved ? "1px solid #DDD9D0" : "0",
              borderRadius: 9,
              fontSize: "0.875rem",
              fontWeight: 700,
              cursor: saving ? "progress" : "pointer",
            }}
          >
            {saving && <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 9999, border: "2px solid rgba(247,246,243,0.3)", borderTopColor: "#F7F6F3", display: "block", animation: "dashSpin 700ms linear infinite" }} />}
            <span>{saving ? "Saving…" : saved ? "Update attendance" : "Save attendance"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
