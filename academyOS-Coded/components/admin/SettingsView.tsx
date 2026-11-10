"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import Pill from "@/components/ui/Pill";
import { friendlyError } from "@/lib/errors";

type FeeRulesDoc = Doc<"feeRules">;
type FeeRulesPatch = Partial<Pick<FeeRulesDoc, "siblingDiscountPct" | "lateFineType" | "lateFineValue" | "lateFineGraceDays" | "generationDay" | "dueDay" | "admissionFee">>;
type NumericKey = Exclude<keyof FeeRulesPatch, "lateFineType">;

const JOB_LABEL: Record<string, string> = {
  "generate-vouchers": "Generate vouchers",
  "accrue-late-fines": "Accrue late fines",
  "reminder-sweep": "Reminder sweep",
  "draft-remarks": "Draft remarks",
};

const JOB_SCHEDULE: Record<string, string> = {
  "generate-vouchers": "daily · 06:00 PKT",
  "accrue-late-fines": "daily · 08:00 PKT",
  "reminder-sweep": "daily · 09:00 PKT",
  "draft-remarks": "daily · 02:00 PKT",
};

const JOBS = ["generate-vouchers", "accrue-late-fines", "reminder-sweep", "draft-remarks"] as const;
type JobName = (typeof JOBS)[number];

function summarizeResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;
  return Object.entries(r)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

