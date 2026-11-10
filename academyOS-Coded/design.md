# AcademyOS — Landing Page Design Specification (v2)
**For: v0 (Next.js App Router + Tailwind). Design + copy only. No backend, no data logic.**

*v2 changes: header and footer locked against the supplied references; hero moved onto a full-bleed bright band and centred; stats band inverted; English-only confirmed.*

---

## 0. How to use this document

This is the complete design brief. Everything v0 needs — art direction, tokens, type scale, motion, section layouts, and final copy — is here. Build the page exactly as specified.

**Do not build:** form submission logic, database calls, email sending, analytics, auth, CMS, i18n. The waitlist form is **UI only** — hold the value in local state and render the success state. Wiring happens elsewhere.

**Language: English only.** No Urdu toggle, no language switcher, no `next-intl`. (Urdu exists inside the product for parent-facing messages — it is not a landing page concern, and it is mentioned once in feature copy as a product capability.)

---

## 1. The brief in one line

> **Editorial minimalism.** Oversized Satoshi type, flat bands of one bright colour against near-black and bone. No gradients, no glass, no shadows, no illustration. The typography *is* the design.

**Audience:** owners and admins of tuition academies in Pakistan. Mid-range Android phones, most of the time. They are not shopping for software — they are tired of a paper fee register. The page must read like a tool, not a brochure.

**The recurring motif — content cut by the edge.** Two moments repeat the same idea: the voucher card is sliced by the bottom of the hero band, and the wordmark is sliced by the end of the page. Nothing else on the page is cropped, which is what makes those two land.

---

## 2. Reference read — what was taken, what was left

| Reference | Verdict | Taken | Left behind |
|---|---|---|---|
| **UMANO** (orange hero, cream pill nav) | ✅ **Header winner** | Content-hugging pill nav floating on a flat colour band; heavy black display type on saturated colour; solid black pill CTA inside the nav; centred hero composition | The chunky retro serif display face, the photographic phone-in-hand shot |
| **Supaste** (blue hero, dark pill nav) | ◐ Partial | Small icon mark beside the wordmark; the row of three reassurance micro-labels beneath the CTA; product artefact cropped at the bottom of the hero | Gradient background, italic serif second line, drop shadows, glassy app window |
| **CVNT** (giant clipped wordmark) | ✅ **Footer winner** | The whole structure — quiet link columns with lots of air, then an enormous wordmark cut off by the end of the page | Gradient wash, photographic hangtag, lowercase setting (uppercase clips cleanly at a uniform height; lowercase descenders make the cut look accidental) |
| **Epiminds** (dark CTA footer) | ◐ Partial | The eyebrow treatment — a short rule followed by a tracked uppercase label; the small right-aligned meta link row | Serif/italic mixing, particle imagery, dark-on-dark card stacking. It's a CTA block dressed as a footer — our CTA already has its own band |

**Net:** UMANO's header + CVNT's footer, with Supaste's micro-details and Epiminds' eyebrow rule. All four references centre their hero — so the hero is centred, and every other section stays left-aligned.

---

## 3. Art direction — the rules

**Do**
- Let type carry every section. Headlines are the hero element, not decoration around an image.
- Use full-bleed bands of flat colour to separate sections. Section identity comes from background colour, not from cards.
- Keep hairline `1px` rules as the primary divider. Borders over shadows, always.
- Number things. `01 / 02 / 03` in the bright colour is the recurring visual device across pain points, features, and steps.
- Every eyebrow gets a leading rule: `——— WHAT IT DOES` (24px rule, 12px gap, tracked uppercase label).
- Crop exactly twice — the hero voucher card and the footer wordmark. Nowhere else.

