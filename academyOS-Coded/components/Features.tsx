"use client";

import { useEffect, useRef, useState } from "react";

type Card = {
  n: string;
  title: string;
  desc: string;
  hero?: boolean;
};

const FEATURES: Card[] = [
  {
    n: "01",
    title: "The fee engine",
    desc: "Vouchers generate themselves on schedule. Sibling discounts applied, arrears carried forward, late fines accrued — and every voucher shows the math it was built from.",
    hero: true,
  },
  {
    n: "02",
    title: "Attendance",
    desc: "One tap per student. A batch is marked in under a minute, and the owner watches it land live.",
  },
  {
    n: "03",
    title: "Marks & tests",
    desc: "Enter marks in a grid, publish when you're ready. Parents see the score beside the batch average.",
  },
  {
    n: "04",
    title: "Automatic follow-ups",
    desc: "Reminders that open polite and turn firm — by email and WhatsApp, in English or Urdu. They stop the day the payment lands, not the day you remember to stop them.",
  },
  {
    n: "05",
    title: "AI progress remarks",
    desc: "Two hundred remarks drafted from real attendance and test data. Teachers approve, edit or reject. Nothing reaches a parent unapproved.",
  },
  {
    n: "06",
    title: "Parent portal",
    desc: "Dues, attendance, marks and remarks for every child in the family. One login, on their phone.",
  },
  {
    n: "07",
    title: "Online payments",
    desc: "A pay link inside every voucher. Cash at the desk still issues a receipt. Both land in the same ledger.",
  },
  {
    n: "08",
    title: "Parent chatbot",
    desc: "“What do I owe?” — answered from live data at 11pm, in English or Urdu, without waking you up.",
  },
];

const MATH: [string, string][] = [
  ["Monthly tuition", "4,500"],
  ["Sibling discount", "−450"],
  ["Arrears carried forward", "4,500"],
  ["Late fine", "200"],
];

export default function Features() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"" | "is-ready" | "is-ready is-in">("");

  useEffect(() => {
    setState("is-ready");
    const el = gridRef.current;
    if (!el || !("IntersectionObserver" in window)) {
      setState("is-ready is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setState("is-ready is-in");
            io.disconnect();
          }
        });
      },
      { threshold: 0, rootMargin: "0px 0px -12% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className="sec sec--ink" id="features">
      <div className="wrap">
        <p className="eyebrow" style={{ margin: 0 }}>
          What it does
        </p>
        <h2 className="sec-title" style={{ marginBottom: 24 }}>
          Everything the register
          <br />
          was supposed to do.
        </h2>
        <p className="lead" style={{ marginTop: 0 }}>
          Eight things the academy needs every month. The first one is the
          reason the rest are worth having.
        </p>

        <div className={`bento ${state}`} ref={gridRef}>
          {FEATURES.map((f, i) => (
            <article
              key={f.n}
              className={`bcard b${i + 1}${f.hero ? " bcard--hero" : ""}`}
              style={{ ["--i" as string]: i }}
              tabIndex={0}
            >
              <span className="bcard__n">{f.n}</span>
              <h3 className="bcard__t">{f.title}</h3>
              <p className="bcard__d">{f.desc}</p>

              {f.hero && (
                <div className="math" aria-label="Example voucher breakdown">
                  {MATH.map(([label, amt]) => (
                    <div className="math__row" key={label}>
                      <span>{label}</span>
                      <b>{amt}</b>
                    </div>
                  ))}
                  <div className="math__row math__row--total">
                    <span>Total due &middot; PKR</span>
                    <b>8,750</b>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
