"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Pill from "@/components/ui/Pill";
import type { Tone } from "@/lib/format";
import { BUCKET_LABEL, type ReminderBucket, type ReminderLanguage, type ReminderTemplateDoc } from "@/components/admin/TemplateModal";

const BUCKET_TONE: Record<ReminderBucket, string> = {
  due_date: "#8A857C",
  "7d_gentle": "#C99A2E",
  "14d_firm": "#D9791F",
  "30d_final": "#B4231F",
};

const BUCKET_ORDER: ReminderBucket[] = ["due_date", "7d_gentle", "14d_firm", "30d_final"];
const LANGUAGES: [ReminderLanguage, string][] = [
  ["en", "English"],
  ["ur", "اردو"],
];

function statusTone(status: string): Tone {
  if (status === "sent") return "delivered";
  if (status === "failed") return "unpaid";
  return "sent";
}

export default function RemindersView({ onOpen }: { onOpen: (bucket: ReminderBucket, language: ReminderLanguage, template: ReminderTemplateDoc | null) => void }) {
  const templates = useQuery(api.reminders.listTemplates);
  const messages = useQuery(api.reminders.listMessageLog);
  const sweepOn = useQuery(api.reminders.getSweepStatus);
  const toggleSweep = useMutation(api.reminders.toggleSweep);

  // The active template per bucket + language. A missing translation falls
  // back to English at send time; the card says so rather than hiding it.
  const active = new Map<string, ReminderTemplateDoc>();
  for (const t of templates ?? []) if (t.active) active.set(`${t.bucket}:${t.language}`, t);

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, padding: "15px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Escalation sequence</span>
          <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>Daily sweep · one message per family per bucket · stops the day payment lands · final notice also alerts you</span>
        </span>
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: "0.8125rem", fontWeight: 500, cursor: "pointer", userSelect: "none" }}>
          <span style={{ position: "relative", width: 38, height: 22, flex: "none", borderRadius: 9999, background: sweepOn ? "#0D0D0D" : "#DDD9D0", display: "block" }}>
            <span style={{ position: "absolute", top: 3, left: sweepOn ? 19 : 3, width: 16, height: 16, borderRadius: 9999, background: "#FFFFFF", display: "block", transition: "left 200ms cubic-bezier(0.16,1,0.3,1)" }} />
          </span>
          <input type="checkbox" checked={!!sweepOn} onChange={() => toggleSweep()} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
          {sweepOn ? "Sweep on" : "Sweep paused"}
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14, marginBottom: 14 }}>
        {BUCKET_ORDER.map((bucket) => (
          <div key={bucket} style={{ padding: "17px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: BUCKET_TONE[bucket], display: "block" }} />
              <span style={{ fontSize: "0.8125rem", fontWeight: 700 }}>{BUCKET_LABEL[bucket]}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
              {LANGUAGES.map(([language, label]) => {
                const t = active.get(`${bucket}:${language}`) ?? null;
                return (
                  <div key={language} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid #F1EFE9" }}>
                    <span style={{ minWidth: 0, flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: "0.75rem", fontWeight: 500 }}>
                        {label}
                        {t && <span style={{ marginLeft: 6, fontSize: "0.6875rem", color: "#A8A39A", fontFamily: "ui-monospace, Menlo, monospace" }}>v{t.templateVersion}</span>}
                      </span>
                      <span dir={language === "ur" ? "rtl" : "ltr"} style={{ fontSize: "0.6875rem", color: t ? "#8A857C" : "#C0BBB2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {t ? t.subjectLine : language === "ur" ? "Not set — English is sent to Urdu families" : "Not set — nothing goes out for this bucket"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpen(bucket, language, t)}
                      style={{ height: 30, padding: "0 11px", flex: "none", background: t ? "#FFFFFF" : "#0D0D0D", color: t ? "#0D0D0D" : "#F7F6F3", border: t ? "1px solid #DDD9D0" : "0", borderRadius: 7, fontSize: "0.6875rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      {t ? "View · edit" : "Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 18px", borderBottom: "1px solid #E8E5DE" }}>
          <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Message log</h2>
          <span style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8A857C" }}>Channel · bucket · version</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {(messages ?? []).map((m) => (
            <div key={m.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid #F1EFE9" }}>
              <span
                style={{
                  padding: "4px 9px", background: m.channel === "whatsapp" ? "#F1F7F3" : "#FAF9F6",
                  border: `1px solid ${m.channel === "whatsapp" ? "#D3E7DC" : "#E8E5DE"}`, borderRadius: 6,
                  fontSize: "0.6875rem", fontWeight: 500, color: m.channel === "whatsapp" ? "#0B7A4B" : "#6B6660", minWidth: 76, textAlign: "center",
                }}
              >
                {m.channel}
              </span>
              <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{m.guardian}</span>
                <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{m.bucket ? BUCKET_LABEL[m.bucket] : "—"}{m.personalized ? " · personalised" : ""}</span>
              </span>
              <span style={{ fontSize: "0.6875rem", color: "#8A857C", fontFamily: "ui-monospace, Menlo, monospace" }}>{m.templateVersion ? `v${m.templateVersion}` : "—"}</span>
              <Pill tone={statusTone(m.status)}>{m.status}</Pill>
              <span style={{ fontSize: "0.6875rem", color: "#A8A39A", minWidth: 74, textAlign: "right" }}>{m.sentAt ? new Date(m.sentAt).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "pending"}</span>
            </div>
          ))}
          {messages && messages.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center", fontSize: "0.8125rem", color: "#8A857C" }}>No reminders sent yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
