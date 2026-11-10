"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import Modal from "@/components/ui/Modal";
import { friendlyError } from "@/lib/errors";

export type ReminderTemplateDoc = Doc<"reminderTemplates">;
export type ReminderBucket = ReminderTemplateDoc["bucket"];
export type ReminderLanguage = ReminderTemplateDoc["language"];

export const BUCKET_LABEL: Record<ReminderBucket, string> = {
  due_date: "Due date",
  "7d_gentle": "7 days overdue",
  "14d_firm": "14 days overdue",
  "30d_final": "30 days — final notice",
};

/** Every placeholder `reminders.claimAndPrepareSend` fills — anything else is left visible so a typo can't silently blank a message. */
const PLACEHOLDERS: [string, string][] = [
  ["guardianName", "Mr. Ahmed"],
  ["studentName", "Ayesha"],
  ["amount", "4,500"],
  ["dueDate", "2026-09-10"],
  ["daysOverdue", "7"],
  ["period", "2026-09"],
  ["itemization", "Monthly tuition: 4,500, Sibling discount: −450"],
  ["payUrl", "https://…/pay/a1b2c3"],
];

function fillSample(text: string): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => PLACEHOLDERS.find(([k]) => k === key)?.[1] ?? m);
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "#FFFFFF",
  border: "1px solid #DDD9D0",
  borderRadius: 8,
  fontSize: "0.8125rem",
  lineHeight: 1.55,
};

/**
 * View, edit, or create the locked template for one bucket + language
 * (§10). Saving never overwrites: the current version is deactivated and
 * version+1 inserted, so every sent message can still cite the exact text
 * it used (`messageLog.templateVersion`).
 */
export default function TemplateModal({
  bucket,
  language,
  template,
  onClose,
  onSaved,
}: {
  bucket: ReminderBucket;
  language: ReminderLanguage;
  template: ReminderTemplateDoc | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const setTemplate = useMutation(api.reminders.setTemplate);
  const [editing, setEditing] = useState(template === null);
  const [subjectLine, setSubjectLine] = useState(template?.subjectLine ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const urdu = language === "ur";
  const dirty = subjectLine !== (template?.subjectLine ?? "") || body !== (template?.body ?? "");
  const missingPayLink = !/\{\{\s*payUrl\s*\}\}/.test(body);
  const missingAmount = !/\{\{\s*amount\s*\}\}/.test(body);
  const valid = subjectLine.trim() && body.trim() && !missingPayLink && !missingAmount;

  async function onSave() {
    if (!valid) {
      setError(missingPayLink || missingAmount ? "The body must include {{amount}} and {{payUrl}} — a reminder without them can't be acted on." : "Subject and body are both required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setTemplate({ bucket, language, subjectLine: subjectLine.trim(), body: body.trim() });
      onSaved(`${BUCKET_LABEL[bucket]} · ${urdu ? "Urdu" : "English"} saved as v${(template?.templateVersion ?? 0) + 1}`);
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Could not save the template."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={template ? "Reminder template" : "New reminder template"} onClose={onClose} width={560}>
      <div style={{ padding: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 9999, background: "#FF4E18", display: "block" }} />
          <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>{BUCKET_LABEL[bucket]}</span>
          <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>{urdu ? "اردو" : "English"}</span>
          <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "#8A857C", fontFamily: "ui-monospace, Menlo, monospace" }}>
            {template ? `v${template.templateVersion}` : "not configured yet"}
          </span>
        </div>

        {!editing && template ? (
          <>
            <div style={{ margin: "14px 0 0", padding: "13px 16px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: "10px 10px 0 0", borderBottom: "none", fontSize: "0.8125rem", fontWeight: 700, color: "#4A463F" }}>
              {preview ? fillSample(template.subjectLine) : template.subjectLine}
            </div>
            <p dir={urdu ? "rtl" : "ltr"} style={{ margin: 0, padding: "15px 16px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: "0 0 10px 10px", fontSize: "0.875rem", lineHeight: 1.65, color: "#2A2723", whiteSpace: "pre-line" }}>
              {preview ? fillSample(template.body) : template.body}
            </p>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 500, color: "#4A463F" }}>
              Subject line
              <input value={subjectLine} onChange={(e) => { setSubjectLine(e.target.value); setError(""); }} dir={urdu ? "rtl" : "ltr"} style={{ ...inputStyle, marginTop: 6, height: 40, padding: "0 12px" }} placeholder={urdu ? "فیس یاد دہانی · {{studentName}}" : "Fee reminder · {{studentName}} · {{period}}"} />
            </label>
            <label style={{ fontSize: "0.75rem", fontWeight: 500, color: "#4A463F" }}>
              Body
              <textarea
                value={body}
                onChange={(e) => { setBody(e.target.value); setError(""); }}
                dir={urdu ? "rtl" : "ltr"}
                rows={8}
                style={{ ...inputStyle, marginTop: 6, resize: "vertical", fontFamily: "inherit" }}
                placeholder={"Dear {{guardianName}}, PKR {{amount}} for {{studentName}} was due on {{dueDate}}.\n{{itemization}}\nPay online: {{payUrl}}"}
              />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {PLACEHOLDERS.map(([key]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBody((b) => `${b}${b && !b.endsWith(" ") && !b.endsWith("\n") ? " " : ""}{{${key}}}`)}
                  style={{ padding: "4px 8px", background: "#FFFFFF", border: `1px solid ${(key === "payUrl" && missingPayLink) || (key === "amount" && missingAmount) ? "#F6CFCC" : "#E8E5DE"}`, borderRadius: 6, fontSize: "0.625rem", fontFamily: "ui-monospace, Menlo, monospace", color: "#4A463F", cursor: "pointer" }}
                  title="Insert placeholder"
                >
                  {`{{${key}}}`}
                </button>
              ))}
            </div>
          </div>
        )}

        <p style={{ margin: "14px 0 0", fontSize: "0.75rem", lineHeight: 1.55, color: "#8A857C" }}>
          {"{{placeholders}}"} are filled from live data by deterministic substitution. Structure and tone are locked and version-stored — saving creates a new version, it never overwrites the one already sent.
        </p>
        {error && <div role="alert" style={{ marginTop: 10, fontSize: "0.75rem", color: "#B4231F" }}>{error}</div>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
          {!editing && template ? (
            <>
              <button type="button" onClick={() => setPreview((p) => !p)} style={{ flex: "1 1 120px", height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}>
                {preview ? "Show placeholders" : "Preview with sample data"}
              </button>
              <button type="button" onClick={() => setEditing(true)} style={{ flex: "1 1 120px", height: 42, background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}>
                Edit · new version
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => (template ? (setEditing(false), setSubjectLine(template.subjectLine), setBody(template.body), setError("")) : onClose())}
                style={{ flex: "1 1 100px", height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={busy || !dirty || !valid}
                style={{ flex: "1 1 150px", height: 42, background: busy || !dirty || !valid ? "#EDEBE4" : "#0D0D0D", color: busy || !dirty || !valid ? "#A8A39A" : "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: busy || !dirty || !valid ? "not-allowed" : "pointer" }}
              >
                {busy ? "Saving…" : template ? `Save as v${template.templateVersion + 1}` : "Save template"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
