export default function StudentAvatar({
  photoUrl,
  initials,
  tone = "#EDEBE4",
  textColor = "#0D0D0D",
  size = 32,
}: {
  photoUrl?: string | null;
  initials: string;
  tone?: string;
  textColor?: string;
  size?: number;
}) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        aria-hidden="true"
        style={{ width: size, height: size, flex: "none", borderRadius: 9999, objectFit: "cover", background: tone }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 9999,
        background: tone,
        color: textColor,
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
