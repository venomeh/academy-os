"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fmt } from "@/lib/format";
import Pill from "@/components/ui/Pill";
import BatchModal, { type EditableBatch } from "@/components/admin/BatchModal";
import { friendlyError } from "@/lib/errors";

export default function BatchesView({ flash }: { flash: (msg: string) => void }) {
  const batches = useQuery(api.batches.listAllForAdmin);
  const allTeachers = useQuery(api.batches.listTeachers);
  const updateBatch = useMutation(api.batches.update);
  const assignTeacher = useMutation(api.batches.assignTeacher);
  const unassignTeacher = useMutation(api.batches.unassignTeacher);

  const addSubject = useMutation(api.batches.addSubject);
  const removeSubject = useMutation(api.batches.removeSubject);

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<EditableBatch | null>(null);
  const [pickerFor, setPickerFor] = useState<Id<"batches"> | null>(null);
  const [subjectFor, setSubjectFor] = useState<Id<"batches"> | null>(null);
  const [subjectName, setSubjectName] = useState("");

  async function onAddSubject(batchId: Id<"batches">) {
    const name = subjectName.trim();
    if (!name) return;
    try {
      await addSubject({ batchId, name });
      setSubjectName("");
      setSubjectFor(null);
      flash(`${name} added.`);
    } catch (e) {
      flash(friendlyError(e, "Could not add that subject."));
    }
  }

  async function onRemoveSubject(subjectId: Id<"subjects">, name: string) {
    try {
      await removeSubject({ subjectId });
      flash(`${name} removed.`);
    } catch (e) {
      flash(friendlyError(e, "Could not remove that subject."));
    }
  }

  async function onToggleActive(batchId: Id<"batches">, active: boolean) {
    await updateBatch({ batchId, active: !active });
    flash(active ? "Batch removed — hidden from rosters and billing." : "Batch reactivated.");
  }

  async function onAssign(batchId: Id<"batches">, teacherId: Id<"profiles">) {
    await assignTeacher({ batchId, teacherId });
    setPickerFor(null);
  }

  async function onUnassign(batchId: Id<"batches">, teacherId: Id<"profiles">) {
    await unassignTeacher({ batchId, teacherId });
  }

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>{batches?.length ?? 0} total</span>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          style={{ marginLeft: "auto", height: 38, padding: "0 15px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 8, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
        >
          Add batch
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(batches ?? []).map((b) => (
          <div key={b.id} style={{ padding: 18, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", opacity: b.active ? 1 : 0.6 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{b.name}</span>
                <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>
                  {b.gradeLevel ? `${b.gradeLevel} · ` : ""}
                  {b.days.length ? b.days.join("/") : "No days set"}
                  {b.startTime ? ` · ${b.startTime}${b.endTime ? `–${b.endTime}` : ""}` : ""}
                </span>
              </span>
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                <Pill tone={b.active ? "approved" : "flagged"}>{b.active ? "active" : "removed"}</Pill>
                <span style={{ fontSize: "0.8125rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(b.monthlyTuition)}/mo</span>
                <span style={{ fontSize: "0.75rem", color: "#A8A39A" }}>{b.rosterCount} enrolled</span>
                <button
                  type="button"
                  onClick={() => setEditing({ id: b.id, name: b.name, gradeLevel: b.gradeLevel, days: b.days, startTime: b.startTime, endTime: b.endTime, monthlyTuition: b.monthlyTuition })}
                  style={{ height: 30, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}
                >
                  Edit
                </button>
              </span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid #F1EFE9" }}>
              <span style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#A8A39A", marginRight: 4 }}>Subjects</span>
              {b.subjects.map((s) => (
                <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "#FFF4EF", border: "1px solid #F6DDD1", borderRadius: 999, fontSize: "0.75rem", fontWeight: 500 }}>
                  {s.name}
                  <button
                    type="button"
                    onClick={() => onRemoveSubject(s.id, s.name)}
                    aria-label={`Remove ${s.name}`}
                    style={{ width: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: 0, color: "#C0977F", cursor: "pointer", fontSize: "0.75rem", lineHeight: 1 }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {subjectFor === b.id ? (
                <span style={{ display: "inline-flex", gap: 4 }}>
                  <input
                    autoFocus
                    value={subjectName}
                    onChange={(e) => setSubjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onAddSubject(b.id);
                      if (e.key === "Escape") { setSubjectFor(null); setSubjectName(""); }
                    }}
                    placeholder="Subject name"
                    aria-label="Subject name"
                    style={{ height: 30, width: 140, padding: "0 10px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 999, fontSize: "0.75rem" }}
                  />
                  <button type="button" onClick={() => onAddSubject(b.id)} style={{ height: 30, padding: "0 11px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 999, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                    Add
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => { setSubjectFor(b.id); setSubjectName(""); }}
                  style={{ height: 30, padding: "0 10px", background: "#FFFFFF", border: "1px dashed #DDD9D0", borderRadius: 999, fontSize: "0.75rem", fontWeight: 500, color: "#4A463F", cursor: "pointer" }}
                >
                  + Add subject
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 10 }}>
              <span style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#A8A39A", marginRight: 4 }}>Teachers</span>
              {b.teachers.map((t) => (
                <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "#FAF9F6", border: "1px solid #E8E5DE", borderRadius: 999, fontSize: "0.75rem", fontWeight: 500 }}>
                  {t.name}
                  <button
                    type="button"
                    onClick={() => onUnassign(b.id, t.id)}
                    aria-label={`Unassign ${t.name}`}
                    style={{ width: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: 0, color: "#A8A39A", cursor: "pointer", fontSize: "0.75rem", lineHeight: 1 }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {b.teachers.length === 0 && <span style={{ fontSize: "0.75rem", color: "#A8A39A" }}>No teacher assigned</span>}

              {pickerFor === b.id ? (
                <select
                  autoFocus
                  aria-label="Assign teacher"
                  onChange={(e) => e.target.value && onAssign(b.id, e.target.value as Id<"profiles">)}
                  onBlur={() => setPickerFor(null)}
                  style={{ height: 30, padding: "0 8px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 999, fontSize: "0.75rem" }}
                >
                  <option value="">Choose teacher…</option>
                  {(allTeachers ?? [])
                    .filter((t) => !b.teachers.some((bt) => bt.id === t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerFor(b.id)}
                  style={{ height: 30, padding: "0 10px", background: "#FFFFFF", border: "1px dashed #DDD9D0", borderRadius: 999, fontSize: "0.75rem", fontWeight: 500, color: "#4A463F", cursor: "pointer" }}
                >
                  + Assign teacher
                </button>
              )}

              <button
                type="button"
                onClick={() => onToggleActive(b.id, b.active)}
                style={{ marginLeft: "auto", height: 30, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", color: b.active ? "#B4231F" : "#0B7A4B" }}
              >
                {b.active ? "Remove" : "Reactivate"}
              </button>
            </div>
          </div>
        ))}
        {batches && batches.length === 0 && (
          <div style={{ padding: "56px 20px", textAlign: "center", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11 }}>
            <div style={{ fontSize: "0.9375rem", fontWeight: 700 }}>No batches yet.</div>
            <p style={{ margin: "8px 0 0", fontSize: "0.8125rem", color: "#8A857C" }}>Add a batch before enrolling students — attendance, marks, and fees all hang off it.</p>
          </div>
        )}
      </div>

      {showAdd && <BatchModal onClose={() => setShowAdd(false)} flash={flash} />}
      {editing && <BatchModal batch={editing} onClose={() => setEditing(null)} flash={flash} />}
    </div>
  );
}