**Never**
- ❌ Gradients of any kind (backgrounds, text, borders, buttons)
- ❌ Glassmorphism, `backdrop-blur` frosted cards, inner glows
- ❌ Drop shadows on cards (single exception: the nav's `0 2px 12px rgba(13,13,13,0.06)`)
- ❌ Inter, Roboto, system-ui, Space Grotesk, or any serif — Satoshi only
- ❌ Purple/violet, teal-to-blue SaaS palettes, "AI sparkle" iconography, emoji as icons
- ❌ Stock illustration, 3D blobs, mesh backgrounds, photographic mockups, floating browser frames
- ❌ More than one accent colour on screen at a time
- ❌ Fake logos ("as seen in"), fake testimonials, fake avatars

---

## 4. Colour

Three colours. That is the whole system.

```css
:root {
  /* core */
  --ink:        #0D0D0D;  /* secondary — near-black: backgrounds, all body text */
  --paper:      #F7F5F0;  /* bone off-white — neutral page background */
  --bright:     #FF4E18;  /* primary — signal orange: hero band, CTA band, numerals */

  /* support (derived only — no new hues) */
  --ink-soft:   #1A1A1A;  /* raised surface on ink bands */
  --paper-soft: #EDEAE3;  /* raised surface on paper bands */
  --muted:      #6B6B66;  /* secondary text on paper */
  --muted-dark: #8A8A84;  /* secondary text on ink */
  --line:       rgba(13,13,13,0.12);      /* hairline on paper and on bright */
  --line-dark:  rgba(247,245,240,0.16);   /* hairline on ink */
}
```

**Distribution:** roughly 45% paper, 35% ink, 20% bright. Bright owns the two moments that matter — the first screen and the ask — and appears nowhere else except numerals.

**Contrast pairs (locked — do not improvise):**

| Background | Body text | Display text | Notes |
|---|---|---|---|
| `--paper` | `--ink` (17.7:1) | `--ink` | default |
| `--paper` | `--muted` (4.9:1) | — | subheads, captions |
| `--ink` | `--paper` | `--paper` | features, stats, footer |
| `--ink` | `--muted-dark` (5.6:1) | — | secondary text |
| `--ink` | `--bright` (5.9:1) | `--bright` | numerals, single highlighted words |
| `--bright` | `--ink` (5.8:1) | `--ink` | **always ink on bright** — hero and CTA type is black |
| `--bright` | — | `--paper` (3.3:1) | permitted at ≥40px display only; avoid if in doubt |

**Section background sequence (top to bottom):**

`bright (hero) → ink (marquee strip) → paper (problem) → ink (features) → paper (how it works) → ink (stats) → paper (FAQ) → bright (CTA) → ink (footer)`

Alternating flat bands are the page's structure. Bright bookends the page; ink carries the density; paper gives the reader air between them.

**No dark mode.** One deliberate palette; the page already inverts itself four times. Do not add a theme toggle or `prefers-color-scheme` handling.

---

## 5. Typography

### 5.1 Font

**Satoshi** (Fontshare), variable, the only family on the page.

```css
@import url('https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap');
```

Or self-host via `next/font/local` with the variable `.woff2` for better LCP — preferred if v0 supports it. Weights used: **400 / 500 / 700 / 900**. Never synthesise weights. No second family, no serif, no italic.

### 5.2 Scale (mobile → desktop, fluid)

| Role | `clamp()` | Weight | Tracking | Leading |
|---|---|---|---|---|
| **Display / hero** | `clamp(3.25rem, 13vw, 9rem)` | 900 | `-0.045em` | `0.88` |
| **Section title** | `clamp(2.25rem, 8vw, 5rem)` | 900 | `-0.04em` | `0.92` |
| **Feature row title** | `clamp(1.5rem, 5.5vw, 2.75rem)` | 700 | `-0.03em` | `1.05` |
| **Stat numeral** | `clamp(4rem, 16vw, 9rem)` | 900 | `-0.05em` | `0.85` |
| **Lead paragraph** | `clamp(1.125rem, 3.6vw, 1.5rem)` | 400 | `-0.01em` | `1.45` |
| **Body** | `1rem → 1.0625rem` | 400 | `0` | `1.6` |
| **Footer link** | `1.125rem` | 500 | `-0.01em` | `2` |
| **Label / eyebrow** | `0.6875rem` | 500 | `0.14em`, UPPERCASE | `1` |
| **Numeral index (01, 02)** | `0.8125rem` | 500 | `0.08em` | `1` |
| **Footer wordmark** | fills viewport width — see §9.9 | 900 | `-0.06em` | `0.75` |

### 5.3 Rules

- Headlines break across lines **manually** — explicit `<br />` or block-level spans, never natural wrapping. Every hero and section title is a composed shape.
- Optical alignment: `margin-left: -0.05em` on left-aligned display text so the first glyph sits flush with the container edge. Not needed on the centred hero.
- One word per headline may be set apart in colour. Never two.
- Body copy caps at `62ch`. Lead paragraphs cap at `38ch`.
- No italics anywhere. No text-shadow. No letter-spacing on body text.

---

## 6. Layout & shape

- **Mobile-first.** Design at 390px, then 768px, then 1280px.
- Page gutter: `20px` mobile, `40px` tablet, `64px` desktop.
- Max content width: `1360px`, centred. Colour bands run edge-to-edge; content inside respects the container.
- Vertical rhythm: `96px` mobile / `160px` desktop between sections (`py-24 md:py-40`). Hero and final CTA get more: `120px / 200px`.
- **Radii:** `--r-pill: 9999px` (nav, buttons, tags, inputs) · `--r-card: 20px` (grouped blocks, voucher card, step cards) · `0` for full-bleed bands.
- **Borders:** `1px solid var(--line)` is the default separator. Feature rows, FAQ items, stats, and footer meta are separated by hairlines, not gaps.
- Spacing scale: 4px base — `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 160`.
- Grid: single column on mobile. `grid-cols-2` at 768px for stats and how-it-works, `grid-cols-3` at 1280px.

---

## 7. Motion

**Principle: one orchestrated entrance, then near-silence.** CSS transitions or Framer Motion `whileInView` with `once: true`.

| Element | Motion |
|---|---|
| Hero lines | Mask reveal: each line in `overflow:hidden`, child `translateY(100%) → 0`, `700ms cubic-bezier(0.16,1,0.3,1)`, stagger `90ms` |
| Hero sub + CTA | Fade + `translateY(12px) → 0`, `500ms`, delay `380ms` |
| Hero voucher card | Rises `translateY(40px) → 0` + fade, `800ms`, delay `620ms` — the last thing to arrive |
| Nav | Fades in at `200ms`; on `scrollY > 24` vertical padding `16px → 10px` and the shadow appears, `250ms ease` |
| Section reveals | `opacity 0→1`, `translateY(16px) → 0`, `500ms ease-out`, threshold `0.2`, stagger `60ms` |
| Feature row (desktop) | On hover: `--bright` bar wipes in from left (`scaleX 0→1`, origin left, `400ms`), title shifts `translateX(12px)`, index numeral flips to `--ink` |
| Feature row (mobile) | Tap to expand description — `grid-template-rows: 0fr → 1fr`, `320ms ease` |
| Persona tabs | Active underline slides between tabs, `300ms cubic-bezier(0.16,1,0.3,1)` |
| Stat numerals | Count up from 0 over `900ms ease-out` at 40% in view, once |
| Marquee strip | `translateX` loop, `36s linear infinite`, pauses on hover |
| Accordion | `grid-template-rows` trick, `300ms ease`; `+` rotates 45° to `×` |
| Buttons | Colour swap `160ms`; `active:scale-[0.98]` |
| Footer wordmark | `translateY(18%) → 0` as it enters view, `800ms cubic-bezier(0.16,1,0.3,1)` |

**Forbidden:** parallax, mouse-follow blobs, tilt-on-hover, autoplay video, spring bounce, looping ambient animation (the marquee is the single exception), anything that moves while the user is reading.

**Reduced motion** — wrap globally:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```
Reveals render instant and fully opaque. Marquee renders static. Count-ups render their final value.

---

## 8. Components

**Sticky nav — the UMANO pill** *(the single most important component; get it exact)*
- `position: fixed; top: 14px; z-index: 50`. **Hugs its content** — `width: auto`, `max-width: min(920px, calc(100% - 24px))`, centred with `left: 50%; transform: translateX(-50%)`. It is not a full-width bar.
- Height `58px` mobile / `68px` desktop. Radius `9999px`. Inner padding `8px 8px 8px 22px` (tight right padding because the CTA pill sits inside the edge).
- Fill: `--paper`, always. Plus `1px solid var(--line)` and the one permitted shadow `0 2px 12px rgba(13,13,13,0.06)` — this keeps it legible over the bright hero, the paper sections *and* the ink sections without ever changing colour.
- **Left:** `6px` `--bright` rounded square mark, `10px` gap, wordmark `AcademyOS` — weight 900, `18px`, `-0.03em`.
- **Centre** (≥1024px only): `Features · How it works · FAQ` — `15px`, weight 500, `--muted`; hover `--ink`; gap `28px`.
- **Right:** ink pill button, `Join waitlist`, `--paper` text, weight 700, `15px`, padding `14px 24px`.
- **Mobile:** mark + wordmark left, compact ink pill (`Join`) right, no links, no hamburger — the page has three anchors and is short enough to scroll. If a menu is later required: full-screen `--ink` overlay, links at `clamp(2rem, 9vw, 3.5rem)`.

**Button — primary**
Pill. `--ink` fill, `--paper` text, weight 700, `16px`, padding `18px 32px` mobile / `20px 40px` desktop. Hover: fill → `--paper`, text → `--ink` (on bright and ink bands) or fill → `--bright`, text → `--ink` (on paper bands). No border, no shadow.

**Button — secondary / ghost**
Pill, transparent fill, `1px solid` the band's line colour, current text colour. Hover: fills with the text colour and inverts.

**Eyebrow**
`24px` × `1px` rule in the current text colour at 40% opacity, `12px` gap, then the tracked uppercase label. Used above every section title.

**Tag pill**
Pill, `1px solid var(--line)`, padding `7px 16px`, label type. Optional `6px` dot before the text.

**Input**
Pill, height `58px`, `1px solid var(--line)`, transparent fill, `16px` text (never below 16px — prevents iOS zoom), placeholder at 60% opacity. Focus: border → `--ink`, plus `2px` offset focus ring.

**Hairline row**
Full-width, `border-top: 1px solid`, `py-8 md:py-10`, grid `[index 44px] [title 1fr] [description] [chevron 24px]`.

---

## 9. Sections — layout + final copy

### 9.1 Hero — `--bright` band

Full-bleed signal orange, edge to edge, `min-h-[92svh]` mobile / `min-h-[880px]` desktop, `overflow: hidden`. All type `--ink` (black on orange — UMANO's exact relationship). **Centred**, and the only centred section besides the CTA.

Composition, top to bottom, with the nav floating over it:

1. Eyebrow, centred: `——— NOW ONBOARDING ACADEMIES`
2. Headline, three composed lines, display scale, weight 900:

> **Your fee**
> **register.**
> **Finally digital.**

3. Lead paragraph, `max-w-[38ch]`, centred, `--ink` at 80% opacity:
   *Vouchers, payments, attendance, marks and parent updates — one platform for the whole academy.*
4. Primary button: `Join the waitlist` (ink fill, paper text).
5. Reassurance row — three items, label type, `--ink` at 65%, separated by `32px` gaps (stacked to two lines on mobile):
   `NO CARD REQUIRED` · `SETUP DONE FOR YOU` · `ONE EMAIL WHEN WE OPEN`
6. **The voucher card** — sits below, `max-w-[560px]`, centred, and is **clipped by the bottom edge of the band** (roughly 35% of it is cut off). Built in HTML/CSS — never an image, never a screenshot.

**Voucher card spec:** `--paper` fill, radius `20px`, `p-6`, internal hairline rows.
- Header row: `VOUCHER · MARCH 2026` (label type, `--muted`) with an ink pill on the right reading `UNPAID` (paper text, `11px`, tracked).
- Student line: **Ayesha Khan** weight 700 `18px`, then `Batch 9-B · Due 10 March` in `--muted` `14px`.
- Four hairline line-items, label left in `--muted`, figure right in `--ink` weight 500, tabular:
  `Monthly tuition — 4,500` · `Sibling discount — −450` · `Arrears carried forward — 4,500` · `Late fine — 200`
- Total row, heavier hairline above: `Total due` weight 700 `20px` / `8,750` weight 900 `28px`.
- The clip should fall around the arrears row, so the reader sees enough to understand it and is pulled downward.

*Alternate headlines if the client wants options — pick one, do not A/B in the build:*
1. `Put the register down.`
2. `The academy runs. You just review it.`

### 9.2 Marquee strip — `--ink`

Single row, `56px` tall, label type in `--paper`, items separated by `--bright` diamonds, scrolling right-to-left. Sits directly under the hero clip line, which makes the crop feel deliberate.

`MONTHLY VOUCHERS ◆ SIBLING DISCOUNTS ◆ ARREARS CARRIED FORWARD ◆ LATE FINES ◆ CASH & ONLINE ◆ ATTENDANCE IN 60 SECONDS ◆ AI PROGRESS REMARKS ◆ PARENT PORTAL ◆`

### 9.3 The problem — `--paper`

Left-aligned from here on.

- Eyebrow: `——— BEFORE ACADEMYOS`
- Section title: **Three things eat every month.**
- Three hairline rows, `01 / 02 / 03` numerals in `--bright`:

**01 — The register goes missing in March.**
Fee history lives in one notebook. One spill, one misplaced page, and last month's arrears become a guess.

**02 — Follow-ups eat the day.**
Every unpaid voucher is a phone call you have to remember to make. Most months, you don't.

**03 — The front desk answers the same question forty times.**
*"What do I owe?" "Was she present yesterday?" "When's the test?"* Every question ends at your desk.

### 9.4 Features — `--ink`

Eight hairline rows, full width. Index numerals `--bright`, titles `--paper`, descriptions `--muted-dark`. Desktop: description in the right column, always visible. Mobile: title + index only, tap to expand.

- Eyebrow: `——— WHAT IT DOES`
- Section title: **Everything the register was supposed to do.**

| # | Title | Description |
|---|---|---|
| 01 | **Fee engine** | Vouchers generate themselves on schedule. Sibling discounts applied, arrears carried forward, late fines added. Every voucher shows its own math. |
| 02 | **Attendance** | One tap per student. A batch is marked in under a minute — and the owner watches it happen live. |
| 03 | **Marks & tests** | Enter marks in a grid. Publish when you're ready. Parents see the score next to the batch average. |
| 04 | **AI progress remarks** | Two hundred monthly remarks, drafted from real attendance and test data. Teachers approve, edit or reject. Nothing reaches a parent unapproved. |
| 05 | **Parent portal** | Dues, attendance, marks and remarks for every child in the family. One login, on their phone. |
| 06 | **Automatic follow-ups** | Reminders that start polite and get firm. They stop the day the payment lands. |
| 07 | **Online payments** | A pay link inside every voucher. Cash at the desk still gets a receipt. Both land in the same ledger. |
| 08 | **Parent chatbot** | *"What do I owe?"* — answered from live data at 11pm, in English or Urdu, without waking you up. |

### 9.5 How it works — `--paper`

- Eyebrow: `——— HOW IT WORKS`
- Section title: **Three people. Three screens.**
- Tabs: `Owner` · `Teacher` · `Parent`. Active = weight 900, `--ink`, `2px` `--bright` underline. Inactive = weight 500, `--muted`.
- Steps: horizontal scroll-snap on mobile (cards `78vw`), 4-across on desktop. Each: `01` numeral in `--bright`, then one line. Card = `--paper-soft`, radius `20px`, `p-6`.

**Owner** — 01 Set up batches and fee rules once. · 02 Vouchers go out on schedule. · 03 Cash and online land in one ledger. · 04 Defaulters surface on their own.

**Teacher** — 01 Open today's batch. · 02 Tap attendance. · 03 Enter test marks. · 04 Approve the drafted remarks.

**Parent** — 01 Open the portal. · 02 See what's due. · 03 Pay online, or at the desk. · 04 Read the month's remark.

### 9.6 Numbers — `--ink`

Three oversized stats. Mobile: stacked, hairline-separated. Desktop: three columns with vertical hairlines between. Numeral `--bright`, label beneath in `--muted-dark`.

- Eyebrow: `——— WHAT WE'RE BUILDING TOWARD` *(honest framing — these are design targets, not results)*

| Numeral | Label |
|---|---|
| **150+** | students on one screen |
| **60s** | to mark a full batch |
| **1hr** | for the month's remarks, not a weekend |

### 9.7 FAQ — `--paper`

Accordion. Full-width hairline rows, no card container. Question `20px` weight 700; answer `--muted`, `max-w-[62ch]`. `+` rotates to `×`. One open at a time; first open by default.

- Eyebrow: `——— QUESTIONS`
- Section title: **Questions, answered.**

1. **Do I need to be technical?** — No. If you can use WhatsApp, you can run AcademyOS. Setup is done for you before you start.
2. **Does it work on my phone?** — It's built phone-first. Teachers mark attendance on theirs, parents check dues on theirs.
3. **What happens to my old records?** — Bring the last few months of fees and we'll load them in, so arrears carry forward correctly from day one.
4. **Can parents pay online?** — Yes — a pay link sits inside every voucher. Cash at the front desk is recorded the same way, with a receipt.
5. **Is my academy's data safe?** — Every family can only ever see their own children's records. That's enforced at the database level, not by hiding buttons.
6. **What does it cost?** — Pricing is being finalised. Waitlist academies get the launch rate, locked for the first year.

### 9.8 Waitlist CTA — `--bright` band

Centred, mirroring the hero. All type `--ink`.

- Eyebrow: `——— THE ASK`
- Section title (display scale): **Ready to close the register?**
- Sub, `max-w-[38ch]`, centred: *Join the waitlist. We're onboarding a small first group of academies.*
- Form: pill input (`your@academy.com`) + ink pill button (`Join`). Mobile: stacked, full-width. Desktop: input and button share one `560px` pill container.
- Microcopy beneath, label type: `ONE EMAIL WHEN WE OPEN. NOTHING ELSE.`
- **Success:** form crossfades (`300ms`) to an ink check glyph + **You're on the list.** / *We'll be in touch before launch.*
- **Error:** ink border on the input + `Enter a valid email address.` beneath, `14px`.
- **Loading:** button label → `Joining…`, input disabled at 60% opacity.

*UI only — local state, no network call.*

### 9.9 Footer — `--ink` — the CVNT structure

Three stacked parts, then nothing.

**a) Link columns** — `pt-24 md:pt-32`, two columns on mobile, pushed to opposite ends on desktop. Links `1.125rem`, weight 500, `--muted-dark`, hover `--paper`, line-height `2`. Lots of air — this section is deliberately sparse.

