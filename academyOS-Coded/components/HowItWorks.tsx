"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Screen = {
  key: string;
  persona: string;
  role: string;
  poster: string;
  /** Drop a real capture here once the backend lands — the card switches
   *  from the animated poster to an autoplaying <video> on its own. */
  video: string | null;
  steps: string[];
};

const SCREENS: Screen[] = [
  {
    key: "owner",
    persona: "Owner",
    role: "Runs the money",
    poster: "/screens/owner.svg",
    video: null,
    steps: [
      "Set up batches and fee rules once.",
      "Vouchers go out on schedule.",
      "Cash and online land in one ledger.",
      "Defaulters surface on their own.",
    ],
  },
  {
    key: "teacher",
    persona: "Teacher",
    role: "Runs the room",
    poster: "/screens/teacher.svg",
    video: null,
    steps: [
      "Open today's batch.",
      "Tap attendance.",
      "Enter test marks.",
      "Approve the drafted remarks.",
    ],
  },
  {
    key: "parent",
    persona: "Parent",
    role: "Never calls the desk",
    poster: "/screens/parent.svg",
    video: null,
    steps: [
      "Open the portal.",
      "See what's due.",
      "Pay online, or at the desk.",
      "Read the month's remark.",
    ],
  },
];

export default function HowItWorks() {
  const [active, setActive] = useState<string | null>(null);
  const [coarse, setCoarse] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  /* Touch devices have no cursor, so the card nearest the centre of the
     viewport becomes the active one as you scroll. */
  useEffect(() => {
    const isCoarse = !window.matchMedia("(hover: hover)").matches;
    setCoarse(isCoarse);
    if (!isCoarse) return;

    let raf = 0;
    const pick = () => {
      const grid = gridRef.current;
      if (!grid) return;
      const mid = window.innerHeight / 2;
      let best: string | null = null;
      let bestDist = Infinity;
      grid.querySelectorAll<HTMLElement>("[data-key]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        const dist = Math.abs(r.top + r.height / 2 - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = el.dataset.key ?? null;
        }
      });
      setActive(best);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(pick);
    };
    pick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const enter = useCallback(
    (key: string) => {
      if (!coarse) setActive(key);
    },
    [coarse]
  );

  const leave = useCallback(() => {
    if (!coarse) setActive(null);
  }, [coarse]);

  return (
    <section className="sec sec--paper" id="how">
      <div className="wrap">
        <p className="eyebrow" style={{ margin: 0 }}>
          How it works
        </p>
        <h2 className="sec-title" style={{ marginBottom: 24 }}>
          Three people.
          <br />
          Three screens.
        </h2>
        <p className="lead" style={{ marginTop: 0 }}>
          {coarse
            ? "Scroll through each screen to see it run."
            : "Hover a screen to watch it run. The other two step back."}
        </p>

        <div
          className={`screens${active ? " has-active" : ""}`}
          ref={gridRef}
          onMouseLeave={leave}
        >
          {SCREENS.map((s) => {
            const on = active === s.key;
            return (
              <button
                key={s.key}
                type="button"
                data-key={s.key}
                className={`scard${on ? " is-active" : ""}`}
                aria-pressed={on}
                aria-label={`${s.persona} screen`}
                onMouseEnter={() => enter(s.key)}
                onFocus={() => enter(s.key)}
                onClick={() => setActive(on ? null : s.key)}
              >
                <div className="scard__media">
                  {on && s.video ? (
                    <video
                      src={s.video}
                      poster={s.poster}
                      autoPlay
                      muted
                      loop
                      playsInline
                    />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={s.poster} alt={`${s.persona} screen`} />
                  )}
                  <span className="scard__scan" aria-hidden="true" />
                  <span className="scard__badge" aria-hidden="true">
                    <i />
                    Live
                  </span>
                </div>

                <div className="scard__body">
                  <div className="scard__persona">
                    <strong>{s.persona}</strong>
                    <span>{s.role}</span>
                  </div>
                  <ol className="scard__steps">
                    {s.steps.map((step, i) => (
                      <li key={step}>
                        <i>0{i + 1}</i>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
