"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Pill from "@/components/ui/Pill";
import type { Tone } from "@/lib/format";

function topicTone(topic: string): Tone {
  const t = topic.toLowerCase();
  if (t.includes("waiver") || t.includes("discount")) return "partial";
  if (t.includes("complaint")) return "unpaid";
  return "pending";
}

export default function InquiriesView({ flash }: { flash: (msg: string) => void }) {
  const rows = useQuery(api.inquiries.list);
  const stats = useQuery(api.inquiries.getChatbotStats);
  const resolve = useMutation(api.inquiries.resolve);

  async function onResolve(id: Id<"inquiries">, from: string) {
    const result = await resolve({ inquiryId: id });
    flash(result.status === "resolved" ? `${from}'s inquiry marked resolved` : `Reopened ${from}'s inquiry`);
  }

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {(rows ?? []).map((q) => {
            const resolved = q.status === "resolved";
            return (
              <div key={q.id} style={{ padding: "17px 18px", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)", animation: "dashRiseIn 340ms ease-out both" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                  <Pill tone={topicTone(q.topic)}>{q.topic}</Pill>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 700 }}>{q.from}</span>
                  <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "#A8A39A" }}>
                    {new Date(q.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                  </span>
                </div>
                <p style={{ margin: "12px 0 0", fontSize: "0.875rem", lineHeight: 1.55, color: "#2A2723" }}>{q.message}</p>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 14, paddingTop: 13, borderTop: "1px solid #F1EFE9" }}>
                  <span style={{ fontSize: "0.75rem", color: "#8A857C" }}>Escalated by chatbot · out of tool scope</span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => onResolve(q.id, q.from)}
                      style={{ height: 32, padding: "0 14px", background: resolved ? "#F1F7F3" : "#0D0D0D", color: resolved ? "#0B7A4B" : "#F7F6F3", border: resolved ? "1px solid #D3E7DC" : "0", borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}
                    >
                      {resolved ? "Resolved" : "Mark resolved"}
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
          {rows && rows.length === 0 && (
            <div style={{ padding: "56px 20px", textAlign: "center", background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11 }}>
              <div style={{ fontSize: "0.9375rem", fontWeight: 700 }}>No inquiries.</div>
              <p style={{ margin: "8px 0 0", fontSize: "0.8125rem", color: "#8A857C" }}>Nothing has been escalated out of the chatbot&apos;s tool scope.</p>
            </div>
          )}
        </div>
        <div style={{ flex: "1 1 260px", maxWidth: 380, padding: 18, background: "#0D0D0D", color: "#F7F6F3", borderRadius: 11, alignSelf: "flex-start" }}>
          <div style={{ fontSize: "0.6875rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A857C" }}>Chatbot health</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
            {(stats ?? []).map((b) => (
              <div key={b.label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingBottom: 13, borderBottom: "1px solid #262421" }}>
                <span style={{ fontSize: "0.8125rem", color: "#B9B4AB" }}>{b.label}</span>
                <span style={{ fontSize: "1rem", fontWeight: 900, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: "#FF4E18" }}>{b.value}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: "16px 0 0", fontSize: "0.75rem", lineHeight: 1.6, color: "#8A857C" }}>Every tool call runs with the asking parent&apos;s identity. Questions outside scope become inquiries instead of answers.</p>
        </div>
      </div>
    </div>
  );
}
