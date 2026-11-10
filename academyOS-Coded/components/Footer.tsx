"use client";

export default function Footer() {
  return (
    <footer style={{ background: "#0D0D0D", color: "#F7F5F0" }}>
      <div
        style={{
          maxWidth: 1360,
          margin: "0 auto",
          padding: "var(--pad-y) var(--gutter) 0",
        }}
      >
        {/* Link columns */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "48px clamp(64px, 12vw, 160px)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <FooterLink href="#features">Features</FooterLink>
            <FooterLink href="#how">How it works</FooterLink>
            <FooterLink href="#faq">FAQ</FooterLink>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <FooterLink href="#waitlist">Join the waitlist</FooterLink>
            <FooterLink href="mailto:connect@lowcodeflow.co">
              connect@lowcodeflow.co
            </FooterLink>
            <FooterLink href="#top">Privacy</FooterLink>
          </div>
        </div>

        {/* Meta row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 96,
            padding: "32px 0",
            borderTop: "1px solid rgba(247,245,240,0.16)",
            fontSize: 14,
            color: "#8A8A84",
          }}
        >
          <span>Built for tuition academies in Pakistan.</span>
          <span>English and Urdu, on the phones people already own.</span>
        </div>

        {/* Company byline + copyright */}
        <div className="byline">
          <div>
            <span className="byline__label">A product by</span>
            <span className="byline__name">M. Abdullah</span>
          </div>
          <div className="byline__copy">
            &copy; 2026 M. Abdullah. All rights reserved.
            <br />
            AcademyOS and the AcademyOS wordmark are trademarks of M. Abdullah.
          </div>
        </div>
      </div>

      {/* Giant wordmark */}
      <div style={{ width: "100%", overflow: "hidden", lineHeight: 0 }}>
        <svg
          viewBox="0 0 1000 101"
          width="100%"
          role="img"
          aria-label="AcademyOS"
          preserveAspectRatio="xMidYMin meet"
          style={{ display: "block" }}
        >
          <text
            x="0"
            y="144"
            textLength="1000"
            lengthAdjust="spacingAndGlyphs"
            fontFamily="Satoshi, Helvetica, Arial, sans-serif"
            fontWeight="900"
            fontSize="200"
            letterSpacing="-0.06em"
            fill="#F7F5F0"
          >
            ACADEMYOS
          </text>
        </svg>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      style={{
        fontSize: "1.125rem",
        fontWeight: 500,
        letterSpacing: "-0.01em",
        lineHeight: 2,
        color: "#8A8A84",
        transition: "color 160ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "#F7F5F0";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "#8A8A84";
      }}
    >
      {children}
    </a>
  );
}
