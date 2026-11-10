"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { initials } from "@/lib/format";
import Pill from "@/components/ui/Pill";
import StudentAvatar from "@/components/ui/StudentAvatar";
import type { Tone } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import FactChips from "@/components/ui/FactChips";

function statusTone(status: string): Tone {
  if (status === "approved") return "approved";
  if (status === "low_data") return "lowdata";
  if (status === "rejected") return "rejected";
  return "draft";
}

const CURRENT_PERIOD = new Date().toISOString().slice(0, 7);

/** Admin-set tone per language (§9 "tone template fixed by admin"), versioned insert-only like reminder templates. */
function TonePanel({ flash }: { flash: (msg: string) => void }) {
  const tones = useQuery(api.remarks.activeToneTemplates);
  const setToneTemplate = useMutation(api.remarks.setToneTemplate);
  const [drafts, setDrafts] = useState<Partial<Record<"en" | "ur", string>>>({});
  const [busy, setBusy] = useState<"" | "en" | "ur">("");

  if (!tones) return null;

  async function onSave(language: "en" | "ur") {
    const text = (drafts[language] ?? "").trim();
    if (!text) return;
    setBusy(language);
    try {
      await setToneTemplate({ language, tone: text });
      setDrafts((d) => ({ ...d, [language]: undefined }));
      flash(`${language === "ur" ? "Urdu" : "English"} tone saved as v${(tones?.[language]?.version ?? 0) + 1} · applies to the next draft`);
    } catch (e) {
      flash(friendlyError(e, "Could not save the tone."));
    } finally {
      setBusy("");
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 14 }}>
      {(
        [
          ["en", "English"],
          ["ur", "اردو"],
        ] as ["en" | "ur", string][]
      ).map(([language, label]) => {
        const current = tones[language];
        const value = drafts[language] ?? current?.tone ?? "";
        const dirty = drafts[language] !== undefined && drafts[language] !== (current?.tone ?? "");
        return (
          <div key={language} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700 }}>{label}</span>
              <span style={{ fontSize: "0.6875rem", color: "#A8A39A", fontFamily: "ui-monospace, Menlo, monospace" }}>{current ? `v${current.version}` : "default"}</span>
            </div>
            <textarea
              value={value}
              onChange={(e) => setDrafts((d) => ({ ...d, [language]: e.target.value }))}
              rows={5}
              dir={language === "ur" ? "rtl" : "ltr"}
              placeholder={tones.defaultTone}
              aria-label={`${label} tone`}
              style={{ width: "100%", padding: "12px 14px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 9, fontSize: "0.8125rem", lineHeight: 1.6, resize: "vertical", fontFamily: "inherit" }}
            />
            {!current && <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>Using the built-in default shown above until you save your own.</span>}
            <button
              type="button"
              onClick={() => onSave(language)}
              disabled={!dirty || busy === language}
              style={{ alignSelf: "flex-end", height: 32, padding: "0 14px", background: dirty ? "#0D0D0D" : "#EDEBE4", color: dirty ? "#F7F6F3" : "#A8A39A", border: 0, borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: dirty ? "pointer" : "not-allowed" }}
            >
              {busy === language ? "Saving…" : `Save ${label} tone`}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function RemarksView({ flash }: { flash: (msg: string) => void }) {
  const rows = useQuery(api.remarks.getAllForAdmin, { period: CURRENT_PERIOD });
  const stats = useQuery(api.remarks.getStats, { period: CURRENT_PERIOD });
  const photoUrls = useQuery(api.files.getPhotoUrls, rows ? { studentIds: rows.map((r) => r.studentId) } : "skip");
  const publishStatus = useQuery(api.remarks.getPublishStatus, { period: CURRENT_PERIOD });
  const approve = useMutation(api.remarks.approve);
  const reject = useMutation(api.remarks.reject);
  const regenerate = useAction(api.remarks.regenerate);
  const publishForBatch = useAction(api.remarks.publishForBatch);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [publishing, setPublishing] = useState<string>("");
  const [toneOpen, setToneOpen] = useState(false);

  async function onPublish(batchId: Id<"batches">, name: string) {
    setPublishing(batchId);
    try {
      const r = await publishForBatch({ batchId, period: CURRENT_PERIOD });
      flash(`${name}: ${r.notified} parent${r.notified === 1 ? "" : "s"} notified${r.skipped ? `, ${r.skipped} already sent` : ""}${r.failed ? `, ${r.failed} failed` : ""}`);
    } catch (e) {
      flash(friendlyError(e, "Could not publish this batch."));
    } finally {
      setPublishing("");
    }
  }

  async function onApprove(id: Id<"remarks">) {
    try {
      await approve({ remarkId: id });
      flash("Remark approved · parent can see it now");
    } catch (e) {
      flash(friendlyError(e, "Could not approve this remark."));
    }
  }

  async function onReject(id: Id<"remarks">) {
    await reject({ remarkId: id });
    flash("Draft rejected · teacher will write manually");
  }

  async function onRegen(id: Id<"remarks">) {
    setBusy((b) => ({ ...b, [id]: true }));
    await regenerate({ remarkId: id });
    setBusy((b) => ({ ...b, [id]: false }));
    flash("Re-drafted from this month's data pack");
  }

  const pending = stats ? stats.draft + stats.lowData : 0;

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, padding: "15px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{CURRENT_PERIOD} remarks pipeline</span>
          <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>Drafted from attendance and test data · grounded in numbers only</span>
        </span>
        <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Pill tone="pending">{stats?.total ?? 0} total</Pill>
          <Pill tone="approved">{stats?.approved ?? 0} approved</Pill>
          <Pill tone="lowdata">{stats?.lowData ?? 0} low data</Pill>
          <Pill tone="rejected">{stats?.rejected ?? 0} rejected</Pill>
        </span>
      </div>

      <div style={{ marginBottom: 14, padding: "15px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Tone template</span>
            <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>Fixed by you, layered onto every draft (§9). Versioned — the grounding rules underneath can&apos;t be changed.</span>
          </span>
          <button type="button" onClick={() => setToneOpen((o) => !o)} style={{ marginLeft: "auto", height: 32, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}>
            {toneOpen ? "Hide" : "Edit tone"}
          </button>
        </div>
        {toneOpen && <TonePanel flash={flash} />}
      </div>

      {publishStatus && publishStatus.length > 0 && (
        <div style={{ marginBottom: 14, padding: "15px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Publish to parents</div>
          <p style={{ margin: "6px 0 0", fontSize: "0.75rem", lineHeight: 1.55, color: "#8A857C" }}>
            Approving already makes a remark visible in the portal. This sends the month&apos;s notification email — one per family, only once every student in the batch is approved.
          </p>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
            {publishStatus.map((b) => {
              const ready = b.total > 0 && b.approved === b.total;
              return (
                <div key={b.batchId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid #F1EFE9" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{b.name}</span>
                    <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>
                      {b.approved} of {b.total} approved{b.notified > 0 ? ` · ${b.notified} notified` : ""}
                    </span>
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                    {ready ? <Pill tone="approved">ready</Pill> : <Pill tone="pending">pending</Pill>}
                    <button
                      type="button"
                      onClick={() => onPublish(b.batchId, b.name)}
                      disabled={!ready || publishing === b.batchId}
                      style={{ height: 30, padding: "0 12px", background: ready ? "#0D0D0D" : "#EDEBE4", color: ready ? "#F7F6F3" : "#A8A39A", border: 0, borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: ready ? (publishing === b.batchId ? "progress" : "pointer") : "not-allowed", whiteSpace: "nowrap" }}
                    >
                      {publishing === b.batchId ? "Sending…" : "Notify parents"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pending === 0 && rows && rows.length > 0 && (
        <div style={{ padding: "72px 24px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, textAlign: "center", animation: "dashRiseIn 320ms ease-out both" }}>
          <span aria-hidden="true" style={{ width: 42, height: 42, margin: "0 auto", borderRadius: 9999, background: "#0D0D0D", color: "#FF4E18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900 }}>✓</span>
          <div style={{ marginTop: 18, fontSize: "1.125rem", fontWeight: 900, letterSpacing: "-0.03em" }}>Queue cleared.</div>
          <p style={{ margin: "9px auto 0", maxWidth: "40ch", fontSize: "0.875rem", lineHeight: 1.55, color: "#6B6660" }}>Every remark has been reviewed. Use the publish panel above to send each batch&apos;s notification email.</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(rows ?? []).map((r) => (
          <div key={r.id} style={{ padding: 18, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", animation: "dashRiseIn 340ms ease-out both" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 11 }}>
              <StudentAvatar photoUrl={photoUrls?.[r.studentId]} initials={initials(r.student)} />
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: "0.875rem", fontWeight: 700, letterSpacing: "-0.01em" }}>{r.student}</span>
                <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{r.batches.join(", ") || "Unassigned"}</span>
              </span>
              <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
                <Pill tone="neutral">{r.language}</Pill>
                <Pill tone={r.source === "ai" ? "approved" : "pending"}>{r.source === "ai" ? "AI" : "template"}</Pill>
                <Pill tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Pill>
              </span>
            </div>
            {r.lowDataReason && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
                <span style={{ padding: "5px 9px", background: "#FFF6E8", border: "1px solid #F2E1C4", borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, color: "#8A5B0B" }}>{r.lowDataReason}</span>
              </div>
            )}
            <FactChips facts={r.facts} />
            <p dir={r.language === "ur" ? "rtl" : "ltr"} style={{ margin: "14px 0 0", padding: "14px 16px", background: "#FAF9F6", borderLeft: "2px solid #FF4E18", borderRadius: "0 8px 8px 0", fontSize: "0.875rem", lineHeight: 1.6, color: "#2A2723" }}>{r.text}</p>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 14 }}>
              <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>
                {r.status === "approved" ? "Approved · visible to the parent" : "Drafted this month · not visible to parents"}
              </span>
              {r.status !== "approved" && r.status !== "rejected" && (
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => onReject(r.id)} style={{ height: 32, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}>
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => onRegen(r.id)}
                    disabled={busy[r.id]}
                    style={{ height: 32, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.75rem", fontWeight: 500, cursor: busy[r.id] ? "progress" : "pointer", opacity: busy[r.id] ? 0.7 : 1 }}
                  >
                    {busy[r.id] ? "Drafting…" : "Regenerate"}
                  </button>
                  <button type="button" onClick={() => onApprove(r.id)} style={{ height: 32, padding: "0 14px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                    Approve
                  </button>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
