"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

interface DisplayMessage {
  from: "me" | "bot";
  text: string;
  tools: string[];
}

const GREETING: DisplayMessage = {
  from: "bot",
  text: "Assalam-o-alaikum. I can check dues, attendance, results and schedules for your children. What would you like to know?",
  tools: [],
};

const SUGGESTIONS: { en: string; ur: string }[] = [
  { en: "What do I owe?", ur: "کتنے پیسے باقی ہیں؟" },
  { en: "Was my child present this week?", ur: "حاضری" },
  { en: "When is the next test?", ur: "اگلا ٹیسٹ" },
  { en: "Can I get a fee concession?", ur: "Can I get a fee concession?" },
];

function buildDisplay(messages: { role: string; content: string; toolName: string | null }[]): DisplayMessage[] {
  const out: DisplayMessage[] = [];
  let pendingTools: string[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ from: "me", text: m.content, tools: [] });
    else if (m.role === "tool") pendingTools.push(m.toolName ?? "tool");
    else if (m.role === "assistant") {
      out.push({ from: "bot", text: m.content, tools: pendingTools });
      pendingTools = [];
    }
  }
  return out;
}

export default function ChatWidget({
  guardianName,
  urdu,
  open,
  onOpenChange,
}: {
  guardianName: string;
  urdu: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const history = useQuery(api.chatbot.listSessionMessages);
  const sendMessage = useAction(api.chatbot.sendMessage);

  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages: DisplayMessage[] = history ? buildDisplay(history.messages) : [];
  if (messages.length === 0) messages.unshift(GREETING);
  // The server persists the question before it starts thinking, so once that
  // round-trips back the optimistic copy would be a duplicate for the whole
  // length of the model call. Only show it until the real one lands.
  const alreadyEchoed = pendingText !== null && messages.some((m) => m.from === "me" && m.text === pendingText);
  if (pendingText && !alreadyEchoed) messages.push({ from: "me", text: pendingText, tools: [] });
  if (localError) messages.push({ from: "bot", text: localError, tools: [] });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing, open]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || typing) return;
    setDraft("");
    setPendingText(q);
    setLocalError(null);
    setTyping(true);
    onOpenChange(true);
    const res = await sendMessage({ text: q });
    setTyping(false);
    setPendingText(null);
    if (!res.ok) setLocalError(res.error);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="Ask AcademyOS"
        style={{
          position: "fixed",
          bottom: 22,
          right: 22,
          zIndex: 70,
          display: "flex",
          alignItems: "center",
          gap: 9,
          height: 50,
          padding: "0 20px",
          background: "#0D0D0D",
          color: "#F7F6F3",
          border: 0,
          borderRadius: 9999,
          boxShadow: "0 14px 34px rgba(13,13,13,0.26)",
          cursor: "pointer",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 15, fontWeight: 900 }}>✳</span>
        <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>{urdu ? "پوچھیں" : "Ask"}</span>
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", inset: "auto 0 0", zIndex: 80, display: "flex", justifyContent: "center", padding: "0 clamp(0px, 3vw, 20px) clamp(0px, 3vw, 20px)" }}>
      <div
        role="dialog"
        aria-label="Ask AcademyOS"
        style={{
          width: "min(420px, 100%)",
          maxHeight: "min(620px, 86svh)",
          display: "flex",
          flexDirection: "column",
          background: "#FFFFFF",
          border: "1px solid #E8E5DE",
          borderRadius: "16px 16px 0 0",
          boxShadow: "0 -12px 44px rgba(13,13,13,0.18)",
          overflow: "hidden",
          animation: "dashSheetUp 320ms cubic-bezier(0.16,1,0.3,1) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 18px", background: "#0D0D0D", color: "#F7F6F3" }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 9999, background: "#3ECF8E", display: "block", animation: "dashPulseDot 2s ease-in-out infinite" }} />
          <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>Ask AcademyOS</span>
          <span style={{ fontSize: "0.6875rem", color: "#8A857C" }}>reads your family&apos;s data only</span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close chat"
            style={{ marginLeft: "auto", width: 28, height: 28, background: "#1C1B19", border: 0, borderRadius: 8, color: "#F7F6F3", cursor: "pointer", fontSize: 15, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div ref={scrollRef} style={{ flex: "1 1 auto", overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.map((m, i) => {
            const mine = m.from === "me";
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: mine ? "flex-end" : "flex-start", animation: "dashRiseIn 260ms ease-out both" }}>
                <div
                  style={{
                    maxWidth: "86%",
                    padding: "12px 14px",
                    background: mine ? "#0D0D0D" : "#F4F2EC",
                    color: mine ? "#F7F6F3" : "#2A2723",
                    borderRadius: mine ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                    fontSize: "0.875rem",
                    lineHeight: 1.55,
                  }}
                >
                  {m.text}
                </div>
                {m.tools.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {m.tools.map((t, ti) => (
                      <span key={`${t}-${ti}`} style={{ padding: "4px 8px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 6, fontSize: "0.625rem", fontFamily: "ui-monospace, Menlo, monospace", color: "#6B6660" }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {typing && (
            <div style={{ display: "flex", gap: 4, padding: "12px 14px", background: "#F4F2EC", borderRadius: 12, alignSelf: "flex-start" }}>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: "#8A857C", display: "block", animation: "dashBlink 1.2s ease-in-out infinite" }} />
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: "#8A857C", display: "block", animation: "dashBlink 1.2s ease-in-out 200ms infinite" }} />
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: "#8A857C", display: "block", animation: "dashBlink 1.2s ease-in-out 400ms infinite" }} />
            </div>
          )}
        </div>

        <div style={{ padding: "12px 14px", borderTop: "1px solid #EFEDE7" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s.en}
                type="button"
                onClick={() => ask(s.en)}
                style={{ padding: "7px 11px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 9999, fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}
              >
                {urdu ? s.ur : s.en}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <label htmlFor="chat-input" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
              Your question
            </label>
            <input
              id="chat-input"
              type="text"
              placeholder={urdu ? "اپنا سوال لکھیں…" : "Ask about dues, attendance, results…"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ flex: "1 1 auto", height: 42, padding: "0 13px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.875rem" }}
            />
            <button type="submit" disabled={typing} style={{ width: 42, height: 42, flex: "none", background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 9, fontSize: 15, fontWeight: 900, cursor: typing ? "progress" : "pointer", opacity: typing ? 0.7 : 1 }}>
              ↑
            </button>
          </form>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 9, fontSize: "0.625rem", lineHeight: 1.5, color: "#A8A39A" }}>
            <span>Answers come from {guardianName.split(" ")[0]}&apos;s own children&apos;s records only</span>
            {history && (
              <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, Menlo, monospace" }} title="Model tokens used in this session · questions asked today">
                {history.tokenUsage.toLocaleString()} tokens this session · {history.dailyUsed}/{history.dailyLimit} today
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
