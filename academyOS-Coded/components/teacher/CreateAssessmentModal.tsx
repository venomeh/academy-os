"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Modal from "@/components/ui/Modal";
import { friendlyError } from "@/lib/errors";

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

/** §7 — a test is batch + subject + date + max marks. The roster grid follows from it. */
export default function CreateAssessmentModal({
  batchId,
  batchName,
  onClose,
  onCreated,
  flash,
}: {
  batchId: Id<"batches">;
  batchName: string;
  onClose: () => void;
  onCreated: (assessmentId: Id<"assessments">) => void;
  flash: (msg: string) => void;
}) {
  const subjects = useQuery(api.assessments.listSubjectsForBatch, { batchId });
  const createAssessment = useMutation(api.assessments.createAssessment);

  const [subjectId, setSubjectId] = useState<Id<"subjects"> | "">("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [maxMarks, setMaxMarks] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const effectiveSubject = subjectId || (subjects?.length === 1 ? subjects[0].id : "");
  const valid = Boolean(effectiveSubject) && Boolean(date) && Number(maxMarks) > 0;

  async function onSubmit() {
    if (!valid) {
      setError("Pick a subject, a date, and max marks above 0.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const id = await createAssessment({
        batchId,
        subjectId: effectiveSubject as Id<"subjects">,
        date,
        maxMarks: Number(maxMarks),
      });
      flash("Test created — enter marks below, then publish when you're done.");
      onCreated(id);
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Could not create the test."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New test" onClose={onClose} width={440}>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: "0.8125rem", lineHeight: 1.55, color: "#6B6660" }}>
          For <strong>{batchName}</strong>. Marks stay private to you until you publish — parents see nothing before that.
        </p>

        <div>
          <label style={labelStyle} htmlFor="test-subject">Subject</label>
          <select
            id="test-subject"
            style={inputStyle}
            value={effectiveSubject}
            onChange={(e) => setSubjectId(e.target.value as Id<"subjects">)}
          >
            <option value="">Select subject…</option>
            {(subjects ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {subjects && subjects.length === 0 && (
            <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "#8A857C" }}>
              This batch has no subjects yet — ask the front desk to add one from Batches.
            </p>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="test-date">Date</label>
            <input id="test-date" type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="test-max">Max marks</label>
            <input
              id="test-max"
              style={inputStyle}
              inputMode="numeric"
              value={maxMarks}
              onChange={(e) => setMaxMarks(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="100"
            />
          </div>
        </div>

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
            {busy ? "Creating…" : "Create test"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
