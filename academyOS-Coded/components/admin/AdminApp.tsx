"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { initials } from "@/lib/format";
import { useToast } from "@/lib/useToast";
import Toast from "@/components/ui/Toast";
import { buildNavGroups, TITLES, type ViewKey } from "@/components/admin/nav";
import type { AgingBucketKey } from "@/components/admin/types";

import OverviewView from "@/components/admin/OverviewView";
import BatchesView from "@/components/admin/BatchesView";
import StudentsView from "@/components/admin/StudentsView";
import AttendanceView from "@/components/admin/AttendanceView";
import VouchersView from "@/components/admin/VouchersView";
import PaymentsView from "@/components/admin/PaymentsView";
import DefaultersView from "@/components/admin/DefaultersView";
import RemarksView from "@/components/admin/RemarksView";
import RemindersView from "@/components/admin/RemindersView";
import InquiriesView from "@/components/admin/InquiriesView";
import PeopleView from "@/components/admin/PeopleView";
import SettingsView from "@/components/admin/SettingsView";
import StudentDrawer from "@/components/admin/StudentDrawer";
import VoucherModal from "@/components/admin/VoucherModal";
import PayModal from "@/components/admin/PayModal";
import GenerateModal from "@/components/admin/GenerateModal";
import TemplateModal, { type ReminderBucket, type ReminderLanguage, type ReminderTemplateDoc } from "@/components/admin/TemplateModal";
import AdjustmentModal from "@/components/admin/AdjustmentModal";
import FamilyStatementModal from "@/components/admin/FamilyStatementModal";

export type Session = NonNullable<FunctionReturnType<typeof api.auth.me>>;

export type ModalState =
  | { type: "voucher"; voucherId: Id<"vouchers"> }
  | { type: "pay"; voucherId: Id<"vouchers"> }
  | { type: "generate" }
  | { type: "template"; bucket: ReminderBucket; language: ReminderLanguage; template: ReminderTemplateDoc | null }
  | { type: "adjust"; voucherId: Id<"vouchers"> }
  | { type: "statement"; guardianId: Id<"guardians"> }
  | null;

const CURRENT_PERIOD = new Date().toISOString().slice(0, 7);

