"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { initials } from "@/lib/format";
import StudentAvatar from "@/components/ui/StudentAvatar";
import Pill from "@/components/ui/Pill";
import { friendlyError } from "@/lib/errors";
import PublishModal from "@/components/teacher/PublishModal";
import CreateAssessmentModal from "@/components/teacher/CreateAssessmentModal";

interface BatchListItem {
  id: Id<"batches">;
  name: string;
}

interface MarkRow {
  studentId: Id<"students">;
  name: string;
  value: string;
  absent: boolean;
}

function batchAverage(rows: MarkRow[]): number {
  const scored = rows.filter((r) => !r.absent && r.value.trim() !== "").map((r) => Number(r.value));
  return scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;
}

export default function MarksView({
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
  const tests = useQuery(api.assessments.listForBatch, activeBatchId ? { batchId: activeBatchId } : "skip");
  const [selectedId, setSelectedId] = useState<Id<"assessments"> | "">("");
  // Default to the newest test, but keep whatever the teacher picked as long
  // as it still belongs to the batch they're looking at.
  const assessment = tests?.find((t) => t.id === selectedId) ?? tests?.[0] ?? (tests === undefined ? undefined : null);
  const grid = useQuery(api.assessments.getMarksGrid, assessment ? { assessmentId: assessment.id } : "skip");
  const saveDraft = useMutation(api.assessments.saveMarksDraft);
  const publish = useMutation(api.assessments.publish);

  const [rows, setRows] = useState<MarkRow[]>([]);
  const photoUrls = useQuery(api.files.getPhotoUrls, rows.length ? { studentIds: rows.map((r) => r.studentId) } : "skip");
  const [maxMarks, setMaxMarks] = useState(100);
  const [draftSaved, setDraftSaved] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newTestOpen, setNewTestOpen] = useState(false);
  const loadedFor = useRef<Id<"assessments"> | "">("");
  const activeBatchName = batches.find((b) => b.id === activeBatchId)?.name ?? "this batch";

  useEffect(() => {
    if (!assessment) {
      loadedFor.current = "";
      setRows([]);
      return;
    }
    if (!grid) return;
    if (loadedFor.current !== assessment.id) {
      setMaxMarks(grid.maxMarks);
      setRows(grid.rows);
      setDraftSaved(false);
      loadedFor.current = assessment.id;
    }
  }, [assessment, grid]);

  const average = batchAverage(rows);
  const entered = rows.filter((r) => r.absent || r.value.trim() !== "").length;
  const hasMarkError = rows.some((r) => !r.absent && r.value.trim() !== "" && (isNaN(Number(r.value)) || Number(r.value) > maxMarks));

  function setValue(studentId: Id<"students">, value: string) {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, value } : r)));
    setDraftSaved(false);
  }

  function toggleAbsent(studentId: Id<"students">) {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, absent: !r.absent } : r)));
    setDraftSaved(false);
  }

  async function onSaveDraft() {
    if (!assessment) return;
    try {
      // Send only what the validator accepts — `rows` also carries the
      // student's name for rendering, and Convex rejects extra fields.
      await saveDraft({
        assessmentId: assessment.id,
        rows: rows.map((r) => ({ studentId: r.studentId, value: r.value, absent: r.absent })),
      });
      setDraftSaved(true);
      flash("Draft saved · parents see nothing yet");
    } catch (err) {
      flash(friendlyError(err, "Couldn't save the draft."));
    }
  }

  function onAskPublish() {
    if (hasMarkError) {
      flash("Fix the invalid marks before publishing");
      return;
    }
    setModalOpen(true);
  }

  async function onConfirmPublish() {
    if (!assessment) return;
    try {
      const { notified } = await publish({ assessmentId: assessment.id });
      setModalOpen(false);
      flash(`${assessment.subject} results published · ${notified} guardian${notified === 1 ? "" : "s"} notified`);
    } catch (err) {
      setModalOpen(false);
      flash(friendlyError(err, "Couldn't publish — not every student has a mark or an absent flag yet."));
    }
  }

  return (
    <div style={{ animation: "dashFadeIn 240ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <select
          value={activeBatchId}
          onChange={(e) => setActiveBatchId(e.target.value as Id<"batches">)}
          aria-label="Batch"
          style={{ height: 40, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.9375rem", fontWeight: 700, cursor: "pointer" }}
        >
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        {tests && tests.length > 0 && (
          <select
            value={assessment?.id ?? ""}
            onChange={(e) => setSelectedId(e.target.value as Id<"assessments">)}
            aria-label="Test"
            style={{ height: 40, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 500, cursor: "pointer" }}
          >
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.subject} · {new Date(`${t.date}T12:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                {t.published ? " · published" : " · draft"}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={() => setNewTestOpen(true)}
          disabled={!activeBatchId}
          style={{ marginLeft: "auto", height: 40, padding: "0 15px", background: activeBatchId ? "#0D0D0D" : "#EDEBE4", color: activeBatchId ? "#F7F6F3" : "#A8A39A", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: activeBatchId ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}
        >
          New test
        </button>
      </div>

      {assessment === undefined ? null : assessment === null ? (
        <div style={{ padding: "56px 20px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, textAlign: "center" }}>
          <div style={{ fontSize: "0.9375rem", fontWeight: 700 }}>No test recorded for this batch yet.</div>
          <p style={{ margin: "8px auto 0", maxWidth: "42ch", fontSize: "0.8125rem", lineHeight: 1.55, color: "#8A857C" }}>
            Create one and the whole roster appears below for marks entry. Nothing reaches parents until you publish it.
          </p>
          <button
            type="button"
            onClick={() => setNewTestOpen(true)}
            style={{ height: 42, marginTop: 18, padding: "0 18px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
          >
            Create a test
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14, padding: "16px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: "1rem", fontWeight: 900, letterSpacing: "-0.025em" }}>
                Monthly test · {assessment.subject}
              </span>
              <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>
                {assessment.batchName} · {new Date(`${assessment.date}T12:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "long" })} · max {assessment.maxMarks} marks
              </span>
            </span>
            <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <Pill tone={assessment.published ? "approved" : "draft"}>{assessment.published ? "published" : "draft"}</Pill>
              <span style={{ padding: "5px 10px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 6, fontSize: "0.75rem", fontWeight: 500, color: "#4A463F", fontVariantNumeric: "tabular-nums" }}>
                Batch average {average ? `${average}/${maxMarks}` : "—"}
              </span>
              <span style={{ padding: "5px 10px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 6, fontSize: "0.75rem", fontWeight: 500, color: "#4A463F", fontVariantNumeric: "tabular-nums" }}>
                {entered}/{rows.length} entered
              </span>
            </span>
          </div>

          <div style={{ background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: "#FAF9F6", borderBottom: "1px solid #E8E5DE" }}>
              <span style={{ flex: "1 1 auto", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>Student</span>
              <span style={{ width: 92, textAlign: "center", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>Marks</span>
              <span style={{ width: 64, textAlign: "right", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>%</span>
              <span style={{ width: 78, textAlign: "right", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>Absent</span>
            </div>
            {rows.map((m) => {
              const num = Number(m.value);
              const bad = m.value !== "" && (isNaN(num) || num > maxMarks);
              const pct = m.absent ? "abs" : m.value === "" ? "—" : `${Math.round((num / maxMarks) * 100)}%`;
              return (
                <div key={m.studentId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderBottom: "1px solid #F1EFE9" }}>
                  <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 11 }}>
                    <StudentAvatar photoUrl={photoUrls?.[m.studentId]} initials={initials(m.name)} tone={m.absent ? "#FAF9F6" : "#EDEBE4"} />
                    <span style={{ fontSize: "0.875rem", fontWeight: 700, letterSpacing: "-0.01em" }}>{m.name}</span>
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={`Marks for ${m.name}`}
                    value={m.value}
                    onChange={(e) => setValue(m.studentId, e.target.value)}
                    disabled={m.absent || assessment.published}
                    style={{
                      width: 92,
                      height: 36,
                      padding: "0 11px",
                      textAlign: "center",
                      background: m.absent ? "#FAF9F6" : "#FFFFFF",
                      border: `1px solid ${bad ? "#E0645E" : "#DDD9D0"}`,
                      borderRadius: 8,
                      fontSize: "0.875rem",
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: m.absent ? "#A8A39A" : "#0D0D0D",
                    }}
                  />
                  <span style={{ width: 64, textAlign: "right", fontSize: "0.8125rem", fontWeight: 500, fontVariantNumeric: "tabular-nums", color: m.absent || m.value === "" ? "#A8A39A" : num >= average ? "#0B7A4B" : "#B4231F" }}>
                    {pct}
                  </span>
                  <span style={{ width: 78, display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => toggleAbsent(m.studentId)}
                      disabled={assessment.published}
                      aria-pressed={m.absent}
                      style={{
                        height: 30,
                        padding: "0 10px",
                        background: m.absent ? "#FDECEC" : "#FFFFFF",
                        border: `1px solid ${m.absent ? "#F6CFCC" : "#E8E5DE"}`,
                        borderRadius: 7,
                        fontSize: "0.75rem",
                        fontWeight: 500,
                        color: m.absent ? "#B4231F" : "#8A857C",
                        cursor: assessment.published ? "default" : "pointer",
                      }}
                    >
                      {m.absent ? "Absent" : "Mark"}
                    </button>
                  </span>
                </div>
              );
            })}
            {hasMarkError && (
              <div role="alert" style={{ margin: "14px 16px 0", padding: "11px 13px", background: "#FDECEC", border: "1px solid #F6CFCC", borderRadius: 8, fontSize: "0.8125rem", color: "#8E1C18" }}>
                Obtained marks cannot exceed the maximum of {maxMarks}. Fix the highlighted rows.
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: 16 }}>
              <span style={{ flex: "1 1 200px", fontSize: "0.75rem", lineHeight: 1.5, color: "#8A857C" }}>
                Parents see nothing until you publish. Drafts stay editable.
              </span>
              <button
                type="button"
                onClick={onSaveDraft}
                disabled={assessment.published}
                style={{ height: 42, padding: "0 16px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: assessment.published ? "default" : "pointer", opacity: assessment.published ? 0.5 : 1 }}
              >
                {draftSaved ? "Draft saved" : "Save draft"}
              </button>
              <button
                type="button"
                onClick={onAskPublish}
                disabled={assessment.published}
                style={{
                  height: 42,
                  padding: "0 18px",
                  background: assessment.published ? "#F1F7F3" : "#0D0D0D",
                  color: assessment.published ? "#0B7A4B" : "#F7F6F3",
                  border: assessment.published ? "1px solid #D3E7DC" : "0",
                  borderRadius: 9,
                  fontSize: "0.8125rem",
                  fontWeight: 700,
                  cursor: assessment.published ? "default" : "pointer",
                }}
              >
                {assessment.published ? "Published" : "Publish results"}
              </button>
            </div>
          </div>
        </>
      )}

      {modalOpen && assessment && (
        <PublishModal
          entered={entered}
          total={rows.length}
          batchAverage={average ? `${average}/${maxMarks}` : "—"}
          onCancel={() => setModalOpen(false)}
          onConfirm={onConfirmPublish}
        />
      )}
    {newTestOpen && activeBatchId && (
        <CreateAssessmentModal
          batchId={activeBatchId}
          batchName={activeBatchName}
          onClose={() => setNewTestOpen(false)}
          onCreated={(id) => setSelectedId(id)}
          flash={flash}
        />
      )}
    </div>
  );
}
