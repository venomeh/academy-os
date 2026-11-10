"use client";

import { useEffect, useRef, useState } from "react";

export default function Nav() {
  const navRef = useRef<HTMLElement>(null);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const onResize = () => setDesktop(window.innerWidth >= 1024);
    onResize();
    window.addEventListener("resize", onResize);

    const onScroll = () => {
      const n = navRef.current;
      if (!n) return;
      const tight = window.scrollY > 24;
      n.style.padding = tight ? "4px 8px 4px 22px" : "8px 8px 8px 22px";
      n.style.boxShadow = tight
        ? "0 2px 12px rgba(13,13,13,0.06)"
        : "none";
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      style={{
        position: "fixed",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 50,
        width: "auto",
        maxWidth: "min(920px, calc(100% - 24px))",
        display: "flex",
        alignItems: "center",
        gap: "clamp(16px, 4vw, 28px)",
        background: "#F7F5F0",
        border: "1px solid rgba(13,13,13,0.12)",
        borderRadius: 9999,
        padding: "8px 8px 8px 22px",
        boxShadow: "0 2px 12px rgba(13,13,13,0.06)",
        transition: "padding 250ms ease, box-shadow 250ms ease",
        animation: "fadeIn 400ms ease-out 200ms both",
      }}
    >
      <a href="#top" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 4,
            background: "#FF4E18",
            display: "block",
          }}
        />
        <span
          style={{
            fontWeight: 900,
            fontSize: 18,
            letterSpacing: "-0.03em",
            color: "#0D0D0D",
          }}
        >
          AcademyOS
        </span>
      </a>

      {desktop && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            margin: "0 8px",
          }}
        >
          <NavLink href="#features">Features</NavLink>
          <NavLink href="#how">How it works</NavLink>
          <NavLink href="#pricing">Pricing</NavLink>
          <NavLink href="#faq">FAQ</NavLink>
        </div>
      )}

      <a
        href="#waitlist"
        style={{
          marginLeft: "auto",
          background: "#0D0D0D",
          color: "#F7F5F0",
          fontWeight: 700,
          fontSize: 15,
          padding: "14px 24px",
          borderRadius: 9999,
          whiteSpace: "nowrap",
          transition: "background 160ms, color 160ms",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#FF4E18";
          e.currentTarget.style.color = "#0D0D0D";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#0D0D0D";
          e.currentTarget.style.color = "#F7F5F0";
        }}
      >
        Join waitlist
      </a>
    </nav>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        fontSize: 15,
        fontWeight: 500,
        color: "#6B6B66",
        transition: "color 160ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "#0D0D0D";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "#6B6B66";
      }}
    >
      {children}
    </a>
  );
}