| Left | Right |
|---|---|
| Features | Join the waitlist |
| How it works | connect@lowcodeflow.co |
| FAQ | Privacy |

**b) Meta row** — `1px solid var(--line-dark)` top border, `py-8`, `14px`, `--muted-dark`. Left: `Built for tuition academies in Pakistan.` Right: `© 2026 AcademyOS`. Stacks with `gap-3` on mobile.

**c) The wordmark** — the last element on the page.

`ACADEMYOS`, uppercase, weight 900, `--paper`, tracking `-0.06em`, spanning the full viewport width with **zero side gutter**, and clipped so that **only the top ~70% of the letterforms is visible**. The bottom 30% is cut by the end of the document and cannot be reached by scrolling. Uppercase is required — no descenders means the cut lands at a uniform height across all nine glyphs.

*Method A — SVG (recommended, deterministic at every viewport width):*
```html
<div class="w-full overflow-hidden leading-none">
  <svg viewBox="0 0 1000 101" width="100%" role="img" aria-label="AcademyOS"
       preserveAspectRatio="xMidYMin meet" style="display:block">
    <text x="0" y="144" textLength="1000" lengthAdjust="spacingAndGlyphs"
          font-family="Satoshi" font-weight="900" font-size="200"
          letter-spacing="-0.06em" fill="var(--paper)">ACADEMYOS</text>
  </svg>
</div>
```
`textLength="1000"` forces an exact edge-to-edge fit regardless of font metrics. The cap height at `font-size: 200` is ≈144, the baseline sits at y=144, and the `101`-unit viewBox shows the top 70% of that cap and clips the rest.

