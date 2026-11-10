"use client";

/**
 * The P / A / L / Lv attendance control, shared by the teacher's daily
 * marking screen and the admin's correction panel so both mark a student
 * the same way with the same colours.
 */

export type AttendanceStatus = "present" | "absent" | "late" | "leave";

export const STATUSES: { short: string; value: AttendanceStatus; title: string }[] = [
  { short: "P", value: "present", title: "Present" },
  { short: "A", value: "absent", title: "Absent" },
  { short: "L", value: "late", title: "Late" },
  { short: "Lv", value: "leave", title: "Leave" },
];

export const STATUS_TONE: Record<AttendanceStatus, [string, string]> = {
  present: ["#0D0D0D", "#F7F6F3"],
  absent: ["#B4231F", "#FFFFFF"],
  late: ["#C99A2E", "#0D0D0D"],
  leave: ["#6B6660", "#FFFFFF"],
};

export default function StatusToggle({
  value,
  onChange,
  label,
  compact = false,
}: {
  value: AttendanceStatus;
  onChange: (next: AttendanceStatus) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <span role="group" aria-label={label} style={{ display: "flex", gap: 4, padding: 3, background: "#F4F2EC", borderRadius: 9 }}>
      {STATUSES.map((o) => {
        const on = value === o.value;
        const [bg, fg] = STATUS_TONE[o.value];
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            title={o.title}
            style={{
              minWidth: compact ? 32 : 38,
              height: compact ? 30 : 34,
              padding: compact ? "0 7px" : "0 9px",
              border: 0,
              borderRadius: 7,
              cursor: "pointer",
              background: on ? bg : "transparent",
              color: on ? fg : "#8A857C",
              fontSize: "0.8125rem",
              fontWeight: on ? 700 : 500,
              boxShadow: on ? "0 1px 3px rgba(13,13,13,0.14)" : "none",
            }}
          >
            {o.short}
          </button>
        );
      })}
    </span>
  );
}
