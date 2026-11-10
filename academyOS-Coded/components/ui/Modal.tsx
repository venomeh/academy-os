"use client";

import { useEffect } from "react";

export default function Modal({
  title,
  onClose,
  width = 520,
  children,
}: {
  title: string;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(13,13,13,0.36)", animation: "dashFadeIn 180ms ease-out both" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "relative",
          width: `min(${width}px, 100%)`,
          maxHeight: "88svh",
          overflowY: "auto",
          background: "#FFFFFF",
          borderRadius: 14,
          boxShadow: "0 28px 70px rgba(13,13,13,0.26)",
          animation: "dashPopIn 240ms cubic-bezier(0.16,1,0.3,1) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px", borderBottom: "1px solid #EFEDE7" }}>
          <span style={{ fontSize: "1rem", fontWeight: 900, letterSpacing: "-0.025em" }}>{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: "auto",
              width: 30,
              height: 30,
              background: "#FFFFFF",
              border: "1px solid #DDD9D0",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
