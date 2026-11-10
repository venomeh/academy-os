export type ViewKey =
  | "overview" | "batches" | "students" | "attendance"
  | "vouchers" | "payments" | "defaulters"
  | "remarks" | "reminders" | "inquiries"
  | "people" | "settings";

export const TITLES: Record<ViewKey, [string, string]> = {
  overview: ["Overview", "live"],
  batches: ["Batches", "Subjects, timings, and assigned teachers"],
  students: ["Students", "Active roster across every batch"],
  attendance: ["Attendance", "Live from teachers · correct any past date here"],
  vouchers: ["Vouchers", "billing period"],
  payments: ["Payments & ledger", "Append-only entries, cash and Stripe"],
  defaulters: ["Defaulters", "Outstanding balances by aging bucket"],
  remarks: ["Progress remarks", "AI drafts awaiting teacher approval"],
  reminders: ["Fee follow-ups", "Escalating sequence and message log"],
  inquiries: ["Inquiry inbox", "Escalations from the parent chatbot"],
  people: ["Teachers & parents", "Invite staff and families — accounts are admin-created only"],
  settings: ["Fee rules & jobs", "Snapshotted per voucher · Convex cron schedule"],
};

export interface NavItem {
  key: ViewKey;
  label: string;
  badge: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface Badges {
  students: number;
  unpaidVouchers: number;
  defaulters: number;
  pendingRemarks: number;
  openInquiries: number;
}

export function buildNavGroups(b: Badges): NavGroup[] {
  return [
    {
      label: "Academy",
      items: [
        { key: "overview", label: "Overview", badge: 0 },
        { key: "batches", label: "Batches", badge: 0 },
        { key: "students", label: "Students", badge: b.students },
        { key: "attendance", label: "Attendance", badge: 0 },
      ],
    },
    {
      label: "Money",
      items: [
        { key: "vouchers", label: "Vouchers", badge: b.unpaidVouchers },
        { key: "payments", label: "Payments", badge: 0 },
        { key: "defaulters", label: "Defaulters", badge: b.defaulters },
      ],
    },
    {
      label: "Automation",
      items: [
        { key: "remarks", label: "Remarks", badge: b.pendingRemarks },
        { key: "reminders", label: "Reminders", badge: 0 },
        { key: "inquiries", label: "Inquiries", badge: b.openInquiries },
      ],
    },
    {
      label: "Academy setup",
      items: [
        { key: "people", label: "Teachers & parents", badge: 0 },
        { key: "settings", label: "Fee rules & jobs", badge: 0 },
      ],
    },
  ];
}
