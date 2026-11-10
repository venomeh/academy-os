"use client";

/* Flat, on-palette cartoon — no stock art, no gradients. It peeks over the
   top edge of whichever tier the visitor is looking at. */
function Toon() {
  return (
    <svg
      className="toon"
      viewBox="0 0 210 152"
      width="210"
      height="152"
      aria-hidden="true"
      focusable="false"
    >
      {/* arms go behind the head and body */}
      <g stroke="#f7f5f0" strokeWidth="7" strokeLinecap="round" fill="none">
        <path d="M90 116 L66 64" />
        <path d="M120 116 L144 64" />
      </g>

      {/* the board */}
      <rect
        x="5"
        y="4"
        width="200"
        height="58"
        rx="10"
        fill="#f7f5f0"
        stroke="#0d0d0d"
        strokeWidth="3"
      />
      <text
        x="105"
        y="28"
        textAnchor="middle"
        fontSize="15"
        fontWeight="900"
        letterSpacing="-0.3"
        fill="#0d0d0d"
      >
        <tspan fill="#ff4e18">10% OFF</tspan>
        <tspan> FOR 3 MONTHS</tspan>
      </text>
      <text
        x="105"
        y="48"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        letterSpacing="0.4"
        fill="#0d0d0d"
      >
        FOR NEW USERS!
      </text>

      {/* head */}
      <circle cx="105" cy="92" r="19" fill="#f7f5f0" />
      <path
        d="M86 86 a19 19 0 0 1 38 0 z"
        fill="#ff4e18"
        stroke="#0d0d0d"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="98" cy="95" r="2.6" fill="#0d0d0d" />
      <circle cx="112" cy="95" r="2.6" fill="#0d0d0d" />
      <path
        d="M99 102 q6 5 12 0"
        stroke="#0d0d0d"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />

      {/* body */}
      <path
        d="M87 152 v-26 a18 18 0 0 1 36 0 v26 z"
        fill="#f7f5f0"
      />
    </svg>
  );
}

type Tier = {
  name: string;
  price: string;
  unit: string;
  cap: string;
  popular?: boolean;
  features: string[];
  cta: string;
  href: string;
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    price: "Rs 4,000",
    unit: "/ month",
    cap: "Up to 100 students",
    features: [
      "Fee engine — vouchers, discounts, arrears, fines",
      "Attendance and marks",
      "Parent portal",
      "Email reminders",
      "Cash receipts and one ledger",
    ],
    cta: "Join the waitlist",
    href: "#waitlist",
  },
  {
    name: "Academy",
    price: "Rs 9,000",
    unit: "/ month",
    cap: "Up to 300 students",
    popular: true,
    features: [
      "Everything in Starter",
      "WhatsApp follow-ups, escalating by aging bucket",
      "AI progress remarks with teacher approval",
      "Parent chatbot in English and Urdu",
      "Online payments with pay links",
    ],
    cta: "Join the waitlist",
    href: "#waitlist",
  },
  {
    name: "Campus",
    price: "Custom",
    unit: "",
    cap: "300+ students, or more than one branch",
    features: [
      "Everything in Academy",
      "Multiple branches on one account",
      "Records migrated for you before day one",
      "Priority onboarding and support",
    ],
    cta: "Talk to us",
    href: "mailto:connect@lowcodeflow.co?subject=AcademyOS%20—%20Campus%20plan",
  },
];

export default function Pricing() {
  return (
    <section className="sec sec--ink" id="pricing">
      <div className="wrap">
        <p className="eyebrow" style={{ margin: 0 }}>
          What it costs
        </p>
        <h2 className="sec-title" style={{ marginBottom: 24 }}>
          Priced by how many
          <br />
          students you actually have.
        </h2>
        <p className="lead" style={{ marginTop: 0 }}>
          No per-teacher seats, no setup fee, no charge for parent accounts.
          One monthly number that moves when the academy grows.
        </p>

        <div className="tiers">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`tier${t.popular ? " tier--pop" : ""}`}
              tabIndex={0}
            >
              <Toon />
              {t.popular && <span className="tier__flag">Most academies</span>}

              <span className="tier__name">{t.name}</span>
              <div className="tier__price">
                <b>{t.price}</b>
                {t.unit && <span>{t.unit}</span>}
              </div>
              <p className="tier__cap">{t.cap}</p>

              <ul className="tier__list">
                {t.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>

              <a className="tier__cta" href={t.href}>
                {t.cta}
              </a>
            </div>
          ))}
        </div>

        <p className="tier__note">
          Placeholder rates &middot; waitlist academies keep the launch price
          for their first year
        </p>
      </div>
    </section>
  );
}