*Method B — CSS fallback:*
```css
.wordmark { overflow: hidden; height: 0.52em; display: block; }
.wordmark > span {
  display: block; white-space: nowrap;
  font-size: 19.5vw;          /* tuned so 9 caps fill the width — verify and nudge */
  font-weight: 900; line-height: 0.75; letter-spacing: -0.06em;
  color: var(--paper);
}
```

Either way: the clipping container is the **final element in the document** — no padding, no margin, no scroll space beneath it. Add `overflow-x: hidden` on the page wrapper as a safety net, and verify at 390 / 768 / 1440px that the word fills the width with no horizontal scrollbar.

---

## 10. Responsive

| Breakpoint | Behaviour |
|---|---|
| `< 768px` | Single column. Gutter `20px`. Nav = mark + wordmark + compact `Join` pill. Hero centred, headline at `13vw`, voucher card `92%` width. Feature rows collapse to tap-to-expand. How-it-works becomes a scroll-snap carousel. Stats stack with hairlines. Footer links two columns. |
| `768–1279px` | Gutter `40px`. Stats and how-it-works 2-up. Nav links still hidden. Display type scales up. |
| `≥ 1280px` | Gutter `64px`, container `1360px`. Nav links visible. Feature rows two-column with hover states. How-it-works 4 across. Stats 3 across with vertical dividers. Footer link columns pushed to opposite edges. |