export default function SettingsView({ flash }: { flash: (msg: string) => void }) {
  const rules = useQuery(api.academy.getFeeRules);
  const jobs = useQuery(api.academy.listScheduledJobRuns, {});
  const updateFeeRules = useMutation(api.academy.updateFeeRules);

  const [draft, setDraft] = useState<FeeRulesPatch>({});
  const [saved, setSaved] = useState(false);

  const generateVouchers = useAction(api.vouchers.generateVouchers);
  const accrueLateFines = useAction(api.lateFines.accrue);
  const runReminderSweep = useAction(api.reminders.sweep);
  const draftRemarks = useAction(api.remarks.draftForPeriod);
  const [busyJob, setBusyJob] = useState<JobName | "">("");


  const merged: FeeRulesDoc | null = rules ? { ...rules, ...draft } : null;

  function patch<K extends keyof FeeRulesPatch>(key: K, value: FeeRulesPatch[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  }

  async function onSave() {
    if (Object.keys(draft).length === 0) return;
    await updateFeeRules(draft);
    setDraft({});
    setSaved(true);
    flash("Fee rules saved · issued vouchers unchanged");
  }


  /** Same entry points the crons call — running one by hand is how you exercise the automation without waiting for its scheduled hour. */
  async function onRunJob(job: JobName) {
    setBusyJob(job);
    try {
      const result =
        job === "generate-vouchers"
          ? await generateVouchers({})
          : job === "accrue-late-fines"
            ? await accrueLateFines({})
            : job === "reminder-sweep"
              ? await runReminderSweep({})
              : await draftRemarks({ force: true });
      flash(`${JOB_LABEL[job]}: ${summarizeResult(result)}`);
    } catch (err) {
      flash(friendlyError(err, `${JOB_LABEL[job]} failed.`));
    } finally {
      setBusyJob("");
    }
  }




  const fineIsPct = merged?.lateFineType === "percentage";
  const fields: { key: NumericKey; label: string; unit: string }[] = [
    { key: "siblingDiscountPct", label: "Sibling discount", unit: "%" },
    { key: "lateFineValue", label: fineIsPct ? "Late fine · % of voucher" : "Late fine · flat amount", unit: fineIsPct ? "%" : "PKR" },
    { key: "lateFineGraceDays", label: "Late fine grace", unit: "days" },
    { key: "admissionFee", label: "Admission fee", unit: "PKR" },
    { key: "generationDay", label: "Voucher generation day", unit: "of mo" },
    { key: "dueDay", label: "Due day", unit: "of mo" },
  ];

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
      <div style={{ padding: 20, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
        <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Fee rules</h2>
        <p style={{ margin: "8px 0 0", fontSize: "0.75rem", lineHeight: 1.55, color: "#8A857C" }}>Every voucher snapshots these values at generation. Changing them never mutates an issued voucher.</p>
        {merged && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ flex: "1 1 auto", fontSize: "0.8125rem", fontWeight: 500, color: "#4A463F" }}>Late fine type</span>
              <span role="group" aria-label="Late fine type" style={{ display: "flex", gap: 3, padding: 3, background: "#F4F2EC", borderRadius: 8 }}>
                {(
                  [
                    ["flat", "Flat PKR"],
                    ["percentage", "% of voucher"],
                  ] as ["flat" | "percentage", string][]
                ).map(([value, label]) => {
                  const on = merged.lateFineType === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => patch("lateFineType", value)}
                      aria-pressed={on}
                      style={{ height: 30, padding: "0 11px", border: 0, borderRadius: 6, cursor: "pointer", background: on ? "#FFFFFF" : "transparent", color: on ? "#0D0D0D" : "#8A857C", fontSize: "0.75rem", fontWeight: on ? 700 : 500, boxShadow: on ? "0 1px 2px rgba(13,13,13,0.12)" : "none" }}
                    >
                      {label}
                    </button>
                  );
                })}
              </span>
            </div>
            {fields.map((f) => (
              <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ flex: "1 1 auto", fontSize: "0.8125rem", fontWeight: 500, color: "#4A463F" }}>{f.label}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={merged[f.key] as number}
                  onChange={(e) => patch(f.key, Number(e.target.value.replace(/[^0-9]/g, "")))}
                  aria-label={f.label}
                  style={{ width: 116, height: 36, padding: "0 11px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, fontSize: "0.875rem", fontWeight: 500, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                />
                <span style={{ width: 38, fontSize: "0.75rem", color: "#A8A39A" }}>{f.unit}</span>
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={Object.keys(draft).length === 0}
          style={{ width: "100%", height: 42, marginTop: 18, background: saved ? "#F1F7F3" : Object.keys(draft).length === 0 ? "#EDEBE4" : "#0D0D0D", color: saved ? "#0B7A4B" : Object.keys(draft).length === 0 ? "#A8A39A" : "#F7F6F3", border: saved ? "1px solid #D3E7DC" : "0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: Object.keys(draft).length === 0 ? "not-allowed" : "pointer" }}
        >
          {saved ? "Saved" : "Save fee rules"}
        </button>
      </div>

      <div style={{ padding: 20, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
        <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Scheduled jobs</h2>
        <p style={{ margin: "8px 0 0", fontSize: "0.75rem", lineHeight: 1.55, color: "#8A857C" }}>Driven by Convex crons, not the app. Run one by hand to test it without waiting for its hour — same entry point, same logging.</p>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
          {JOBS.map((job) => {
            const last = (jobs ?? []).find((j) => j.jobName === job);
            const busy = busyJob === job;
            return (
              <div key={job} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0", borderTop: "1px solid #F1EFE9" }}>
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{JOB_LABEL[job]}</span>
                  <span style={{ fontSize: "0.6875rem", color: "#A8A39A", fontFamily: "ui-monospace, Menlo, monospace" }}>{JOB_SCHEDULE[job]}</span>
                  {last ? (
                    <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>
                      {summarizeResult(last.result)} · {new Date(last._creationTime).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </span>
                  ) : (
                    <span style={{ fontSize: "0.6875rem", color: "#C8C3B9" }}>never run</span>
                  )}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                  {last && <Pill tone="approved">ran</Pill>}
                  <button
                    type="button"
                    onClick={() => onRunJob(job)}
                    disabled={busy}
                    style={{ height: 30, padding: "0 11px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.6875rem", fontWeight: 700, cursor: busy ? "progress" : "pointer", whiteSpace: "nowrap" }}
                  >
                    {busy ? "Running…" : "Run now"}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
