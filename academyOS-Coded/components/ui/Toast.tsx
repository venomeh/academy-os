export default function Toast({ message, bottom = 22 }: { message: string; bottom?: number }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "13px 18px",
        background: "#0D0D0D",
        color: "#F7F6F3",
        borderRadius: 10,
        boxShadow: "0 16px 40px rgba(13,13,13,0.3)",
        animation: "dashToastIn 260ms cubic-bezier(0.16,1,0.3,1) both",
        maxWidth: "calc(100vw - 40px)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 20,
          height: 20,
          flex: "none",
          borderRadius: 9999,
          background: "#FF4E18",
          color: "#0D0D0D",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 900,
        }}
      >
        ✓
      </span>
      <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{message}</span>
    </div>
  );
}
