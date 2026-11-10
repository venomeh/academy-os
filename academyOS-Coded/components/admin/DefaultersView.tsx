"use client";

import { useState } from "react";
import { useMutation, useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fmt, initials } from "@/lib/format";
import Avatar from "@/components/ui/Avatar";
import { BUCKET_LABEL, BUCKET_COLOR, type AgingBucketKey } from "@/components/admin/types";
import { friendlyError } from "@/lib/errors";

type Bucket = AgingBucketKey | "all";

export default function DefaultersView({
  bucket,
  onBucket,
  onStatement,
  flash,
}: {
  bucket: Bucket;
  onBucket: (b: Bucket) => void;
  onStatement: (guardianId: Id<"guardians">) => void;
  flash: (msg: string) => void;
}) {
  const aging = useQuery(api.ledger.getAgingBuckets);
  const rows = useQuery(api.ledger.getDefaulters, bucket === "all" ? {} : { bucket });
  const togglePause = useMutation(api.ledger.togglePause);
  const sendReminderNow = useAction(api.reminders.sendNow);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // §10 "pause reminders per family with a reason" — the reason is asked
  // for inline, right on the row, so it can't be skipped.
  const [pausing, setPausing] = useState<Id<"guardians"> | null>(null);
  const [reason, setReason] = useState("");

  async function onResume(guardianId: Id<"guardians">) {
    setBusy((b) => ({ ...b, [guardianId]: true }));
    await togglePause({ guardianId });
    setBusy((b) => ({ ...b, [guardianId]: false }));
    flash("Reminders resumed · the sequence picks up from the current bucket");
  }

  async function onConfirmPause(guardianId: Id<"guardians">) {
    if (!reason.trim()) return;
    setBusy((b) => ({ ...b, [guardianId]: true }));
    try {
      await togglePause({ guardianId, reason: reason.trim() });
      flash(`Reminders paused · ${reason.trim()}`);
      setPausing(null);
      setReason("");
    } catch (err) {
      flash(friendlyError(err, "Couldn't pause reminders."));
    } finally {
      setBusy((b) => ({ ...b, [guardianId]: false }));
    }
  }

  async function onRemind(family: string, guardianId: Id<"guardians">) {
    try {
      const result = await sendReminderNow({ guardianId });
      flash(result.sent > 0 ? `Reminder sent to ${family} · email` : `${family} has nothing due for a reminder right now`);
    } catch (err) {
      flash(friendlyError(err, "Couldn't send the reminder."));
    }
  }

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 14 }}>
        {(aging ?? []).map((a) => {
          const on = bucket === a.bucket;
          return (
            <button
              key={a.bucket}
              type="button"
              onClick={() => onBucket(on ? "all" : a.bucket)}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "15px 17px", background: "#FFFFFF", border: `1px solid ${on ? "#FF4E18" : "#E8E5DE"}`, borderRadius: 11, boxShadow: on ? "0 0 0 3px rgba(255,78,24,0.14)" : "0 1px 2px rgba(13,13,13,0.04)", cursor: "pointer", textAlign: "left" }}
            >
              <span style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>{BUCKET_LABEL[a.bucket]}</span>
              <span style={{ marginTop: 10, fontSize: "1.375rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{fmt(a.amount)}</span>
              <span style={{ marginTop: 6, fontSize: "0.75rem", color: "#8A857C" }}>{a.families} {a.families === 1 ? "family" : "families"}</span>
            </button>
          );
        })}
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "15px 18px", borderBottom: "1px solid #E8E5DE" }}>
          <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{bucket === "all" ? "All defaulters" : `${BUCKET_LABEL[bucket]} bucket`}</h2>
          <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>{rows?.length ?? 0} families · reminders follow the sequence automatically</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {(rows ?? []).map((d) => (
            <div key={d.guardianId} style={{ borderBottom: "1px solid #F1EFE9" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, padding: "15px 18px" }}>
                <Avatar initials={initials(d.family)} tone="#FFE9E1" />
                <button
                  type="button"
                  onClick={() => onStatement(d.guardianId)}
                  title="Open the family statement"
                  style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ fontSize: "0.875rem", fontWeight: 700, letterSpacing: "-0.01em", textDecoration: "underline", textDecorationColor: "#DDD9D0", textUnderlineOffset: 3 }}>{d.family}</span>
                  <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>{d.children}</span>
                  {d.paused && <span style={{ fontSize: "0.6875rem", color: "#8A5B0B" }}>Paused · {d.pausedReason ?? "no reason recorded"}</span>}
                </button>
                <span style={{ fontSize: "0.9375rem", fontWeight: 900, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{fmt(d.amount)}</span>
                <span style={{ padding: "4px 9px", background: d.bucket === "current" ? "#FAF9F6" : d.bucket === "7d_gentle" ? "#FFF6E8" : "#FDECEC", border: `1px solid ${d.bucket === "current" ? "#E8E5DE" : d.bucket === "7d_gentle" ? "#F2E1C4" : "#F6CFCC"}`, borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: BUCKET_COLOR[d.bucket] }}>
                  {BUCKET_LABEL[d.bucket]}
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => onStatement(d.guardianId)}
                    style={{ height: 32, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}
                  >
                    Statement
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemind(d.family, d.guardianId)}
                    disabled={d.paused}
                    title={d.paused ? "Resume reminders first" : undefined}
                    style={{ height: 32, padding: "0 12px", background: d.paused ? "#EDEBE4" : "#0D0D0D", color: d.paused ? "#A8A39A" : "#F7F6F3", border: 0, borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: d.paused ? "not-allowed" : "pointer" }}
                  >
                    Send reminder
                  </button>
                  <button
                    type="button"
                    onClick={() => (d.paused ? onResume(d.guardianId) : (setPausing(pausing === d.guardianId ? null : d.guardianId), setReason("")))}
                    disabled={busy[d.guardianId]}
                    style={{ height: 32, padding: "0 12px", background: d.paused ? "#FFF6E8" : "#FFFFFF", border: `1px solid ${d.paused ? "#F2E1C4" : "#DDD9D0"}`, borderRadius: 7, fontSize: "0.75rem", fontWeight: 500, color: d.paused ? "#8A5B0B" : "#4A463F", cursor: "pointer" }}
                  >
                    {d.paused ? "Resume" : "Pause"}
                  </button>
                </span>
              </div>
              {pausing === d.guardianId && !d.paused && (
                <form
                  onSubmit={(e) => { e.preventDefault(); onConfirmPause(d.guardianId); }}
                  style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "0 18px 14px 66px" }}
                >
                  <input
                    autoFocus
                    aria-label="Reason for pausing reminders"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why? e.g. installment plan agreed till 25th"
                    style={{ flex: "1 1 260px", height: 36, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, fontSize: "0.8125rem" }}
                  />
                  <button type="button" onClick={() => setPausing(null)} style={{ height: 36, padding: "0 12px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={!reason.trim() || busy[d.guardianId]} style={{ height: 36, padding: "0 14px", background: reason.trim() ? "#0D0D0D" : "#EDEBE4", color: reason.trim() ? "#F7F6F3" : "#A8A39A", border: 0, borderRadius: 8, fontSize: "0.75rem", fontWeight: 700, cursor: reason.trim() ? "pointer" : "not-allowed" }}>
                    Pause reminders
                  </button>
                  <span style={{ flex: "1 1 100%", fontSize: "0.6875rem", color: "#8A857C" }}>The reason is stored on the family record and shown on their statement. Nothing goes out until you resume.</span>
                </form>
              )}
            </div>
          ))}
          {rows && rows.length === 0 && (
            <div style={{ padding: "56px 20px", textAlign: "center" }}>
              <div style={{ fontSize: "0.9375rem", fontWeight: 700 }}>Nothing in this bucket.</div>
              <p style={{ margin: "8px 0 0", fontSize: "0.8125rem", color: "#8A857C" }}>No families are overdue at this stage.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
