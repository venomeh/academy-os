"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Pill from "@/components/ui/Pill";

/**
 * Teachers & parents (§3.2). Accounts are admin-provisioned only — there is
 * no self-registration anywhere — so this screen is the single door into the
 * system for every non-admin user.
 */
export default function PeopleView({ flash }: { flash: (msg: string) => void }) {
  const staff = useQuery(api.staff.listStaff);
  const guardians = useQuery(api.staff.listGuardians);
  const provisionAccount = useAction(api.auth.provisionAccount);
  const resendInvite = useAction(api.staff.resendInviteCode);
  const deactivate = useMutation(api.staff.deactivate);
  const reactivate = useMutation(api.staff.reactivate);

  const [role, setRole] = useState<"teacher" | "parent">("teacher");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<"en" | "ur">("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onInvite() {
    if (!name.trim() || !email.trim()) return;
    setBusy(true);
    setError("");
    const result = await provisionAccount({
      email: email.trim(),
      fullName: name.trim(),
      role,
      phone: phone.trim() || undefined,
      languagePref: language,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flash(
      result.codeSent
        ? `Invite sent to ${email.trim()} — they set their own password from the code email.`
        : `Account created for ${email.trim()}, but the code email failed to send — check the address and use “Resend invite”.`
    );
    setName("");
    setEmail("");
    setPhone("");
  }

  async function onToggle(profileId: Id<"profiles">, active: boolean) {
    if (active) await deactivate({ profileId });
    else await reactivate({ profileId });
    flash(active ? "Account deactivated — they can no longer sign in, history is kept." : "Account reactivated.");
  }

  async function onResend(to: string) {
    const result = await resendInvite({ email: to });
    flash(result.ok ? `Code re-sent to ${to}` : result.error ?? "Could not resend.");
  }

  const inputStyle: React.CSSProperties = {
    height: 38,
    padding: "0 12px",
    background: "#FFFFFF",
    border: "1px solid #DDD9D0",
    borderRadius: 8,
    fontSize: "0.8125rem",
    width: "100%",
  };

  return (
    <div style={{ animation: "dashFadeIn 260ms ease-out both", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
      <div style={{ padding: 20, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
        <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Invite someone</h2>
        <p style={{ margin: "8px 0 0", fontSize: "0.75rem", lineHeight: 1.55, color: "#8A857C" }}>
          They get an email with a 6-digit code and set their own password — nobody self-registers. Inviting a parent also creates their family record, ready to enroll students against.
        </p>

        <div style={{ display: "flex", gap: 3, padding: 3, background: "#EDEBE4", borderRadius: 8, marginTop: 16 }}>
          {(["teacher", "parent"] as const).map((r) => {
            const on = role === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                aria-selected={on}
                style={{ flex: 1, height: 34, border: 0, borderRadius: 6, cursor: "pointer", background: on ? "#FFFFFF" : "transparent", color: on ? "#0D0D0D" : "#6B6660", fontSize: "0.8125rem", fontWeight: on ? 700 : 500, textTransform: "capitalize", boxShadow: on ? "0 1px 2px rgba(13,13,13,0.10)" : "none" }}
              >
                {r}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
          <input style={inputStyle} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Full name" />
          <input style={inputStyle} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <input style={inputStyle} placeholder={role === "parent" ? "Phone (for WhatsApp)" : "Phone (optional)"} value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone" />
          {role === "parent" && (
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.75rem", color: "#4A463F" }}>
              <span style={{ flex: "1 1 auto" }}>Language for their reminders and remarks</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value as "en" | "ur")} aria-label="Language" style={{ height: 32, padding: "0 8px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 7, fontSize: "0.75rem" }}>
                <option value="en">English</option>
                <option value="ur">اردو</option>
              </select>
            </label>
          )}
          {error && <div role="alert" style={{ fontSize: "0.75rem", color: "#B4231F" }}>{error}</div>}
          <button
            type="button"
            onClick={onInvite}
            disabled={busy || !name.trim() || !email.trim()}
            style={{ height: 40, background: busy || !name.trim() || !email.trim() ? "#EDEBE4" : "#0D0D0D", color: busy || !name.trim() || !email.trim() ? "#A8A39A" : "#F7F6F3", border: 0, borderRadius: 8, fontSize: "0.8125rem", fontWeight: 700, cursor: busy ? "progress" : "pointer" }}
          >
            {busy ? "Sending…" : `Invite ${role}`}
          </button>
        </div>
      </div>

      <div style={{ padding: 20, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
        <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Teachers &amp; admins</h2>
        <p style={{ margin: "8px 0 0", fontSize: "0.75rem", lineHeight: 1.55, color: "#8A857C" }}>Assign a teacher to their batches from the Batches tab.</p>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
          {(staff ?? []).map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderTop: "1px solid #F1EFE9" }}>
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{s.name}</span>
                  <Pill tone={s.active ? "approved" : "flagged"}>{s.active ? s.role : "inactive"}</Pill>
                </span>
                <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>{s.email}</span>
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button type="button" onClick={() => onResend(s.email)} style={{ height: 28, padding: "0 9px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, cursor: "pointer" }}>
                  Resend
                </button>
                {s.role !== "admin" && (
                  <button type="button" onClick={() => onToggle(s.id, s.active)} style={{ height: 28, padding: "0 9px", background: s.active ? "#FFFFFF" : "#F1F7F3", border: `1px solid ${s.active ? "#DDD9D0" : "#D3E7DC"}`, borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, color: s.active ? "#4A463F" : "#0B7A4B", cursor: "pointer" }}>
                    {s.active ? "Deactivate" : "Reactivate"}
                  </button>
                )}
              </span>
            </div>
          ))}
          {staff && staff.length === 0 && <div style={{ padding: "16px 0", fontSize: "0.75rem", color: "#A8A39A" }}>No teachers yet — invite one on the left.</div>}
        </div>
      </div>

      <div style={{ padding: 20, background: "#FFFFFF", border: "1px solid #E8E5DE", borderRadius: 11, boxShadow: "0 1px 2px rgba(13,13,13,0.04)" }}>
        <h2 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Parents</h2>
        <p style={{ margin: "8px 0 0", fontSize: "0.75rem", lineHeight: 1.55, color: "#8A857C" }}>Enroll their children from the Students tab. Two children under one parent gets the sibling discount automatically.</p>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
          {(guardians ?? []).map((g) => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderTop: "1px solid #F1EFE9" }}>
              <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{g.name}</span>
                  {!g.active && <Pill tone="flagged">inactive</Pill>}
                </span>
                <span style={{ fontSize: "0.6875rem", color: "#A8A39A" }}>
                  {g.email ?? g.phone ?? "no contact on file"}
                  {g.children.length > 0 ? ` · ${g.children.join(", ")}` : " · no children enrolled yet"}
                </span>
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {g.email && (
                  <button type="button" onClick={() => onResend(g.email!)} style={{ height: 28, padding: "0 9px", background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, cursor: "pointer" }}>
                    Resend
                  </button>
                )}
                <button type="button" onClick={() => onToggle(g.profileId, g.active)} style={{ height: 28, padding: "0 9px", background: g.active ? "#FFFFFF" : "#F1F7F3", border: `1px solid ${g.active ? "#DDD9D0" : "#D3E7DC"}`, borderRadius: 6, fontSize: "0.6875rem", fontWeight: 500, color: g.active ? "#4A463F" : "#0B7A4B", cursor: "pointer" }}>
                  {g.active ? "Deactivate" : "Reactivate"}
                </button>
              </span>
            </div>
          ))}
          {guardians && guardians.length === 0 && <div style={{ padding: "16px 0", fontSize: "0.75rem", color: "#A8A39A" }}>No parents yet — invite one on the left, then enroll their child.</div>}
        </div>
      </div>
    </div>
  );
}