export default function AdminApp({ session }: { session: Session }) {
  const router = useRouter();
  const { signOut } = useAuthActions();

  const [view, setView] = useState<ViewKey>("overview");
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerStudentId, setDrawerStudentId] = useState<Id<"students"> | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [defaultersBucket, setDefaultersBucket] = useState<AgingBucketKey | "all">("all");
  const { message, flash } = useToast();

  // Every one of these is a live, reactive query — no manual refresh
  // plumbing needed. A payment recorded anywhere (even from a different
  // tab, even the parent portal) updates these badges on its own.
  const studentCount = useQuery(api.students.countActive);
  const vouchers = useQuery(api.vouchers.list, { period: CURRENT_PERIOD });
  const defaulters = useQuery(api.ledger.getDefaulters, {});
  const remarkStats = useQuery(api.remarks.getStats, {});
  const inquiries = useQuery(api.inquiries.list, {});

  const badges = {
    students: studentCount ?? 0,
    unpaidVouchers: vouchers ? vouchers.filter((v) => v.status !== "paid").length : 0,
    defaulters: defaulters?.length ?? 0,
    pendingRemarks: remarkStats ? remarkStats.draft + remarkStats.lowData : 0,
    openInquiries: inquiries ? inquiries.filter((q) => q.status === "open").length : 0,
  };

  function goDefaulters(bucket?: AgingBucketKey) {
    setDefaultersBucket(bucket ?? "all");
    setView("defaulters");
  }

  async function onSignOut() {
    await signOut();
    router.push("/login");
  }

  const [title, subtitleTpl] = TITLES[view];
  const subtitle =
    view === "overview"
      ? `${new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${subtitleTpl}`
      : view === "vouchers"
        ? `${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })} ${subtitleTpl}`
        : subtitleTpl;
  const navGroups = buildNavGroups(badges);

  return (
    <div style={{ display: "flex", minHeight: "100svh", alignItems: "stretch" }}>
      <aside
        aria-label="Sections"
        style={{
          width: sidebarOpen ? 244 : 0,
          flex: "none",
          display: "flex",
          flexDirection: "column",
          padding: sidebarOpen ? "20px 0 0" : 0,
          background: "#0D0D0D",
          overflow: "hidden",
          position: "sticky",
          top: 0,
          height: "100svh",
          transition: "width 280ms cubic-bezier(0.16,1,0.3,1), padding 280ms ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 18px 22px" }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: "#FF4E18", display: "block", flex: "none" }} />
          <span style={{ fontWeight: 900, fontSize: 16, letterSpacing: "-0.03em", color: "#F7F6F3" }}>AcademyOS</span>
          <span style={{ marginLeft: "auto", fontSize: "0.625rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6E6A63", border: "1px solid #302E2A", borderRadius: 5, padding: "3px 6px" }}>
            Admin
          </span>
        </div>
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", background: "#191817", border: "1px solid #2A2825", borderRadius: 8 }}>
            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: "#3ECF8E", display: "block", animation: "dashPulseDot 2s ease-in-out infinite" }} />
            <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#B9B4AB" }}>Bright Future Academy</span>
          </div>
        </div>
        <nav style={{ flex: "1 1 auto", overflowY: "auto", padding: "6px 12px 12px" }}>
          {navGroups.map((g) => (
            <div key={g.label} style={{ marginBottom: 18 }}>
              <div style={{ padding: "0 10px 8px", fontSize: "0.625rem", fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6E6A63" }}>{g.label}</div>
              {g.items.map((item) => {
                const on = view === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setView(item.key)}
                    aria-current={on}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "9px 10px",
                      marginBottom: 2,
                      background: on ? "#1C1B19" : "transparent",
                      border: 0,
                      borderRadius: 8,
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: "0.8125rem",
                      fontWeight: on ? 700 : 500,
                      color: on ? "#F7F6F3" : "#9B958C",
                    }}
                  >
                    <span aria-hidden="true" style={{ width: 3, height: 14, flex: "none", borderRadius: 9999, background: on ? "#FF4E18" : "transparent", display: "block" }} />
                    <span>{item.label}</span>
                    {item.badge > 0 && (
                      <span style={{ marginLeft: "auto", display: "inline-flex", padding: "2px 6px", background: on ? "#FF4E18" : "#262421", color: on ? "#0D0D0D" : "#9B958C", borderRadius: 5, fontSize: "0.625rem", fontWeight: 700 }}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div style={{ padding: 12, borderTop: "1px solid #262421" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
            <span aria-hidden="true" style={{ width: 30, height: 30, flex: "none", borderRadius: 9999, background: "#FF4E18", color: "#0D0D0D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 900 }}>
              {initials(session.fullName)}
            </span>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#F7F6F3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session.fullName}</span>
              <span style={{ fontSize: "0.6875rem", color: "#6E6A63" }}>Owner</span>
            </span>
            <button type="button" onClick={onSignOut} style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer", fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6E6A63", padding: 6, borderRadius: 6 }}>
              Exit
            </button>
          </div>
        </div>
      </aside>

      <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "14px clamp(16px, 3vw, 32px)",
            background: "rgba(247,246,243,0.88)",
            backdropFilter: "blur(10px)",
            borderBottom: "1px solid #E8E5DE",
          }}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle navigation"
            style={{ display: "flex", flexDirection: "column", gap: 3, padding: 9, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, cursor: "pointer" }}
          >
            <span aria-hidden="true" style={{ width: 14, height: 1.5, background: "#0D0D0D", display: "block" }} />
            <span aria-hidden="true" style={{ width: 14, height: 1.5, background: "#0D0D0D", display: "block" }} />
            <span aria-hidden="true" style={{ width: 14, height: 1.5, background: "#0D0D0D", display: "block" }} />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 900, letterSpacing: "-0.025em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</h1>
            <div style={{ fontSize: "0.75rem", color: "#8A857C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="search"
              placeholder="Search students, vouchers…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
              style={{ width: "clamp(140px, 24vw, 280px)", height: 38, padding: "0 13px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 8, fontSize: "0.875rem", boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}
            />
            <button
              type="button"
              onClick={() => setModal({ type: "generate" })}
              style={{ height: 38, padding: "0 15px", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 8, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Generate vouchers
            </button>
          </div>
        </header>

        <main style={{ flex: "1 1 auto", padding: "clamp(18px, 3vw, 30px) clamp(16px, 3vw, 32px) 64px" }}>
          <div style={{ maxWidth: 1280, margin: "0 auto" }}>
            {view === "overview" && <OverviewView onGoDefaulters={goDefaulters} onGoView={setView} />}
            {view === "batches" && <BatchesView flash={flash} />}
            {view === "students" && <StudentsView query={query} onOpenStudent={setDrawerStudentId} flash={flash} />}
            {view === "attendance" && <AttendanceView flash={flash} />}
            {view === "vouchers" && (
              <VouchersView
                query={query}
                onView={(id) => setModal({ type: "voucher", voucherId: id })}
                onPay={(id) => setModal({ type: "pay", voucherId: id })}
              />
            )}
            {view === "payments" && <PaymentsView />}
            {view === "defaulters" && (
              <DefaultersView bucket={defaultersBucket} onBucket={setDefaultersBucket} onStatement={(guardianId) => setModal({ type: "statement", guardianId })} flash={flash} />
            )}
            {view === "remarks" && <RemarksView flash={flash} />}
            {view === "reminders" && <RemindersView onOpen={(bucket, language, template) => setModal({ type: "template", bucket, language, template })} />}
            {view === "inquiries" && <InquiriesView flash={flash} />}
            {view === "people" && <PeopleView flash={flash} />}
            {view === "settings" && <SettingsView flash={flash} />}
          </div>
        </main>
      </div>

      {drawerStudentId && (
        <StudentDrawer
          studentId={drawerStudentId}
          onClose={() => setDrawerStudentId(null)}
          onPay={(voucherId) => setModal({ type: "pay", voucherId })}
          onAdjust={(voucherId) => setModal({ type: "adjust", voucherId })}
          onStatement={(guardianId) => setModal({ type: "statement", guardianId })}
          flash={flash}
        />
      )}

      {modal?.type === "voucher" && (
        <VoucherModal
          voucherId={modal.voucherId}
          onClose={() => setModal(null)}
          onPay={(id) => setModal({ type: "pay", voucherId: id })}
          onAdjust={(id) => setModal({ type: "adjust", voucherId: id })}
          flash={flash}
        />
      )}
      {modal?.type === "pay" && (
        <PayModal
          voucherId={modal.voucherId}
          onClose={() => setModal(null)}
          onPaid={() => {
            flash("Payment recorded. Receipt issued and reminder sequence halted.");
          }}
        />
      )}
      {modal?.type === "generate" && (
        <GenerateModal
          onClose={() => setModal(null)}
          onDone={(summary) => {
            flash(summary);
          }}
        />
      )}
      {modal?.type === "template" && (
        <TemplateModal bucket={modal.bucket} language={modal.language} template={modal.template} onClose={() => setModal(null)} onSaved={flash} />
      )}
      {modal?.type === "adjust" && <AdjustmentModal voucherId={modal.voucherId} onClose={() => setModal(null)} onPosted={flash} />}
      {modal?.type === "statement" && <FamilyStatementModal guardianId={modal.guardianId} onClose={() => setModal(null)} />}

      <Toast message={message} />
    </div>
  );
}
