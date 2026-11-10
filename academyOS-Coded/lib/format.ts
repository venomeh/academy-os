export const fmt = (n: number) => Math.round(Math.abs(n)).toLocaleString("en-US");

export const money = (n: number) => `${n < 0 ? "−" : ""}${fmt(n)}`;

export const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export type Tone =
  | "unpaid" | "partial" | "paid" | "neutral" | "pending" | "marked" | "flagged"
  | "draft" | "approved" | "lowdata" | "delivered" | "opened" | "sent" | "rejected";

export const TONE_STYLE: Record<Tone, { bg: string; bd: string; fg: string }> = {
  paid: { bg: "#F1F7F3", bd: "#D3E7DC", fg: "#0B7A4B" },
  marked: { bg: "#F1F7F3", bd: "#D3E7DC", fg: "#0B7A4B" },
  approved: { bg: "#F1F7F3", bd: "#D3E7DC", fg: "#0B7A4B" },
  delivered: { bg: "#F1F7F3", bd: "#D3E7DC", fg: "#0B7A4B" },
  opened: { bg: "#F1F7F3", bd: "#D3E7DC", fg: "#0B7A4B" },
  partial: { bg: "#FFF6E8", bd: "#F2E1C4", fg: "#8A5B0B" },
  lowdata: { bg: "#FFF6E8", bd: "#F2E1C4", fg: "#8A5B0B" },
  unpaid: { bg: "#FDECEC", bd: "#F6CFCC", fg: "#B4231F" },
  flagged: { bg: "#FDECEC", bd: "#F6CFCC", fg: "#B4231F" },
  rejected: { bg: "#FDECEC", bd: "#F6CFCC", fg: "#B4231F" },
  neutral: { bg: "#FAF9F6", bd: "#E8E5DE", fg: "#6B6660" },
  pending: { bg: "#FAF9F6", bd: "#E8E5DE", fg: "#6B6660" },
  draft: { bg: "#FAF9F6", bd: "#E8E5DE", fg: "#6B6660" },
  sent: { bg: "#FAF9F6", bd: "#E8E5DE", fg: "#6B6660" },
};
