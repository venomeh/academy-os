"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { initials } from "@/lib/format";
import { useToast } from "@/lib/useToast";
import Toast from "@/components/ui/Toast";
import TodayView from "@/components/teacher/TodayView";
import AttendanceView from "@/components/teacher/AttendanceView";
import MarksView from "@/components/teacher/MarksView";
import RemarksQueueView from "@/components/teacher/RemarksQueueView";

type View = "today" | "attendance" | "marks" | "remarks";

export type TeacherSession = NonNullable<FunctionReturnType<typeof api.auth.me>>;

export interface Badges {
  unmarkedAttendance: number;
  draftMarks: number;
  remarksQueue: number;
}

export default function TeacherApp({ session }: { session: TeacherSession }) {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const { message, flash } = useToast();

  const batches = useQuery(api.batches.list) ?? [];
  const remarksQueue = useQuery(api.remarks.getTeacherQueue) ?? [];
  const [view, setView] = useState<View>("today");
  const [activeBatchId, setActiveBatchId] = useState<Id<"batches"> | "">("");

  // One background probe per batch reports its marked/published status up
  // here, so the tab badges reflect every batch even while another tab is
  // the one actually rendered — each probe is just two reactive Convex
  // queries, cheap and always-live, no manual refresh plumbing needed.
  const [attendanceSaved, setAttendanceSaved] = useState<Record<string, boolean>>({});
  const [marksPublished, setMarksPublished] = useState<Record<string, boolean | null>>({});

  useEffect(() => {
    if (!activeBatchId && batches[0]) setActiveBatchId(batches[0].id);
  }, [batches, activeBatchId]);

  function goTo(v: View, batchId?: Id<"batches">) {
    if (batchId) setActiveBatchId(batchId);
    setView(v);
  }

  async function onSignOut() {
    await signOut();
    router.push("/login");
  }

  const badges: Badges = useMemo(
    () => ({
      unmarkedAttendance: batches.filter((b) => attendanceSaved[b.id] === false).length,
      draftMarks: Object.values(marksPublished).filter((p) => p === false).length,
      remarksQueue: remarksQueue.length,
    }),
    [batches, attendanceSaved, marksPublished, remarksQueue]
  );

  const tabs: { key: View; label: string; badge: number }[] = [
    { key: "today", label: "Today", badge: 0 },
    { key: "attendance", label: "Attendance", badge: badges.unmarkedAttendance },
    { key: "marks", label: "Marks", badge: badges.draftMarks },
    { key: "remarks", label: "Remarks", badge: badges.remarksQueue },
  ];

  return (
    <div style={{ minHeight: "100svh", display: "flex", flexDirection: "column" }}>
      {batches.map((b) => (
        <BatchBadgeProbe
          key={b.id}
          batchId={b.id}
          onAttendance={(saved) => setAttendanceSaved((prev) => (prev[b.id] === saved ? prev : { ...prev, [b.id]: saved }))}
          onMarks={(published) => setMarksPublished((prev) => (prev[b.id] === published ? prev : { ...prev, [b.id]: published }))}
        />
      ))}

      <header style={{ position: "sticky", top: 0, zIndex: 40, background: "#0D0D0D", color: "#F7F6F3" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", alignItems: "center", gap: 14, padding: "13px clamp(16px, 4vw, 28px)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: 4, background: "#FF4E18", display: "block" }} />
            <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: "-0.03em" }}>AcademyOS</span>
          </span>
          <span style={{ padding: "3px 7px", border: "1px solid #302E2A", borderRadius: 5, fontSize: "0.625rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9B958C" }}>
            Teacher
          </span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: "0.8125rem", fontWeight: 700 }}>{session.fullName}</span>
              <span style={{ fontSize: "0.6875rem", color: "#9B958C" }}>
                {batches.length} batch{batches.length === 1 ? "" : "es"} assigned
              </span>
            </span>
            <button
              type="button"
              onClick={onSignOut}
              title="Sign out"
              style={{ width: 30, height: 30, border: 0, borderRadius: 9999, background: "#FF4E18", color: "#0D0D0D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: 900, cursor: "pointer" }}
            >
              {initials(session.fullName)}
            </button>
          </span>
        </div>
        <nav aria-label="Sections" style={{ maxWidth: 1120, margin: "0 auto", display: "flex", gap: 4, padding: "0 clamp(16px, 4vw, 28px)", overflowX: "auto" }}>
          {tabs.map((t) => {
            const on = view === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => goTo(t.key)}
                aria-current={on}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "11px 14px",
                  background: "transparent",
                  border: 0,
                  borderBottom: `2px solid ${on ? "#FF4E18" : "transparent"}`,
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: on ? 700 : 500,
                  color: on ? "#F7F6F3" : "#9B958C",
                  whiteSpace: "nowrap",
                }}
              >
                <span>{t.label}</span>
                {t.badge > 0 && (
                  <span style={{ display: "inline-flex", padding: "1px 6px", background: "#FF4E18", color: "#0D0D0D", borderRadius: 5, fontSize: "0.625rem", fontWeight: 700 }}>
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      <main style={{ flex: "1 1 auto", padding: "clamp(18px, 3vw, 28px) clamp(16px, 4vw, 28px) 72px" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          {batches.length === 0 ? null : view === "today" ? (
            <TodayView batches={batches} goTo={goTo} remarksPending={remarksQueue.length} />
          ) : view === "attendance" ? (
            <AttendanceView batches={batches} activeBatchId={activeBatchId} setActiveBatchId={setActiveBatchId} flash={flash} />
          ) : view === "marks" ? (
            <MarksView batches={batches} activeBatchId={activeBatchId} setActiveBatchId={setActiveBatchId} flash={flash} />
          ) : (
            <RemarksQueueView flash={flash} />
          )}
        </div>
      </main>

      <Toast message={message} />
    </div>
  );
}

function BatchBadgeProbe({
  batchId,
  onAttendance,
  onMarks,
}: {
  batchId: Id<"batches">;
  onAttendance: (saved: boolean) => void;
  onMarks: (published: boolean | null) => void;
}) {
  const attendance = useQuery(api.attendance.getForBatch, { batchId });
  const latest = useQuery(api.assessments.getLatestForBatch, { batchId });

  useEffect(() => {
    if (attendance) onAttendance(attendance.saved);
  }, [attendance, onAttendance]);

  useEffect(() => {
    if (latest === undefined) return;
    onMarks(latest ? latest.published : null);
  }, [latest, onMarks]);

  return null;
}

export type { View };
