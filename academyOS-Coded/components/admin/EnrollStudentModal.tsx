"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
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

const today = () => new Date().toISOString().slice(0, 10);

type GuardianMode = "existing" | "new";

/**
 * §5.1: enrol a student against an existing guardian (siblings share one,
 * which is where the sibling discount comes from) or invite a brand-new
 * parent in the same step — the invite creates their login and guardian
 * record, and the enrolment is written against it immediately after.
 */
export default function EnrollStudentModal({ onClose, flash }: { onClose: () => void; flash: (msg: string) => void }) {
  const guardians = useQuery(api.staff.listGuardians);
  const batches = useQuery(api.batches.list);
  const enroll = useMutation(api.students.enroll);
  const provisionAccount = useAction(api.auth.provisionAccount);

  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [mode, setMode] = useState<GuardianMode>("existing");
  const [guardianId, setGuardianId] = useState<Id<"guardians"> | "">("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newLang, setNewLang] = useState<"en" | "ur">("en");
  const [batchId, setBatchId] = useState<Id<"batches"> | "">("");
  const [joinedAt, setJoinedAt] = useState(today());
  const [showOverride, setShowOverride] = useState(false);
  const [feeOverride, setFeeOverride] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState<"" | "inviting" | "enrolling">("");
  const [error, setError] = useState("");

  const activeGuardians = (guardians ?? []).filter((g) => g.active);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim());
  const guardianReady = mode === "existing" ? Boolean(guardianId) : Boolean(newName.trim() && emailOk);
  const valid = name.trim() && guardianReady && batchId && joinedAt;

  async function onSubmit() {
    if (!valid) {
      setError(mode === "new" && newEmail && !emailOk ? "Enter a valid email for the parent." : "Name, guardian, batch, and a joining date are all required.");
      return;
    }
    if (showOverride && feeOverride && !overrideReason.trim()) {
      setError("A reason is required for a custom fee.");
      return;
    }
    setError("");
    try {
      let targetGuardian: Id<"guardians"> | "" = guardianId;
      let inviteCodeSent = true;
      if (mode === "new") {
        setBusy("inviting");
        const result = await provisionAccount({
          email: newEmail.trim().toLowerCase(),
          fullName: newName.trim(),
          role: "parent",
          phone: newPhone.trim() || undefined,
          languagePref: newLang,
        });
        if (!result.ok) throw new Error(result.error);
        if (!result.guardianId) throw new Error("The parent was invited but no guardian record came back — enrol against them from the list.");
        targetGuardian = result.guardianId;
        inviteCodeSent = result.codeSent;
      }
      setBusy("enrolling");
      await enroll({
        name: name.trim(),
        grade: grade.trim() || undefined,
        guardianId: targetGuardian as Id<"guardians">,
        batchId: batchId as Id<"batches">,
        joinedAt,
        feeOverride: showOverride && feeOverride ? Number(feeOverride) : undefined,
        overrideReason: showOverride && feeOverride ? overrideReason.trim() : undefined,
      });
      flash(
        mode === "new"
          ? inviteCodeSent
            ? `${name.trim()} enrolled · invite sent to ${newEmail.trim().toLowerCase()}`
            : `${name.trim()} enrolled · the parent's code email failed — use “Resend invite” under Teachers & parents`
          : `${name.trim()} enrolled.`
      );
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Could not enroll the student."));
    } finally {
      setBusy("");
    }
  }

  return (
    <Modal title="Enroll student" onClose={onClose} width={480}>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle} htmlFor="enroll-name">Student name</label>
          <input id="enroll-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ayesha Khan" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="enroll-grade">Grade (optional)</label>
            <input id="enroll-grade" style={inputStyle} value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="9" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="enroll-joined">Joining date</label>
            <input id="enroll-joined" type="date" style={inputStyle} value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)} />
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Guardian</label>
            <span role="group" aria-label="Guardian" style={{ marginLeft: "auto", display: "flex", gap: 3, padding: 3, background: "#F4F2EC", borderRadius: 8 }}>
              {(
                [
                  ["existing", "Existing parent"],
                  ["new", "Invite new parent"],
                ] as [GuardianMode, string][]
              ).map(([value, label]) => {
                const on = mode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setMode(value); setError(""); }}
                    aria-pressed={on}
                    style={{ height: 28, padding: "0 10px", border: 0, borderRadius: 6, cursor: "pointer", background: on ? "#FFFFFF" : "transparent", color: on ? "#0D0D0D" : "#8A857C", fontSize: "0.6875rem", fontWeight: on ? 700 : 500, boxShadow: on ? "0 1px 2px rgba(13,13,13,0.12)" : "none" }}
                  >
                    {label}
                  </button>
                );
              })}
            </span>
          </div>

          {mode === "existing" ? (
            <>
              <select id="enroll-guardian" aria-label="Guardian" style={inputStyle} value={guardianId} onChange={(e) => setGuardianId(e.target.value as Id<"guardians">)}>
                <option value="">Select guardian…</option>
                {activeGuardians.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {g.phone ? ` · ${g.phone}` : ""}
                    {g.children.length > 0 ? ` (${g.children.join(", ")})` : ""}
                  </option>
                ))}
              </select>
              <p style={{ margin: "8px 0 0", fontSize: "0.6875rem", color: "#8A857C" }}>
                {guardians && activeGuardians.length === 0 ? "No parents yet — switch to “Invite new parent”." : "Siblings share one guardian; the sibling discount follows from that automatically."}
              </p>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 9 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input aria-label="Parent name" style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Parent's full name" />
                <input aria-label="Parent email" type="email" style={inputStyle} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="parent@email.com" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                <input aria-label="Parent phone" style={inputStyle} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone (for WhatsApp, optional)" />
                <span role="group" aria-label="Language" style={{ display: "flex", gap: 3, padding: 3, background: "#F4F2EC", borderRadius: 8 }}>
                  {(
                    [
                      ["en", "EN"],
                      ["ur", "اردو"],
                    ] as ["en" | "ur", string][]
                  ).map(([value, label]) => {
                    const on = newLang === value;
                    return (
                      <button key={value} type="button" onClick={() => setNewLang(value)} aria-pressed={on} style={{ height: 34, padding: "0 12px", border: 0, borderRadius: 6, cursor: "pointer", background: on ? "#FFFFFF" : "transparent", color: on ? "#0D0D0D" : "#8A857C", fontSize: "0.75rem", fontWeight: on ? 700 : 500, boxShadow: on ? "0 1px 2px rgba(13,13,13,0.12)" : "none" }}>
                        {label}
                      </button>
                    );
                  })}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: "0.6875rem", lineHeight: 1.5, color: "#8A857C" }}>They get a welcome email and a 6-digit code to set their password. Remarks and reminders go out in the language you pick.</p>
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle} htmlFor="enroll-batch">Batch</label>
          <select id="enroll-batch" style={inputStyle} value={batchId} onChange={(e) => setBatchId(e.target.value as Id<"batches">)}>
            <option value="">Select batch…</option>
            {(batches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.monthlyTuition.toLocaleString()}/mo
              </option>
            ))}
          </select>
          {batches && batches.length === 0 && (
            <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "#8A857C" }}>No batches yet — add one from the Batches tab first.</p>
          )}
        </div>

        {!showOverride ? (
          <button
            type="button"
            onClick={() => setShowOverride(true)}
            style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, fontSize: "0.75rem", fontWeight: 500, color: "#6B6660", textDecoration: "underline", cursor: "pointer" }}
          >
            + Custom fee / scholarship override
          </button>
        ) : (
          <div style={{ padding: 14, background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 9, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
              <div>
                <label style={labelStyle} htmlFor="enroll-fee">Monthly fee (PKR)</label>
                <input id="enroll-fee" style={inputStyle} inputMode="numeric" value={feeOverride} onChange={(e) => setFeeOverride(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Leave blank for batch default" />
              </div>
              <div>
                <label style={labelStyle} htmlFor="enroll-reason">Reason</label>
                <input id="enroll-reason" style={inputStyle} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Sibling scholarship, hardship, …" />
              </div>
            </div>
          </div>
        )}

        {error && <div role="alert" style={{ fontSize: "0.75rem", color: "#B4231F" }}>{error}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ flex: "1 1 100px", height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={Boolean(busy) || !valid}
            style={{ flex: "1 1 150px", height: 42, background: busy || !valid ? "#EDEBE4" : "#0D0D0D", color: busy || !valid ? "#A8A39A" : "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: busy || !valid ? "not-allowed" : "pointer" }}
          >
            {busy === "inviting" ? "Inviting parent…" : busy === "enrolling" ? "Enrolling…" : mode === "new" ? "Invite & enroll" : "Enroll student"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
