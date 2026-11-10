"use client";

import { useEffect, useRef, useState } from "react";

/* --- The artifacts: each problem carries a visual, not just prose --- */

function LedgerArt() {
  return (
    <div className="art">
      <div className="art__head">
        <span>Fee register &middot; 2026</span>
        <span className="art__stamp">Page torn</span>
      </div>
      <div className="art__row">
        <span>Jan &middot; Ayesha Khan</span>
        <b>4,500 paid</b>
      </div>
      <div className="art__row">
        <span>Feb &middot; Ayesha Khan</span>
        <b>4,500 paid</b>
      </div>
      <div className="art__row art__row--lost">
        <span>Mar &middot; Ayesha Khan</span>
        <b>4,500 paid</b>
      </div>
      <div className="art__row art__row--lost">
        <span>Mar &middot; Bilal Khan</span>
        <b>3,900 paid</b>
      </div>
      <div className="art__foot">March is now a negotiation</div>
    </div>
  );
}

function CallsArt() {
  const rows: [string, string, boolean][] = [
    ["Khan family", "8,750", true],
    ["Iqbal family", "4,500", true],
    ["Siddiqui family", "13,200", false],
    ["Raza family", "4,700", false],
    ["Malik family", "9,000", false],
    ["Butt family", "4,500", false],
  ];
  return (
    <div className="art">
      <div className="art__head">
        <span>Overdue &middot; March</span>
        <span className="art__stamp">6 of 8 not called</span>
      </div>
      {rows.map(([name, amt, done]) => (
        <div
          key={name}
          className={`art__row${done ? " art__row--done" : ""}`}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <i
              className={`art__mark ${
                done ? "art__mark--done" : "art__mark--open"
              }`}
            />
            {name}
          </span>
          <b>{amt}</b>
        </div>
      ))}
      <div className="art__foot">Recovery runs on your memory</div>
    </div>
  );
}

function ChatArt() {
  return (
    <div className="art">
      <div className="art__head">
        <span>Front desk &middot; Monday</span>
        <span className="art__stamp">Again</span>
      </div>
      <div className="art__bubbles">
        <span className="art__bubble art__bubble--rtl" lang="ur" dir="rtl">
          فیس کتنی باقی ہے؟
        </span>
        <span className="art__bubble">Was Ayesha present yesterday?</span>
        <span className="art__bubble">When is the next test?</span>
        <span className="art__bubble art__bubble--ghost">
          Was Ayesha present yesterday?
        </span>
        <span className="art__bubble art__bubble--rtl art__bubble--ghost" lang="ur" dir="rtl">
          فیس کتنی باقی ہے؟
        </span>
      </div>
      <div className="art__foot">Every question ends at your desk</div>
    </div>
  );
}

const PROBLEMS = [
  {
    dot: "Lost records",
    metric: "1",
    title: "One spilled cup erases a month of arrears.",
    desc: "Fee history lives in a single notebook. One misplaced page and last month's balance becomes a guess — and the family remembers it differently than you do.",
    art: <LedgerArt />,
  },
  {
    dot: "Follow-ups",
    metric: "6/8",
    title: "The follow-ups you meant to make.",
    desc: "Every unpaid voucher is a phone call you have to remember. By the third week the list is long, the day is short, and the calls quietly stop happening.",
    art: <CallsArt />,
  },
  {
    dot: "Front desk",
    metric: "40×",
    title: "The same three questions, every month.",
    desc: "What do I owe? Was she present? When is the test? Three questions, two hundred families, one front desk — and none of it is work only a person can do.",
    art: <ChatArt />,
  },
];

export default function Problem() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = trackRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      if (total <= 0) return setP(0);
      setP(Math.min(Math.max(-r.top / total, 0), 1));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const n = PROBLEMS.length;
  const index = Math.min(n - 1, Math.floor(p * n));

  return (
    <section className="prob" id="problem">
      <div className="prob__head">
        <p className="eyebrow" style={{ margin: 0 }}>
          Before AcademyOS
        </p>
        <h2 className="sec-title" style={{ marginBottom: 0 }}>
          Three things eat
          <br />
          every month.
        </h2>
      </div>

      <div
        className="prob__track"
        ref={trackRef}
        style={{ ["--n" as string]: n }}
      >
        <div className="prob__stage">
          <div className="prob__grid">
            <div className="prob__rail" aria-hidden="true">
              <span className="prob__rail-track" />
              <span
                className="prob__rail-fill"
                style={{ ["--p" as string]: p }}
              />
              <ol className="prob__dots">
                {PROBLEMS.map((item, i) => (
                  <li
                    key={item.dot}
                    className={`prob__dot${i <= index ? " is-on" : ""}`}
                  >
                    <span>{item.dot}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="prob__panels">
              {PROBLEMS.map((item, i) => (
                <article
                  key={item.title}
                  className={`prob__panel${i === index ? " is-on" : ""}`}
                  aria-hidden={i !== index}
                >
                  <div>
                    <div className="prob__metric">{item.metric}</div>
                    <h3 className="prob__ptitle">{item.title}</h3>
                    <p className="prob__pdesc">{item.desc}</p>
                  </div>
                  <div>{item.art}</div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