Use `svh` not `vh` for the hero so mobile browser chrome doesn't cause a jump.

---

## 11. Accessibility

- Contrast pairs in §4 are pre-verified — do not substitute colours.
- Focus-visible: `2px` ring with `2px` offset on every interactive element — `--ink` on bright/paper bands, `--bright` on ink bands.
- Accordion: `<button>` with `aria-expanded` + `aria-controls`; panel `role="region"`.
- Tabs: `role="tablist"` / `role="tab"` / `role="tabpanel"` with arrow-key navigation.
- Form: real `<label>` (visually hidden is fine), `aria-invalid` on error, `aria-live="polite"` on success.
- Wordmark: real text or SVG `<text>` with `role="img"` + `aria-label` — never an image, never `aria-hidden`.
- Voucher card is illustrative content — give the wrapper `aria-hidden="true"` so screen readers don't read a fake student's fee breakdown as fact.
- Touch targets ≥ `44px`. Inputs ≥ `16px` text.
- Marquee is decorative → `aria-hidden="true"`.
- Landmarks: one `<h1>` (hero), `<h2>` per section, `<nav>`, `<main>`, `<footer>`. `lang="en"` on `<html>`.

---

## 12. Performance & meta

- Target Lighthouse mobile: ≥90 performance, ≥95 accessibility, ≥90 SEO.
- Self-host Satoshi via `next/font/local` if possible; otherwise preconnect to Fontshare. Latin subset, `font-display: swap`.
- **Zero images on the page.** The only asset needed is a favicon and an OG card: `1200×630`, `--bright` background, `ACADEMYOS` in `--ink`, headline beneath.
- No third-party scripts. Framer Motion only if the reveal choreography needs it — otherwise CSS `@keyframes` + IntersectionObserver is lighter and preferred.
- CLS: reserve height on the hero band and the wordmark clip.

