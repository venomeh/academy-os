"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { initials } from "@/lib/format";
import Pill from "@/components/ui/Pill";
import StudentAvatar from "@/components/ui/StudentAvatar";
import StatusToggle, { type AttendanceStatus } from "@/components/ui/StatusToggle";
import { friendlyError } from "@/lib/errors";

const today = () => new Date().toISOString().slice(0, 10);

export default function AttendanceView({ flash }: { flash: (msg: string) => void }) {
  const overview = useQuery(api.attendance.getTodayOverview);

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
        {[
          { label: "Batches marked", value: overview ? `${overview.markedCount} / ${overview.totalBatches}` : "—", note: overview ? (overview.markedCount >= overview.totalBatches ? "Every batch marked today." : `${overview.totalBatches - overview.markedCount} still unmarked`) : "" },
          { label: "Present today", value: overview ? `${overview.presentPct}%` : "—", note: "of students in marked batches" },
          { label: "Flagged after cutoff", value: overview ? String(overview.flagged) : "—", note: "Cutoff 6:00 pm PKT" },
        ].map((v) => (
          <div key={v.label} style={{ flex: "1 1 200px", padding: "17px 19px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
            <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>{v.label}</div>
            <div style={{ marginTop: 11, fontSize: "1.875rem", fontWeight: 900, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums" }}>{v.value}</div>
            <div style={{ marginTop: 9, fontSize: "0.75rem", color: "#8A857C" }}>{v.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        {(overview?.batches ?? []).map((c) => {
          const saved = c.status === "marked";
          // Aggregate-only data: cells are colored by proportion (present
          // first, then absent, then late, remainder neutral), not tied to
          // individual students — the correction panel below is where the
          // per-student view lives.
          const cells: { bg: string; bd: string }[] = [];
          if (saved) {
            for (let i = 0; i < c.present; i++) cells.push({ bg: "#0D0D0D", bd: "transparent" });
            for (let i = 0; i < c.absent; i++) cells.push({ bg: "#FDECEC", bd: "#F6CFCC" });
            for (let i = 0; i < c.late; i++) cells.push({ bg: "#FFF6E8", bd: "#F2E1C4" });
            while (cells.length < c.roster) cells.push({ bg: "#F1EFE9", bd: "transparent" });
          } else {
            for (let i = 0; i < c.roster; i++) cells.push({ bg: "#F1EFE9", bd: "transparent" });
          }
          return (
            <div key={c.batchId} style={{ padding: "17px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", animation: "dashRiseIn 340ms ease-out both" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{c.name}</span>
                <Pill tone={saved ? "marked" : c.status === "flagged" ? "flagged" : "pending"}>{c.status}</Pill>
              </div>
              <div style={{ marginTop: 7, fontSize: "0.75rem", color: "#8A857C" }}>{c.teacher} · {c.time} · {c.roster} students</div>
              <div style={{ display: "flex", gap: 4, marginTop: 15, flexWrap: "wrap" }}>
                {cells.map((tone, i) => (
                  <span key={i} style={{ flex: "1 1 0", minWidth: 14, height: 22, borderRadius: 4, display: "block", background: tone.bg, border: `1px solid ${tone.bd}` }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 15, paddingTop: 13, borderTop: "1px solid #F1EFE9", fontSize: "0.75rem", color: "#4A463F" }}>
                <span>{c.present} present</span>
                <span>{c.absent} absent</span>
                <span>{c.late} late</span>
                <span style={{ marginLeft: "auto", color: "#8A857C" }}>{saved ? "saved today" : "not marked"}</span>
              </div>
            </div>
          );
        })}
      </div>

      <CorrectionPanel flash={flash} />
    </div>
  );
}

/**
 * §6.1: "admin can correct any date (correction logged)". Teachers are
 * locked to today; this is the only place a past date can be changed. The
 * server stamps `correctedBy`/`correctedAt` on any row whose status changes
 * by someone other than the original marker.
 */
function CorrectionPanel({ flash }: { flash: (msg: string) => void }) {
  const batches = useQuery(api.batches.listAllForAdmin);
  const activeBatches = (batches ?? []).filter((b) => b.active);
  const [batchId, setBatchId] = useState<Id<"batches"> | "">("");
  const [date, setDate] = useState(today());
  const attendance = useQuery(api.attendance.getForBatch, batchId ? { batchId, date } : "skip");
  const save = useMutation(api.attendance.save);

  const [rows, setRows] = useState<{ studentId: Id<"students">; name: string; status: AttendanceStatus; corrected: boolean }[]>([]);
  const photoUrls = useQuery(api.files.getPhotoUrls, rows.length ? { studentIds: rows.map((r) => r.studentId) } : "skip");
  const [saving, setSaving] = useState(false);
  const loadedKey = useRef("");

  useEffect(() => {
    if (!batchId && activeBatches[0]) setBatchId(activeBatches[0].id);
  }, [activeBatches, batchId]);

  // Reload the working copy when the batch/date changes or the server's
  // rows change underneath — but not on our own unsaved taps.
  useEffect(() => {
    if (!attendance) return;
    const key = `${batchId}:${attendance.date}:${attendance.saved}`;
    if (loadedKey.current !== key) {
      setRows(attendance.rows);
      loadedKey.current = key;
    }
  }, [attendance, batchId]);

  const original = new Map((attendance?.rows ?? []).map((r) => [r.studentId, r.status]));
  const changed = rows.filter((r) => original.get(r.studentId) !== r.status).length;

  async function onSave() {
    if (!batchId || !attendance || changed === 0) return;
    setSaving(true);
    try {
      await save({ batchId, date: attendance.date, rows: rows.map((r) => ({ studentId: r.studentId, status: r.status })) });
      flash(`${changed} correction${changed === 1 ? "" : "s"} saved for ${attendance.date} · logged with your name`);
    } catch (err) {
      flash(friendlyError(err, "Couldn't save the correction."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 14, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "15px 18px", borderBottom: "1px solid #E8E5DE" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Correct a past date</h2>
          <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>Teachers can only mark today. Anything you change here is stamped with your name and the time.</span>
        </span>
        <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 8 }}>
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value as Id<"batches">)}
            aria-label="Batch"
            style={{ height: 38, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 500 }}
          >
            {activeBatches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Date"
            style={{ height: 38, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 500 }}
          />
        </span>
      </div>

      {attendance && (
        <div>
          {!attendance.saved && (
            <div style={{ padding: "11px 18px", background: "#FFF6E8", borderBottom: "1px solid #F2E1C4", fontSize: "0.75rem", color: "#8A5B0B" }}>
              Nothing was marked for this date. Saving will record it as marked by you — rows default to present.
            </div>
          )}
          {rows.map((r) => (
            <div key={r.studentId} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "9px 18px", borderBottom: "1px solid #F1EFE9" }}>
              <StudentAvatar photoUrl={photoUrls?.[r.studentId]} initials={initials(r.name)} size={28} tone={r.status === "absent" ? "#FDECEC" : r.status === "late" ? "#FFF6E8" : "#EDEBE4"} />
              <span style={{ flex: "1 1 160px", minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{r.name}</span>
                {r.corrected && <Pill tone="partial">corrected</Pill>}
                {original.get(r.studentId) !== r.status && <span style={{ fontSize: "0.6875rem", color: "#B4231F" }}>unsaved</span>}
              </span>
              <StatusToggle compact value={r.status} label={`Attendance for ${r.name}`} onChange={(status) => setRows((prev) => prev.map((x) => (x.studentId === r.studentId ? { ...x, status } : x)))} />
            </div>
          ))}
          {rows.length === 0 && <div style={{ padding: "28px 18px", textAlign: "center", fontSize: "0.8125rem", color: "#A8A39A" }}>No students were enrolled in this batch on that date.</div>}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 16 }}>
            <span style={{ flex: "1 1 220px", fontSize: "0.75rem", lineHeight: 1.5, color: "#8A857C" }}>
              {changed > 0 ? `${changed} row${changed === 1 ? "" : "s"} changed · not saved yet` : "Change a status above, then save. One row per student per date — nothing is duplicated."}
            </span>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || changed === 0}
              style={{ height: 40, padding: "0 18px", background: changed === 0 ? "#EDEBE4" : "#0D0D0D", color: changed === 0 ? "#A8A39A" : "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: saving ? "progress" : changed === 0 ? "not-allowed" : "pointer" }}
            >
              {saving ? "Saving…" : "Save corrections"}
            </button>
          </div>
        </div>
      )}
      {batches && activeBatches.length === 0 && <div style={{ padding: "28px 18px", textAlign: "center", fontSize: "0.8125rem", color: "#A8A39A" }}>Add a batch first.</div>}
    </div>
  );
}
