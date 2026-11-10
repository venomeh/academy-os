"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/ui/Modal";
import { friendlyError } from "@/lib/errors";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const inputStyle: React.CSSProperties = {
  height: 40,
  padding: "0 12px",
  background: "#FFFFFF",
  border: "1px solid #DDD9D0",
  borderRadius: 8,
  fontSize: "0.8125rem",
  width: "100%",
};

const labelStyle: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 500, color: "#4A463F", display: "block", marginBottom: 6 };

export interface EditableBatch {
  id: Id<"batches">;
  name: string;
  gradeLevel: string | null;
  days: string[];
  startTime: string | null;
  endTime: string | null;
  monthlyTuition: number;
}

/**
 * Create a batch, or edit an existing one's name / grade / days / times /
 * tuition (§4.1 CRUD). Subjects and teacher assignments have their own
 * lifecycle on the batch card, so they only appear here at creation.
 * Changing tuition never touches issued vouchers — each one snapshotted
 * the amount it was generated with.
 */
export default function BatchModal({ batch, onClose, flash }: { batch?: EditableBatch; onClose: () => void; flash: (msg: string) => void }) {
  const editing = Boolean(batch);
  const teachers = useQuery(api.batches.listTeachers, editing ? "skip" : {});
  const createBatch = useMutation(api.batches.create);
  const updateBatch = useMutation(api.batches.update);

  const [name, setName] = useState(batch?.name ?? "");
  const [gradeLevel, setGradeLevel] = useState(batch?.gradeLevel ?? "");
  const [subjectName, setSubjectName] = useState("");
  const [days, setDays] = useState<string[]>(batch?.days ?? []);
  const [startTime, setStartTime] = useState(batch?.startTime ?? "");
  const [endTime, setEndTime] = useState(batch?.endTime ?? "");
  const [tuition, setTuition] = useState(batch ? String(batch.monthlyTuition) : "");
  const [teacherIds, setTeacherIds] = useState<Id<"profiles">[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleDay(d: string) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }
  function toggleTeacher(id: Id<"profiles">) {
    setTeacherIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const valid = name.trim() && (editing || subjectName.trim()) && Number(tuition) > 0;
  const tuitionChanged = editing && batch && Number(tuition) !== batch.monthlyTuition;

  async function onSubmit() {
    if (!valid) {
      setError(editing ? "Name and a monthly tuition above 0 are required." : "Name, subject, and a monthly tuition above 0 are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editing && batch) {
        await updateBatch({
          batchId: batch.id,
          name: name.trim(),
          gradeLevel: gradeLevel.trim() || undefined,
          daysOfWeek: days,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          monthlyTuition: Number(tuition),
        });
        flash(`${name.trim()} updated${tuitionChanged ? " · applies from the next voucher run" : ""}.`);
      } else {
        await createBatch({
          name: name.trim(),
          gradeLevel: gradeLevel.trim() || undefined,
          subjectName: subjectName.trim(),
          daysOfWeek: days,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          monthlyTuition: Number(tuition),
          teacherIds,
        });
        flash(`${name.trim()} created.`);
      }
      onClose();
    } catch (err) {
      setError(friendlyError(err, editing ? "Could not update the batch." : "Could not create the batch."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? "Edit batch" : "Add batch"} onClose={onClose} width={480}>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle} htmlFor="batch-name">Batch name</label>
          <input id="batch-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Class 9-B Science" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="batch-grade">Grade level</label>
            <input id="batch-grade" style={inputStyle} value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} placeholder="Grade 9" />
          </div>
          {!editing && (
            <div>
              <label style={labelStyle} htmlFor="batch-subject">First subject</label>
              <input id="batch-subject" style={inputStyle} value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="Science" />
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>Days</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {DAYS.map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  aria-pressed={on}
                  style={{ height: 32, padding: "0 12px", background: on ? "#0D0D0D" : "#FFFFFF", color: on ? "#F7F6F3" : "#4A463F", border: `1px solid ${on ? "#0D0D0D" : "#DDD9D0"}`, borderRadius: 7, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="batch-start">Start time</label>
            <input id="batch-start" type="time" style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="batch-end">End time</label>
            <input id="batch-end" type="time" style={inputStyle} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="batch-tuition">Monthly tuition (PKR)</label>
          <input id="batch-tuition" style={inputStyle} inputMode="numeric" value={tuition} onChange={(e) => setTuition(e.target.value.replace(/[^0-9]/g, ""))} placeholder="4500" />
          {tuitionChanged && <p style={{ margin: "6px 0 0", fontSize: "0.6875rem", color: "#8A857C" }}>Issued vouchers keep the amount they were generated with; the new tuition applies from the next run.</p>}
        </div>
        {!editing && (
          <div>
            <label style={labelStyle}>Teachers</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflowY: "auto", border: "1px solid #EFEDE7", borderRadius: 8, padding: 8 }}>
              {(teachers ?? []).map((t) => (
                <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 6px", cursor: "pointer" }}>
                  <input type="checkbox" checked={teacherIds.includes(t.id)} onChange={() => toggleTeacher(t.id)} />
                  <span style={{ fontSize: "0.8125rem" }}>{t.name}</span>
                </label>
              ))}
              {teachers && teachers.length === 0 && (
                <div style={{ padding: "10px 6px", fontSize: "0.75rem", color: "#A8A39A" }}>No teachers yet — invite one from Academy setup → Teachers &amp; parents, then come back to assign them.</div>
              )}
            </div>
          </div>
        )}
        {editing && <p style={{ margin: 0, fontSize: "0.6875rem", color: "#A8A39A" }}>Subjects and teachers are managed from the batch card.</p>}
        {error && <div role="alert" style={{ fontSize: "0.75rem", color: "#B4231F" }}>{error}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ flex: "1 1 100px", height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !valid}
            style={{ flex: "1 1 150px", height: 42, background: busy || !valid ? "#EDEBE4" : "#0D0D0D", color: busy || !valid ? "#A8A39A" : "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: busy || !valid ? "not-allowed" : "pointer" }}
          >
            {busy ? (editing ? "Saving…" : "Creating…") : editing ? "Save changes" : "Create batch"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