```
title:       AcademyOS — Digital Operations for Tuition Academies
description: Fee vouchers, attendance, marks, AI progress remarks and a parent
             portal — one platform that replaces the paper register.
```

---

## 13. Explicitly out of scope

Waitlist storage, confirmation emails, pricing page, blog, auth, product screenshots, dark mode toggle, i18n/Urdu toggle, cookie banner, analytics. This is a static marketing surface with local-state form UI only.

---

## 14. Build order for v0

1. Tokens + Satoshi + global reset (`globals.css`)
2. `<Nav />` — the hug-content pill, fixed, with scroll state
3. `<Hero />` — bright band, centred mask-reveal choreography, voucher card clipped at the band edge *(get this right first; it sets the tone)*
4. `<Marquee />`
5. `<Problem />` — hairline rows
6. `<Features />` — ink band, eight rows, hover/expand
7. `<HowItWorks />` — tabs + scroll-snap steps
8. `<Stats />` — ink band, count-up
9. `<Faq />` — accordion
10. `<WaitlistCta />` — bright band, four form states
11. `<Footer />` — link columns, meta row, clipped wordmark
12. Reduced-motion pass, focus-ring pass, 390 / 768 / 1440 check

### Starter prompt for v0

> Build a mobile-first, English-only Next.js (App Router) + Tailwind marketing landing page for **AcademyOS**, a tuition-academy operations platform. Aesthetic: editorial minimalism — oversized Satoshi typography, flat contrastive colour bands, no gradients, no glassmorphism, no shadows, no images. Three colours only: `--ink #0D0D0D`, `--paper #F7F5F0`, `--bright #FF4E18`. Section backgrounds alternate bright → ink → paper → ink → paper → ink → paper → bright → ink.
>
> The hero is a full-bleed bright-orange band with centred black display type, and a floating **content-hugging** rounded pill navbar in bone white sits over it (mark + wordmark left, three links centre on desktop, black pill CTA right) — it hugs its content rather than spanning the width, stays bone white on every section, and is fixed 14px from the top. Beneath the hero copy sits a flat CSS voucher card that is clipped by the bottom edge of the orange band.
>
> Sections: hero, scrolling marquee strip, three problem rows, eight-row feature list on ink, persona tabs (Owner/Teacher/Parent), three oversized stats on ink, FAQ accordion, waitlist CTA on a bright band (UI-only form with idle/loading/success/error states), and a footer with two quiet link columns, a meta row, and then a giant uppercase `ACADEMYOS` wordmark that spans the full viewport width and is clipped so only the top 70% of the letters is visible at the very end of the page — no space below it.
>
> Motion is minimal: one staggered mask-reveal on load, `opacity + 16px` rise on scroll, nothing that loops except the marquee. Respect `prefers-reduced-motion`. Copy is supplied verbatim in the spec — do not rewrite it.