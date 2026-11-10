"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type View = "signin" | "requestCode" | "enterCode";

function roleHome(role: "admin" | "teacher" | "parent") {
  return role === "admin" ? "/admin" : role === "teacher" ? "/teacher" : "/parent";
}

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.auth.me, isAuthenticated ? {} : "skip");

  const [view, setView] = useState<View>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState("");
  const [focus, setFocus] = useState("");
  // Distinguishes "we just emailed a fresh code" from "the invitee already has
  // one" — the code screen is reachable both ways and the copy has to match.
  const [codeJustSent, setCodeJustSent] = useState(false);

  /** Straight to the code screen without issuing a new code, which would supersede the one they were sent. */
  function goToEnterCode() {
    setTouched(true);
    setErr("");
    if (!emailValid) return;
    setCodeJustSent(false);
    setView("enterCode");
    setTouched(false);
  }

  // Once signed in, wait for the role to resolve, then land on the right dashboard.
  useEffect(() => {
    if (me) router.replace(roleHome(me.role));
  }, [me, router]);

  // The password was right but there is no *active* profile behind it —
  // a deactivated account (§3.2). Every server function already refuses it;
  // this just says so instead of leaving the spinner running.
  useEffect(() => {
    if (!isAuthenticated || me !== null) return;
    setBusy(false);
    setErr("This account has been deactivated. Ask the academy to reactivate it.");
    void signOut();
  }, [isAuthenticated, me, signOut]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailBad = touched && !emailValid;
  const pwBad = touched && view === "signin" && !password;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setErr("");
    if (!emailValid || !password) return;
    setBusy(true);
    try {
      await signIn("password", { email: email.trim().toLowerCase(), password, flow: "signIn" });
      // isAuthenticated flips true, the me query above handles the redirect.
    } catch {
      setBusy(false);
      setErr("That email and password don't match an active account.");
    }
  }

  async function onRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setErr("");
    if (!emailValid) return;
    setBusy(true);
    try {
      await signIn("password", { email: email.trim().toLowerCase(), flow: "reset" });
      setBusy(false);
      setCodeJustSent(true);
      setView("enterCode");
      setTouched(false);
    } catch {
      setBusy(false);
      setErr("Couldn't send a code to that address — check it's the email your invite came to.");
    }
  }

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setErr("");
    if (!code.trim() || newPassword.length < 8) return;
    setBusy(true);
    try {
      await signIn("password", { email: email.trim().toLowerCase(), code: code.trim(), newPassword, flow: "reset-verification" });
    } catch {
      setBusy(false);
      setErr("That code is wrong or has expired — request a new one.");
    }
  }

  function field(bad: boolean, focused: boolean): React.CSSProperties {
    return {
      width: "100%",
      height: 46,
      padding: "0 14px",
      borderRadius: 8,
      background: "#FFFFFF",
      border: `1px solid ${bad ? "#E0645E" : focused ? "#FF4E18" : "#DDD9D0"}`,
      boxShadow: focused ? "0 0 0 3px rgba(255,78,24,0.16)" : "0 1px 2px rgba(13,13,13,0.04)",
      fontSize: "0.9375rem",
      transition: "border-color 150ms, box-shadow 150ms",
    };
  }

  const submitStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    width: "100%",
    height: 46,
    marginTop: 22,
    border: 0,
    borderRadius: 8,
    background: "#0D0D0D",
    color: "#F7F6F3",
    fontSize: "0.9375rem",
    fontWeight: 700,
    cursor: busy ? "progress" : "pointer",
    opacity: busy ? 0.85 : 1,
  };

  const spinner = (
    <span aria-hidden="true" style={{ width: 15, height: 15, borderRadius: 9999, border: "2px solid rgba(247,246,243,0.35)", borderTopColor: "#F7F6F3", display: "block", animation: "dashSpin 700ms linear infinite" }} />
  );

  return (
    <div style={{ minHeight: "100svh", display: "flex" }}>
      <aside
        aria-hidden="true"
        className="login-aside"
        style={{
          flex: "1 1 44%",
          maxWidth: 620,
          display: "none",
          flexDirection: "column",
          padding: "clamp(32px, 4vw, 56px)",
          background: "#FF4E18",
          color: "#0D0D0D",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <span style={{ position: "absolute", width: 460, height: 460, borderRadius: 9999, background: "rgba(13,13,13,0.06)", top: -140, right: -160, animation: "dashDrift 18s ease-in-out infinite" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: "#0D0D0D", display: "block" }} />
          <span style={{ fontWeight: 900, fontSize: 18, letterSpacing: "-0.03em" }}>AcademyOS</span>
        </div>
        <div style={{ position: "relative", marginTop: "auto" }}>
          <h1 style={{ margin: 0, fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)", fontWeight: 900, letterSpacing: "-0.045em", lineHeight: 0.92 }}>
            The register
            <br />
            is closed.
          </h1>
          <p style={{ maxWidth: "34ch", margin: "20px 0 0", fontSize: "1.0625rem", lineHeight: 1.55, color: "rgba(13,13,13,0.75)" }}>
            Vouchers, attendance, marks and parent updates — one platform for the whole academy.
          </p>
        </div>
      </aside>

      <main style={{ flex: "1 1 480px", display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(24px, 5vw, 56px) clamp(20px, 5vw, 48px)", background: "#F7F6F3" }}>
        <div style={{ width: "100%", maxWidth: 420, animation: "dashRiseIn 500ms cubic-bezier(0.16,1,0.3,1) both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: "#FF4E18", display: "block" }} />
            <span style={{ fontWeight: 900, fontSize: 17, letterSpacing: "-0.03em" }}>AcademyOS</span>
          </div>

          {view === "signin" && (
            <div>
              <h2 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 900, letterSpacing: "-0.035em", lineHeight: 1.1 }}>Sign in</h2>
              <p style={{ margin: "10px 0 0", fontSize: "0.9375rem", lineHeight: 1.5, color: "#6B6660" }}>
                Accounts are created by the academy. Ask the front desk if you need an invite.
              </p>

              <form onSubmit={onSubmit} noValidate style={{ marginTop: 28 }}>
                <label htmlFor="email" style={{ display: "block", fontSize: "0.8125rem", fontWeight: 500, color: "#4A463F", marginBottom: 7 }}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@academy.pk"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setErr(""); }}
                  onFocus={() => setFocus("email")}
                  onBlur={() => setFocus("")}
                  aria-invalid={emailBad}
                  style={field(emailBad, focus === "email")}
                />
                {emailBad && <div style={{ marginTop: 7, fontSize: "0.8125rem", color: "#B4231F" }}>Enter a valid email address.</div>}

                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, margin: "18px 0 7px" }}>
                  <label htmlFor="password" style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#4A463F" }}>
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setView("requestCode"); setTouched(false); setErr(""); }}
                    style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: "0.8125rem", fontWeight: 500, color: "#6B6660", textDecoration: "underline", textUnderlineOffset: 3 }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    id="password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setErr(""); }}
                    onFocus={() => setFocus("pw")}
                    onBlur={() => setFocus("")}
                    aria-invalid={pwBad}
                    style={{ ...field(pwBad, focus === "pw"), paddingRight: 74 }}
                  />
                  <button
                    type="button"
                    aria-label="Toggle password visibility"
                    onClick={() => setShowPw((v) => !v)}
                    style={{ position: "absolute", top: "50%", right: 6, transform: "translateY(-50%)", background: "none", border: 0, padding: "8px 10px", cursor: "pointer", fontSize: "0.75rem", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A857C", borderRadius: 6 }}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
                {pwBad && <div style={{ marginTop: 7, fontSize: "0.8125rem", color: "#B4231F" }}>Enter your password.</div>}

                {err && (
                  <div role="alert" style={{ display: "flex", gap: 10, marginTop: 18, padding: "12px 14px", background: "#FDECEC", border: "1px solid #F6CFCC", borderRadius: 8, fontSize: "0.8125rem", lineHeight: 1.45, color: "#8E1C18", animation: "dashShake 320ms ease-in-out both" }}>
                    <span aria-hidden="true" style={{ fontWeight: 700 }}>!</span>
                    <span>{err}</span>
                  </div>
                )}

                <button type="submit" disabled={busy} style={submitStyle}>
                  {busy && spinner}
                  <span>{busy ? "Signing in…" : "Sign in"}</span>
                </button>
              </form>

              <p style={{ margin: "18px 0 0", fontSize: "0.8125rem", lineHeight: 1.5, color: "#8A857C" }}>
                First time here? Your invite email has a 6-digit code — use <button type="button" onClick={() => { setView("requestCode"); setTouched(false); setErr(""); }} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "#6B6660", textDecoration: "underline" }}>Set your password</button> to enter it.
              </p>
            </div>
          )}

          {view === "requestCode" && (
            <div style={{ animation: "dashFadeIn 300ms ease-out both" }}>
              <button type="button" onClick={() => { setView("signin"); setTouched(false); setErr(""); }} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: "0.8125rem", fontWeight: 500, color: "#6B6660" }}>
                ← Back to sign in
              </button>
              <h2 style={{ margin: "22px 0 0", fontSize: "1.75rem", fontWeight: 900, letterSpacing: "-0.035em", lineHeight: 1.1 }}>Set your password</h2>
              <p style={{ margin: "10px 0 28px", fontSize: "0.9375rem", lineHeight: 1.5, color: "#6B6660" }}>
                Already have a code from your invite email? Enter your address, then use the link below it. Otherwise we&apos;ll send a fresh one — it expires in 15 minutes.
              </p>
              <form onSubmit={onRequestCode} noValidate>
                <label htmlFor="reset-email" style={{ display: "block", fontSize: "0.8125rem", fontWeight: 500, color: "#4A463F", marginBottom: 7 }}>
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@academy.pk"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocus("email")}
                  onBlur={() => setFocus("")}
                  aria-invalid={emailBad}
                  style={field(emailBad, focus === "email")}
                />
                {emailBad && <div style={{ marginTop: 7, fontSize: "0.8125rem", color: "#B4231F" }}>Enter a valid email address.</div>}
                {err && <div role="alert" style={{ marginTop: 18, padding: "12px 14px", background: "#FDECEC", border: "1px solid #F6CFCC", borderRadius: 8, fontSize: "0.8125rem", color: "#8E1C18" }}>{err}</div>}
                <button type="submit" disabled={busy} style={submitStyle}>
                  {busy && spinner}
                  <span>{busy ? "Sending…" : "Email me a code"}</span>
                </button>
              </form>
              <button
                type="button"
                onClick={goToEnterCode}
                style={{ width: "100%", marginTop: 12, height: 46, border: "1px solid #DDD9D0", borderRadius: 8, background: "#FFFFFF", fontSize: "0.875rem", fontWeight: 700, cursor: "pointer" }}
              >
                I already have a code
              </button>
            </div>
          )}

          {view === "enterCode" && (
            <div style={{ animation: "dashRiseIn 400ms cubic-bezier(0.16,1,0.3,1) both" }}>
              <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 9999, background: "#0D0D0D", color: "#FF4E18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 700 }}>
                {codeJustSent ? "✓" : "→"}
              </span>
              <h2 style={{ margin: "22px 0 0", fontSize: "1.75rem", fontWeight: 900, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
                {codeJustSent ? "Check your inbox" : "Enter your code"}
              </h2>
              <p style={{ margin: "10px 0 28px", fontSize: "0.9375rem", lineHeight: 1.5, color: "#6B6660" }}>
                {codeJustSent ? (
                  <>Enter the code sent to <strong>{email}</strong> and choose a password.</>
                ) : (
                  <>Enter the 6-digit code from your invite email for <strong>{email}</strong> and choose a password.</>
                )}
              </p>
              <form onSubmit={onVerifyCode} noValidate>
                <label htmlFor="code" style={{ display: "block", fontSize: "0.8125rem", fontWeight: 500, color: "#4A463F", marginBottom: 7 }}>
                  6-digit code
                </label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  style={{ ...field(touched && !code.trim(), focus === "code"), letterSpacing: "0.3em", fontWeight: 700, textAlign: "center" }}
                  onFocus={() => setFocus("code")}
                  onBlur={() => setFocus("")}
                />
                <label htmlFor="newpw" style={{ display: "block", fontSize: "0.8125rem", fontWeight: 500, color: "#4A463F", margin: "18px 0 7px" }}>
                  New password
                </label>
                <input
                  id="newpw"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onFocus={() => setFocus("newpw")}
                  onBlur={() => setFocus("")}
                  aria-invalid={touched && newPassword.length < 8}
                  style={field(touched && newPassword.length < 8, focus === "newpw")}
                />
                {touched && newPassword.length < 8 && <div style={{ marginTop: 7, fontSize: "0.8125rem", color: "#B4231F" }}>At least 8 characters.</div>}
                {err && <div role="alert" style={{ marginTop: 18, padding: "12px 14px", background: "#FDECEC", border: "1px solid #F6CFCC", borderRadius: 8, fontSize: "0.8125rem", color: "#8E1C18" }}>{err}</div>}
                <button type="submit" disabled={busy} style={submitStyle}>
                  {busy && spinner}
                  <span>{busy ? "Setting password…" : "Set password & sign in"}</span>
                </button>
              </form>
              <button
                type="button"
                onClick={() => { setView("requestCode"); setCode(""); setErr(""); setTouched(false); }}
                style={{ width: "100%", marginTop: 12, height: 46, border: "1px solid #DDD9D0", borderRadius: 8, background: "#FFFFFF", fontSize: "0.875rem", fontWeight: 700, cursor: "pointer" }}
              >
                Send a new code
              </button>
            </div>
          )}

          <p style={{ margin: "26px 0 0", fontSize: "0.75rem", lineHeight: 1.5, color: "#8A857C" }}>
            Every account is scoped to its own role — a parent can never reach another family&apos;s data.
          </p>
        </div>
      </main>

      <style>{`@media (min-width: 900px) { .login-aside { display: flex !important; } }`}</style>
    </div>
  );
}
