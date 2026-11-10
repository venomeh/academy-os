export default function Avatar({
  initials,
  tone = "#EDEBE4",
  size = 32,
}: {
  initials: string;
  tone?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 9999,
        background: tone,
        color: "#0D0D0D",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size >= 32 ? "0.6875rem" : "0.625rem",
        fontWeight: 900,
        letterSpacing: "-0.01em",
      }}
    >
      {initials}
    </span>
  );
}
