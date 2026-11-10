"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { fmt, initials } from "@/lib/format";
import { useToast } from "@/lib/useToast";
import Toast from "@/components/ui/Toast";
import StudentAvatar from "@/components/ui/StudentAvatar";
import DuesView from "@/components/parent/DuesView";
import AttendanceView from "@/components/parent/AttendanceView";
import ResultsView from "@/components/parent/ResultsView";
import RemarksView from "@/components/parent/RemarksView";
import ChatWidget from "@/components/parent/ChatWidget";
import PayModal from "@/components/parent/PayModal";

export type Session = NonNullable<FunctionReturnType<typeof api.auth.me>>;
export type Child = FunctionReturnType<typeof api.students.listForGuardian>[number];

type ViewKey = "dues" | "attendance" | "results" | "remarks";
type Lang = "English" | "Urdu";

const TABS: { key: ViewKey; en: string; ur: string }[] = [
  { key: "dues", en: "Dues", ur: "واجبات" },
  { key: "attendance", en: "Attendance", ur: "حاضری" },
  { key: "results", en: "Results", ur: "نتائج" },
  { key: "remarks", en: "Remarks", ur: "ریمارکس" },
];

export default function ParentApp({ session }: { session: Session }) {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const { message, flash } = useToast();

  const children = useQuery(api.students.listForGuardian);
  const photoUrls = useQuery(api.files.getPhotoUrls, children ? { studentIds: children.map((c) => c.id) } : "skip");

  const [activeChildId, setActiveChildId] = useState<Id<"students"> | null>(null);
  const [view, setView] = useState<ViewKey>("dues");
  const [lang, setLang] = useState<Lang>("English");
  const [chatOpen, setChatOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const urdu = lang === "Urdu";
  const familyTotal = (children ?? []).reduce((s, c) => s + c.due, 0);
  const effectiveChildId = activeChildId ?? children?.[0]?.id ?? null;
  const activeChild = (children ?? []).find((c) => c.id === effectiveChildId);

  async function onSignOut() {
    await signOut();
    router.push("/login");
  }

  function onToggleLang(next: Lang) {
    setLang(next);
    flash(next === "Urdu" ? "اردو منتخب · reminders and remarks will arrive in Urdu" : "English selected");
  }

  if (children === undefined) return null;

  return (
    <div style={{ minHeight: "100svh", display: "flex", flexDirection: "column" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 40, background: "#0D0D0D", color: "#F7F6F3" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", alignItems: "center", gap: 12, padding: "13px clamp(14px, 4vw, 24px)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: 4, background: "#FF4E18", display: "block" }} />
            <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: "-0.03em" }}>AcademyOS</span>
          </span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "flex", gap: 3, padding: 3, background: "#1C1B19", borderRadius: 8 }}>
              {(["English", "Urdu"] as Lang[]).map((l) => {
                const on = lang === l;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => onToggleLang(l)}
                    aria-pressed={on}
                    style={{
                      padding: "5px 10px",
                      border: 0,
                      borderRadius: 6,
                      cursor: "pointer",
                      background: on ? "#FF4E18" : "transparent",
                      color: on ? "#0D0D0D" : "#9B958C",
                      fontSize: "0.75rem",
                      fontWeight: on ? 900 : 500,
                    }}
                  >
                    {l === "English" ? "EN" : "اردو"}
                  </button>
                );
              })}
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
      </header>

      <main style={{ flex: "1 1 auto", padding: "clamp(16px, 3vw, 26px) clamp(14px, 4vw, 24px) 120px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: "clamp(1.375rem, 5vw, 1.75rem)", fontWeight: 900, letterSpacing: "-0.04em" }}>
              {urdu ? "السلام علیکم" : "Assalam-o-alaikum"}
            </h1>
            <span style={{ fontSize: "0.8125rem", color: "#8A857C" }}>
              {session.fullName} · {children.length} {children.length === 1 ? "child" : "children"} enrolled
            </span>
          </div>

          <div style={{ marginTop: 16, padding: 20, background: "#0D0D0D", color: "#F7F6F3", borderRadius: 14, animation: "dashRiseIn 400ms cubic-bezier(0.16,1,0.3,1) both" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 16 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8A857C" }}>Family balance due</span>
                <span style={{ fontSize: "clamp(2.25rem, 9vw, 3rem)", fontWeight: 900, letterSpacing: "-0.045em", lineHeight: 0.9, fontVariantNumeric: "tabular-nums", color: "#FF4E18" }}>{fmt(familyTotal)}</span>
                <span style={{ fontSize: "0.8125rem", color: "#B9B4AB" }}>
                  {children.length} {children.length === 1 ? "child" : "children"} enrolled
                </span>
              </span>
              <button
                type="button"
                onClick={() => setPayOpen(true)}
                disabled={familyTotal <= 0}
                style={{
                  marginLeft: "auto",
                  height: 50,
                  padding: "0 26px",
                  background: familyTotal > 0 ? "#FF4E18" : "#302E2A",
                  color: familyTotal > 0 ? "#0D0D0D" : "#6E6A63",
                  border: 0,
                  borderRadius: 10,
                  fontSize: "0.9375rem",
                  fontWeight: 900,
                  letterSpacing: "-0.01em",
                  cursor: familyTotal > 0 ? "pointer" : "not-allowed",
                }}
              >
                {familyTotal > 0 ? `Pay ${fmt(familyTotal)}` : "All settled"}
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20, paddingTop: 18, borderTop: "1px solid #262421" }}>
              {children.map((c) => {
                const on = c.id === effectiveChildId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveChildId(c.id)}
                    style={{
                      flex: "1 1 220px",
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "12px 14px",
                      background: on ? "#1C1B19" : "transparent",
                      border: `1px solid ${on ? "#FF4E18" : "#262421"}`,
                      borderRadius: 11,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <StudentAvatar
                      photoUrl={photoUrls?.[c.id]}
                      initials={initials(c.name)}
                      tone={on ? "#FF4E18" : "#262421"}
                      textColor={on ? "#0D0D0D" : "#B9B4AB"}
                      size={34}
                    />
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
                      <span style={{ fontSize: "0.875rem", fontWeight: 700, letterSpacing: "-0.01em" }}>{c.name}</span>
                      <span style={{ fontSize: "0.6875rem", color: on ? "#B9B4AB" : "#6E6A63", fontVariantNumeric: "tabular-nums" }}>
                        {fmt(c.due)} due · {c.attendancePct}% attendance
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <nav aria-label="Sections" style={{ display: "flex", gap: 4, margin: "18px 0 14px", padding: 4, background: "#EDEBE4", borderRadius: 10, overflowX: "auto" }}>
            {TABS.map((t) => {
              const on = view === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setView(t.key)}
                  aria-current={on}
                  style={{
                    flex: "1 1 auto",
                    padding: "10px 12px",
                    border: 0,
                    borderRadius: 7,
                    cursor: "pointer",
                    background: on ? "#FFFFFF" : "transparent",
                    color: on ? "#0D0D0D" : "#6B6660",
                    fontSize: "0.875rem",
                    fontWeight: on ? 700 : 500,
                    whiteSpace: "nowrap",
                    boxShadow: on ? "0 1px 3px rgba(13,13,13,0.10)" : "none",
                  }}
                >
                  {urdu ? t.ur : t.en}
                </button>
              );
            })}
          </nav>

          {activeChild && view === "dues" && <DuesView child={activeChild} onPay={() => setPayOpen(true)} flash={flash} />}
          {activeChild && view === "attendance" && <AttendanceView child={activeChild} />}
          {activeChild && view === "results" && <ResultsView child={activeChild} />}
          {activeChild && view === "remarks" && <RemarksView child={activeChild} />}
        </div>
      </main>

      <ChatWidget guardianName={session.fullName} urdu={urdu} open={chatOpen} onOpenChange={setChatOpen} />

      {payOpen && children.length > 0 && (
        <PayModal children={children} familyTotal={familyTotal} onClose={() => setPayOpen(false)} />
      )}

      <Toast message={message} bottom={92} />
    </div>
  );
}
