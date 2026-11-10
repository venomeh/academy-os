"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fmt, initials } from "@/lib/format";
import StudentAvatar from "@/components/ui/StudentAvatar";
import Pill from "@/components/ui/Pill";
import type { Tone } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function kindTone(kind: string): Tone {
  if (kind === "payment") return "paid";
  if (kind === "fine") return "unpaid";
  if (kind === "discount") return "partial";
  return "pending";
}

const CURRENT_PERIOD = new Date().toISOString().slice(0, 7);

export default function StudentDrawer({
  studentId,
  onClose,
  onPay,
  onAdjust,
  onStatement,
  flash,
}: {
  studentId: Id<"students">;
  onClose: () => void;
  onPay: (voucherId: Id<"vouchers">) => void;
  onAdjust: (voucherId: Id<"vouchers">) => void;
  onStatement: (guardianId: Id<"guardians">) => void;
  flash?: (message: string) => void;
}) {
  const detail = useQuery(api.students.getDetail, { studentId });
  const vouchers = useQuery(api.vouchers.list, { period: CURRENT_PERIOD });
  const allBatches = useQuery(api.batches.list);
  const photoUrl = useQuery(api.files.getPhotoUrl, { studentId });
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const savePhoto = useMutation(api.files.savePhoto);
  const markLeft = useMutation(api.students.markLeft);
  const reactivateStudent = useMutation(api.students.reactivate);
  const clearFeeReview = useMutation(api.students.clearFeeReview);
  const addEnrollment = useMutation(api.students.addEnrollment);
  const endEnrollment = useMutation(api.students.endEnrollment);
  const setFeeOverride = useMutation(api.students.setFeeOverride);
  const [uploading, setUploading] = useState(false);
  const [addBatchId, setAddBatchId] = useState<Id<"batches"> | "">("");
  const [editingFee, setEditingFee] = useState(false);
  const [feeValue, setFeeValue] = useState("");
  const [feeReason, setFeeReason] = useState("");
  const voucher = vouchers?.find((v) => v.studentId === studentId) ?? null;
  const balance = voucher?.outstanding ?? 0;

  function startEditFee() {
    setFeeValue(detail?.feeOverride ? String(detail.feeOverride) : "");
    setFeeReason(detail?.overrideReason ?? "");
    setEditingFee(true);
  }

  async function onSaveFee() {
    if (feeValue && !feeReason.trim()) {
      flash?.("A reason is required for a custom fee.");
      return;
    }
    await setFeeOverride({ studentId, feeOverride: feeValue ? Number(feeValue) : undefined, overrideReason: feeValue ? feeReason.trim() : undefined });
    setEditingFee(false);
    flash?.(feeValue ? "Custom fee saved." : "Custom fee removed.");
  }

  async function onMarkLeft() {
    await markLeft({ studentId });
    flash?.(`${detail?.name} marked left. Future vouchers stop; history is preserved.`);
    onClose();
  }

  async function onReactivate() {
    await reactivateStudent({ studentId });
    flash?.(`${detail?.name} reactivated.`);
  }

  async function onAddToBatch() {
    if (!addBatchId) return;
    await addEnrollment({ studentId, batchId: addBatchId, startDate: new Date().toISOString().slice(0, 10) });
    setAddBatchId("");
    flash?.("Added to batch.");
  }

  async function onEndEnrollment(enrollmentId: Id<"enrollments">, batchName: string) {
    await endEnrollment({ enrollmentId, endDate: new Date().toISOString().slice(0, 10) });
    flash?.(`Removed from ${batchName}.`);
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      flash?.("Please choose an image file.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      flash?.("Image must be under 5MB.");
      return;
    }
    setUploading(true);
    try {
      const postUrl = await generateUploadUrl();
      const res = await fetch(postUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("Upload failed — please try again.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await savePhoto({ studentId, storageId });
      flash?.("Photo updated.");
    } catch (err) {
      flash?.(friendlyError(err, "Could not upload photo."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(13,13,13,0.32)", animation: "dashFadeIn 200ms ease-out both" }} />
      <aside
        aria-label="Student detail"
        style={{ position: "relative", width: "min(460px, 100%)", height: "100%", overflowY: "auto", background: "#F7F6F3", borderLeft: "1px solid #E8E5DE", boxShadow: "-20px 0 44px rgba(13,13,13,0.14)", animation: "dashSlideOver 300ms cubic-bezier(0.16,1,0.3,1) both" }}
      >
        {detail && (
          <>
            <div style={{ position: "sticky", top: 0, display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", background: "rgba(247,246,243,0.92)", backdropFilter: "blur(8px)", borderBottom: "1px solid #E8E5DE" }}>
              <label
                title="Change photo"
                style={{ position: "relative", display: "block", width: 36, height: 36, flex: "none", borderRadius: 9999, cursor: "pointer" }}
              >
                <input type="file" accept="image/*" onChange={handlePhotoChange} disabled={uploading} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} />
                <span style={{ display: "block", opacity: uploading ? 0.5 : 1 }}>
                  <StudentAvatar photoUrl={photoUrl} initials={initials(detail.name)} tone="#FFE9E1" size={36} />
                </span>
                <span
                  aria-hidden="true"
                  style={{ position: "absolute", right: -2, bottom: -2, width: 15, height: 15, borderRadius: 9999, background: "#0D0D0D", border: "2px solid #F7F6F3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#F7F6F3" }}
                >
                  {uploading ? "…" : "✎"}
                </span>
              </label>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: "1rem", fontWeight: 900, letterSpacing: "-0.025em" }}>{detail.name}</span>
                  {detail.status === "left" && <Pill tone="flagged">left</Pill>}
                </span>
                <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>{detail.batches.map((b) => b.name).join(", ") || "Unassigned"}{detail.grade ? ` · Grade ${detail.grade}` : ""}</span>
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{ marginLeft: "auto", width: 32, height: 32, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, cursor: "pointer", fontSize: 15, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              {detail.needsFeeReview && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "13px 15px", background: "#FFF6E8", border: "1px solid #F2E1C4", borderRadius: 10 }}>
                  <span style={{ flex: "1 1 200px", fontSize: "0.8125rem", lineHeight: 1.5, color: "#8A5B0B" }}>
                    Enrolled mid-month — review the first voucher. {voucher ? "Post a proration adjustment, or clear if the full month is right." : "The flag clears when you post an adjustment on their first voucher."}
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {voucher && (
                      <button
                        type="button"
                        onClick={() => onAdjust(voucher.id)}
                        style={{ height: 30, padding: "0 11px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        Adjust voucher
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => clearFeeReview({ studentId }).then(() => flash?.("Fee review cleared — full month stands."))}
                      style={{ height: 30, padding: "0 11px", background: "#FFFFFF", border: "1px solid #F2E1C4", borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", color: "#8A5B0B", whiteSpace: "nowrap" }}
                    >
                      Clear
                    </button>
                  </span>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ padding: "15px 16px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 10 }}>
                  <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Balance</div>
                  <div style={{ marginTop: 9, fontSize: "1.375rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{balance > 0 ? fmt(balance) : "—"}</div>
                </div>
                <div style={{ padding: "15px 16px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 10 }}>
                  <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Attendance</div>
                  <div style={{ marginTop: 9, fontSize: "1.375rem", fontWeight: 900, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{detail.attendancePct}%</div>
                </div>
              </div>

              <div style={{ padding: "17px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 10 }}>
                <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Family</div>
                <div style={{ marginTop: 12, fontSize: "0.875rem", fontWeight: 700 }}>{detail.guardian?.name ?? "—"}</div>
                <div style={{ marginTop: 4, fontSize: "0.8125rem", color: "#6B6660" }}>{detail.guardian?.phone ?? "No phone on file"} · {detail.guardian?.languagePref === "ur" ? "اردو" : "English"}</div>
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F1EFE9", fontSize: "0.8125rem", color: "#4A463F" }}>
                  {detail.siblingCount > 1 ? `${detail.siblingCount} children enrolled with this family` : "Only child enrolled with this family"}
                </div>
              </div>

              <div style={{ padding: "17px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 10 }}>
                <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Batches</div>
                <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
                  {detail.batches.map((b) => (
                    <div key={b.enrollmentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid #F1EFE9" }}>
                      <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{b.name}</span>
                      <button
                        type="button"
                        onClick={() => onEndEnrollment(b.enrollmentId, b.name)}
                        style={{ marginLeft: "auto", height: 28, padding: "0 10px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, color: "#B4231F", cursor: "pointer" }}
                      >
                        End
                      </button>
                    </div>
                  ))}
                  {detail.batches.length === 0 && <div style={{ padding: "8px 0", fontSize: "0.75rem", color: "#A8A39A" }}>Not enrolled in any batch.</div>}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <select
                    aria-label="Add to batch"
                    value={addBatchId}
                    onChange={(e) => setAddBatchId(e.target.value as Id<"batches">)}
                    style={{ flex: 1, height: 34, padding: "0 8px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.75rem" }}
                  >
                    <option value="">Add to batch…</option>
                    {(allBatches ?? [])
                      .filter((b) => !detail.batches.some((db) => db.id === b.id))
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={onAddToBatch}
                    disabled={!addBatchId}
                    style={{ height: 34, padding: "0 12px", background: addBatchId ? "#0D0D0D" : "#EDEBE4", color: addBatchId ? "#F7F6F3" : "#A8A39A", border: 0, borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: addBatchId ? "pointer" : "not-allowed" }}
                  >
                    Add
                  </button>
                </div>
              </div>

              <div style={{ padding: "17px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Custom fee</div>
                  {!editingFee && (
                    <button type="button" onClick={startEditFee} style={{ marginLeft: "auto", background: "none", border: 0, padding: 0, fontSize: "0.75rem", fontWeight: 500, color: "#6B6660", textDecoration: "underline", cursor: "pointer" }}>
                      {detail.feeOverride ? "Edit" : "Set override"}
                    </button>
                  )}
                </div>
                {!editingFee ? (
                  <div style={{ marginTop: 10, fontSize: "0.8125rem", color: "#4A463F" }}>
                    {detail.feeOverride ? (
                      <>
                        {fmt(detail.feeOverride)}/mo · <span style={{ color: "#8A857C" }}>{detail.overrideReason}</span>
                      </>
                    ) : (
                      <span style={{ color: "#A8A39A" }}>Batch default tuition applies.</span>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Monthly fee (blank = batch default)"
                      value={feeValue}
                      onChange={(e) => setFeeValue(e.target.value.replace(/[^0-9]/g, ""))}
                      style={{ height: 34, padding: "0 10px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.8125rem" }}
                    />
                    <input
                      type="text"
                      placeholder="Reason (required if set)"
                      value={feeReason}
                      onChange={(e) => setFeeReason(e.target.value)}
                      style={{ height: 34, padding: "0 10px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.8125rem" }}
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={() => setEditingFee(false)} style={{ flex: 1, height: 32, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                        Cancel
                      </button>
                      <button type="button" onClick={onSaveFee} style={{ flex: 1, height: 32, background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ padding: "17px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Recent ledger</div>
                  {detail.guardian && (
                    <button type="button" onClick={() => onStatement(detail.guardian!.id)} style={{ marginLeft: "auto", background: "none", border: 0, padding: 0, fontSize: "0.75rem", fontWeight: 500, color: "#6B6660", textDecoration: "underline", cursor: "pointer" }}>
                      Full family statement
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", marginTop: 6 }}>
                  {detail.recentLedger.map((l, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid #F1EFE9" }}>
                      <Pill tone={kindTone(l.kind)}>{l.kind}</Pill>
                      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: "0.8125rem" }}>{l.reason ?? l.kind}</span>
                        <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{new Date(l.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}</span>
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: "0.875rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{l.amount > 0 ? "+" : "−"}{fmt(l.amount)}</span>
                    </div>
                  ))}
                  {detail.recentLedger.length === 0 && (
                    <div style={{ padding: "16px 0", textAlign: "center", fontSize: "0.75rem", color: "#A8A39A" }}>No ledger activity yet.</div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => voucher && onPay(voucher.id)}
                  disabled={!voucher || balance <= 0}
                  style={{ flex: "2 1 160px", height: 44, background: !voucher || balance <= 0 ? "#EDEBE4" : "#0D0D0D", color: !voucher || balance <= 0 ? "#A8A39A" : "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.875rem", fontWeight: 700, cursor: !voucher || balance <= 0 ? "not-allowed" : "pointer" }}
                >
                  Record a cash payment
                </button>
                <button
                  type="button"
                  onClick={() => voucher && onAdjust(voucher.id)}
                  disabled={!voucher}
                  title={voucher ? "Post a discount or correction on this month's voucher" : "No voucher this period"}
                  style={{ flex: "1 1 100px", height: 44, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.875rem", fontWeight: 700, cursor: voucher ? "pointer" : "not-allowed", opacity: voucher ? 1 : 0.5 }}
                >
                  Adjust
                </button>
              </div>

              {detail.status === "left" ? (
                <button
                  type="button"
                  onClick={onReactivate}
                  style={{ height: 44, background: "#FFFFFF", color: "#0B7A4B", border: "1px solid #D3E7DC", borderRadius: 9, fontSize: "0.875rem", fontWeight: 700, cursor: "pointer" }}
                >
                  Reactivate student
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onMarkLeft}
                  style={{ height: 44, background: "#FFFFFF", color: "#B4231F", border: "1px solid #F6CFCC", borderRadius: 9, fontSize: "0.875rem", fontWeight: 700, cursor: "pointer" }}
                >
                  Mark as left
                </button>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
