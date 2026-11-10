"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { initials } from "@/lib/format";
import StudentAvatar from "@/components/ui/StudentAvatar";
import Pill from "@/components/ui/Pill";
import { friendlyError } from "@/lib/errors";
import FactChips from "@/components/ui/FactChips";

type Lang = "en" | "ur";

export default function RemarksQueueView({ flash }: { flash: (msg: string) => void }) {
  const queue = useQuery(api.remarks.getTeacherQueue);
  const photoUrls = useQuery(api.files.getPhotoUrls, queue ? { studentIds: queue.map((q) => q.studentId) } : "skip");
  const approve = useMutation(api.remarks.approve);
  const reject = useMutation(api.remarks.reject);
  const regenerate = useAction(api.remarks.regenerate);
  const setLanguage = useAction(api.remarks.setLanguage);
  const editDraft = useMutation(api.remarks.editDraft);

  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const totalCount = useRef<number | null>(null);

  useEffect(() => {
    if (queue && totalCount.current === null) totalCount.current = queue.length;
  }, [queue]);

  if (!queue) return null;

  const reviewed = (totalCount.current ?? queue.length) - queue.length;
  const progressPct = totalCount.current ? Math.round((reviewed / totalCount.current) * 100) : 0;

  function textFor(id: string, fallback: string) {
    return drafts[id] ?? fallback;
  }

  function onTextChange(id: string, text: string) {
    setDrafts((prev) => ({ ...prev, [id]: text }));
    editDraft({ remarkId: id as Id<"remarks">, text }).catch(() => {});
  }

  async function onLanguage(id: string, lang: Lang) {
    await setLanguage({ remarkId: id as Id<"remarks">, language: lang });
  }

  async function onApprove(id: string, student: string) {
    try {
      await approve({ remarkId: id as Id<"remarks"> });
      flash(`${student}’s remark approved · visible in the parent portal now`);
    } catch (err) {
      flash(friendlyError(err, "Couldn't approve this remark."));
    }
  }

  async function onReject(id: string, student: string) {
    await reject({ remarkId: id as Id<"remarks"> });
    flash(`${student}’s draft rejected · you can write it manually`);
  }

  async function onRegen(id: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      const result = await regenerate({ remarkId: id as Id<"remarks"> });
      // Drop any local edit for this remark — textFor() prefers the local
      // copy, so leaving it would keep showing the old text and make a
      // successful regenerate look like nothing happened.
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      flash(result.source === "ai" ? "Re-drafted by the model from this month's data pack" : "The model didn't return a usable draft — fell back to the template");
    } catch (err) {
      flash(friendlyError(err, "Couldn't regenerate this remark."));
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div style={{ animation: "dashFadeIn 240ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, padding: "16px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: "1rem", fontWeight: 900, letterSpacing: "-0.025em" }}>Progress remarks review queue</span>
          <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>Drafted from attendance and test data · every number is grounded, nothing is invented</span>
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "0.75rem", color: "#8A857C", fontVariantNumeric: "tabular-nums" }}>
            {reviewed} of {totalCount.current ?? queue.length} reviewed
          </span>
          <span style={{ width: 90, height: 6, background: "#F1EFE9", borderRadius: 9999, overflow: "hidden", display: "block" }}>
            <span style={{ display: "block", height: "100%", width: `${progressPct}%`, background: "#0D0D0D", borderRadius: 9999, transition: "width 420ms cubic-bezier(0.16,1,0.3,1)" }} />
          </span>
        </span>
      </div>

      {queue.length === 0 ? (
        <div style={{ padding: "72px 24px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, textAlign: "center", animation: "dashRiseIn 320ms ease-out both" }}>
          <span aria-hidden="true" style={{ width: 42, height: 42, margin: "0 auto", borderRadius: 9999, background: "#0D0D0D", color: "#FF4E18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, animation: "dashTick 320ms cubic-bezier(0.16,1,0.3,1) both" }}>
            ✓
          </span>
          <div style={{ marginTop: 18, fontSize: "1.125rem", fontWeight: 900, letterSpacing: "-0.03em" }}>Queue cleared.</div>
          <p style={{ margin: "9px auto 0", maxWidth: "40ch", fontSize: "0.875rem", lineHeight: 1.55, color: "#6B6660" }}>
            Every remark for your batches has been reviewed. Approved ones are already in the parent portal; the month&apos;s email goes out when the admin publishes the batch.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {queue.map((q) => {
            const busy = busyIds.has(q.id);
            const text = textFor(q.id, q.text);
            return (
              <div key={q.id} style={{ padding: "19px 20px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 12, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", animation: "dashRiseIn 340ms cubic-bezier(0.16,1,0.3,1) both" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 11 }}>
                  <StudentAvatar photoUrl={photoUrls?.[q.studentId]} initials={initials(q.student)} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{q.student}</span>
                    <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{q.period}</span>
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
                    <Pill tone={busy ? "pending" : q.status === "low_data" ? "lowdata" : "draft"}>{busy ? "redrafting" : q.status === "low_data" ? "low data" : "draft"}</Pill>
                    <Pill tone={q.source === "ai" ? "approved" : "pending"}>{q.source === "ai" ? "AI" : "template"}</Pill>
                    <span style={{ display: "flex", gap: 3, padding: 3, background: "#F4F2EC", borderRadius: 8 }}>
                      {([["en", "English"], ["ur", "اردو"]] as [Lang, string][]).map(([value, label]) => {
                        const on = q.language === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => onLanguage(q.id, value)}
                            aria-pressed={on}
                            style={{ padding: "5px 10px", border: 0, borderRadius: 6, cursor: "pointer", background: on ? "#FFFFFF" : "transparent", color: on ? "#0D0D0D" : "#8A857C", fontSize: "0.75rem", fontWeight: on ? 700 : 500, boxShadow: on ? "0 1px 2px rgba(13,13,13,0.12)" : "none" }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </span>
                  </span>
                </div>
                {q.lowDataReason && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
                    <span style={{ padding: "5px 9px", background: "#FFF6E8", border: "1px solid #F2E1C4", borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, color: "#8A5B0B" }}>{q.lowDataReason}</span>
                  </div>
                )}
                <FactChips facts={q.facts} />
                <textarea
                  aria-label={`Remark for ${q.student}`}
                  value={text}
                  onChange={(e) => onTextChange(q.id, e.target.value)}
                  rows={5}
                  disabled={busy}
                  style={{ width: "100%", marginTop: 14, padding: "14px 16px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderLeft: "2px solid #FF4E18", borderRadius: "0 9px 9px 0", fontSize: "0.875rem", lineHeight: 1.6, color: "#2A2723", resize: "vertical", opacity: busy ? 0.5 : 1 }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <span style={{ flex: "1 1 180px", fontSize: "0.75rem", color: "#8A857C" }}>
                    {q.language === "ur" ? "اردو" : "English"} · not visible to parents until approved
                  </span>
                  <button
                    type="button"
                    onClick={() => onReject(q.id, q.student)}
                    style={{ height: 36, padding: "0 13px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 500, cursor: "pointer" }}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => onRegen(q.id)}
                    disabled={busy}
                    style={{ height: 36, padding: "0 13px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 500, cursor: busy ? "progress" : "pointer", opacity: busy ? 0.7 : 1 }}
                  >
                    {busy ? "Drafting…" : "Regenerate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onApprove(q.id, q.student)}
                    disabled={busy}
                    style={{ height: 36, padding: "0 17px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 8, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
                  >
                    Approve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
