"use client";

import { useEffect, useRef, useState } from "react";

const FACTS = [
  {
    n: "4",
    title: "line items on every voucher",
    desc: "Monthly tuition, sibling discount, arrears carried forward, late fine. Nothing is a round number nobody can explain.",
  },
  {
    n: "2",
    title: "channels behind every reminder",
    desc: "Email and WhatsApp, in English or Urdu. Both logged with the template version that sent them.",
  },
  {
    n: "1",
    title: "ledger, append-only",
    desc: "Cash and online land in the same place. Balances are computed from it, never edited in it. Corrections are new entries with a reason.",
  },
];

export default function Stats() {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return setSeen(true);
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setSeen(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0, rootMargin: "0px 0px -15% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      className={`sec sec--ink is-ready${seen ? " is-in" : ""}`}
      ref={ref}
    >
      <div className="wrap">
        <p className="eyebrow" style={{ margin: 0 }}>
          By design
        </p>
        <h2 className="sec-title" style={{ marginBottom: 24 }}>
          Three numbers that
          <br />
          are true on day one.
        </h2>
        <p className="lead" style={{ marginTop: 0 }}>
          Not projections. This is how the system is built — you can check
          every one of them the first month you run it.
        </p>

        <div className="facts">
          {FACTS.map((f, i) => (
            <div
              className="fact reveal"
              key={f.n}
              style={{ ["--d" as string]: `${i * 90}ms` }}
            >
              <div className="fact__n">{f.n}</div>
              <h3 className="fact__t">{f.title}</h3>
              <p className="fact__d">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
