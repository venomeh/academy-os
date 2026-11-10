# Teacher Attendance & Marks — Build Guide

Covers **Tasks.md §6.1 (Daily Marking)** and **§7 (Assessments & Marks)**.

Design rule: **one API call per screen.** No client-side joins in Bubble.
Every list a RepeatingGroup shows comes from a single RPC that already
contains names, existing values, counts and computed percentages.

---

## 0. Status snapshot

### Already applied to Supabase (live, tested)

| Function | Returns | Purpose |
|---|---|---|
| `pkt_today()` | date | Pakistan "today" |
| `batch_active_roster(batch, date)` | table | Active roster (distinct students) |
| `save_batch_attendance(batch, date, jsonb)` | jsonb | Bulk attendance upsert |
| `publish_assessment(assessment)` | jsonb | Publish with completeness gate |
| `attendance_summary(student, month)` | table | Monthly % |
| `get_attendance_progress_today()` | table | Admin tile |
| `batches_marked_today` (view) | view | Admin tile source |

### Applied and verified — `teacher_read_models`

`academyOS-server/supabase/migrations/20260807160000_teacher_read_models.sql`

| Function | Returns | Why it's needed |
|---|---|---|
| `get_my_batches_today(date)` | table | Teacher home list + progress |
| `get_attendance_sheet(batch, date)` | table | **Roster + existing marks in one call** |
| `create_assessment(batch, subject, date, max)` | jsonb | Forces `created_by`, validates subject |
| `get_my_assessments(batch)` | table | Assessment list + entry progress |
| `get_marks_sheet(assessment)` | table | **Roster + marks + % + batch average** |
| `save_batch_attendance_text(...)` | jsonb | Bubble-safe flat-string variant |
| `upsert_assessment_scores_text(...)` | jsonb | Bubble-safe flat-string variant |
| `upsert_assessment_scores` (**fix**) | jsonb | Blank mark = draft, not an error |

> **The fix matters.** The previous version threw when a mark was blank, which
> made §7's "partial entry can be saved as draft" impossible. The new version
> treats blank as *not entered* and removes any stale row.

All of the above are live and were exercised end-to-end as a teacher (save via
flat string → create assessment → partial draft → publish blocked → over-max
rejected → full save with an absent flag → publish → parent visibility →
published sheet locked), inside a transaction that rolled back. Live counts
after testing are unchanged: 5 active batches, 27 students, 30 enrollments,
0 attendance / assessments / scores.

---

## 1. Why the flat-string save variants exist

Bubble builds JSON from a RepeatingGroup badly — nested quotes get escaped and
PostgREST rejects the body. So each save has two doors:

| Door | Body | Use when |
|---|---|---|
| JSON | `p_marks: [{"student_id":"…","status":"present"}]` | You control the JSON exactly |
| **Text** | `p_marks: "uuid\|present,uuid\|absent"` | **Building from a RepeatingGroup — use this** |

The text parser **ignores empty segments**, so `",,"` from an empty Bubble list
is harmless. This is what makes the save bulletproof.

---

## 2. API Connector — global setup

**Do this once**, in the same API called `Supabase` you already use.

Shared headers (collection level):

| Key | Value | Private |
|---|---|---|
| `apikey` | anon key | ✅ checked |

**Per-call headers** (every call below):

| Key | Value | Private |
|---|---|---|
| `Authorization` | `Bearer <paste teacher JWT for Initialize>` | ❌ **unchecked** |
| `Content-Type` | `application/json` | ❌ unchecked |

`Authorization` **must stay unchecked** — pages overwrite it at runtime with
`"Bearer " + AuthGuard's access_token`. This is the same pattern the admin
pages already use.

### Getting a teacher JWT for Initialize

Run in a terminal, paste `access_token` into the header for initializing:

```bash
curl -s -X POST 'https://<PROJECT_REF>.supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: <ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"email":"<teacher email>","password":"<password>"}'
```

Initialize with a **teacher** token, not admin — that way you see exactly the
shape a teacher gets and you catch RLS problems now instead of in the UI.

---

## 3. The 8 calls to create

All RPC calls are `POST` to `/rest/v1/rpc/<function>`.

> **Data vs Action**
> Returns a **table** → *Use as: Data*
> Returns **jsonb** → *Use as: Action*

### 3.1 `Get My Batches Today` — Data

```
POST https://<PROJECT_REF>.supabase.co/rest/v1/rpc/get_my_batches_today?limit=[limit]
```

Body (JSON):
```json
{ "p_date": "<p_date>" }
```

| Param | Type | Initialize value |
|---|---|---|
| `p_date` | text | today, e.g. `2026-08-07` |
| `limit` (querystring) | number | `500` |

Verified response row:

```json
{
  "batch_name": "Grade 5 Evening",
  "start_time_text": "16:00:00",
  "end_time_text": "18:00:00",
  "attendance_date_text": "2026-08-07",
  "roster_count": 7,
  "marked_count": 0,
  "is_complete": false,
  "is_overdue": false,
  "status_label": "Not marked"
}
```

Also returns `batch_id`, `grade_level`, `days_text`.

> Times come back as `16:00:00`. In Bubble show
> `Current cell's start_time_text :truncated to 5` for `16:00`.

RLS gives a teacher only their assigned batches — no filtering needed in Bubble.

### 3.2 `Get Attendance Sheet` — Data ← **the important one**

```
POST .../rest/v1/rpc/get_attendance_sheet?limit=[limit]
```

```json
{ "p_batch_id": "<p_batch_id>", "p_date": "<p_date>" }
```

| Param | Initialize value |
|---|---|
| `p_batch_id` | a real batch uuid the teacher owns |
| `p_date` | today |
| `limit` | `500` |

Verified response row (before anything is marked):

```json
{
  "student_name": "Ahmed Ali",
  "status": "present",
  "is_marked": false,
  "roster_count": 7,
  "marked_count": 0,
  "can_edit": true,
  "attendance_date_text": "2026-08-07"
}
```

Also returns `student_id`, `attendance_id`, `is_corrected`, `batch_id`.
`status` is **never null** — it defaults to `present`.

This single call replaces the broken `Get Today Attendance` **and** a separate
roster call. Delete `Get Today Attendance` once this works.

### 3.3 `Save Attendance` — Action

```
POST .../rest/v1/rpc/save_batch_attendance_text
```

```json
{ "p_batch_id": "<p_batch_id>", "p_date": "<p_date>", "p_marks": "<p_marks>" }
```

Initialize `p_marks` with a real pair: `1111…|present`
Returns `{ batch_id, date, saved }`.

Verified: a 7-student string ending in stray commas (`…|present,,`) saved all 7
and ignored the empty segments — exactly what Bubble's empty lists produce.

### 3.4 `Get My Assessments` — Data

```
POST .../rest/v1/rpc/get_my_assessments?limit=[limit]
```

```json
{ "p_batch_id": "<p_batch_id>" }
```

Pass an empty string for "all batches" only if Bubble sends `null`; otherwise
always pass a batch id. Returns `assessment_id`, `batch_name`, `subject_name`,
`assessment_date_text`, `max_marks`, `published`, `roster_count`,
`scored_count`, `is_complete`, `status_label`.

### 3.5 `Create Assessment` — Action

```
POST .../rest/v1/rpc/create_assessment
```

```json
{
  "p_batch_id": "<p_batch_id>",
  "p_subject_id": "<p_subject_id>",
  "p_date": "<p_date>",
  "p_max_marks": <p_max_marks>
}
```

`p_max_marks` is a **number** — no quotes around the placeholder.
Returns `{ assessment_id, … }` — use `assessment_id` to open the marks sheet.

### 3.6 `Get Marks Sheet` — Data

```
POST .../rest/v1/rpc/get_marks_sheet?limit=[limit]
```

```json
{ "p_assessment_id": "<p_assessment_id>" }
```

Returns per row: `student_name`, `obtained`, `obtained_display` (**never null**),
`absent`, `pct_display`, `is_entered`, `max_marks`, `published`,
`roster_count`, `scored_count`, `batch_average_display`.

Verified with a mark of 85 out of 100: `pct_display` = `85.0%`,
`obtained_display` = `85`, and unscored students return `''` rather than null.

Percentages and batch average are computed server-side — §7 satisfied without
any Bubble math.

### 3.7 `Save Marks` — Action

```
POST .../rest/v1/rpc/upsert_assessment_scores_text
```

```json
{ "p_assessment_id": "<p_assessment_id>", "p_scores": "<p_scores>" }
```

Format: `uuid|85|false` · absent: `uuid||true` · clear: `uuid||false`

### 3.8 `Publish Assessment` — Action

```
POST .../rest/v1/rpc/publish_assessment
```

```json
{ "p_assessment_id": "<p_assessment_id>" }
```

Fails loudly if any roster student has no mark — that error text is the UI
message you show.

### Reuse as-is
`Get Subjects by Batch` (already exists, teachers can read subjects).

---

## 4. Initialize checklist — do not skip

For **each Data call**, after Initialize confirm:

- [ ] Bubble created a type ending in `body` (not just `error`/`headers`)
- [ ] The field list shows `student_name` / `batch_name` etc.
- [ ] Field types are sensible (`status` = text, `roster_count` = number)

If a Data call only produced `error` + `headers`, that is exactly the
`Get Today Attendance` failure — **fix it now**, never bind an RG to it.

Then, on every call, replace the pasted JWT with a placeholder so no expired
token ships in the app.

---

## 5. Page build — `teacher_today`

### 5.1 Custom states (on the page)

| State | Type | Purpose |
|---|---|---|
| `today` | text | `yyyy-mm-dd`, set on page load |
| `selected_batch_id` | text | which batch is open |
| `selected_batch_name` | text | header |
| `sheet_bust` | number | forces sheet reload |
| `absent_ids` | list of texts | tapped Absent |
| `late_ids` | list of texts | tapped Late |
| `leave_ids` | list of texts | tapped Leave |
| `saving` | yes/no | button state |

Three status lists + "everything else is present" is what makes the toggles
trivial: only `:plus item` / `:minus item`, no advanced filters.

### 5.2 Layout

```
┌────────────────────────────────────────────┐
│ Teacher – {name}        {today}   [Logout] │
├────────────────────────────────────────────┤
│ RG Batches (one row per batch)             │
│  Grade 5 Evening · 16:00–18:00             │
│  7 students · Marked 7/7        [Mark ▸]   │
├────────────────────────────────────────────┤
│ Group Sheet   (visible when batch selected)│
│  Grade 5 Evening — 7 students   [Save]     │
│  ┌──────────────────────────────────────┐  │
│  │ Ali Raza      [P][A][L][Lv]          │  │
│  │ Sara Khan     [P][A][L][Lv]          │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

### 5.3 Page load workflow

1. AuthGuard → **Load Session** (already exists, keep it)
2. Set state `today` = `Current date/time :formatted as yyyy-mm-dd`
3. Set state `sheet_bust` = `500`

### 5.4 RG Batches

- Type of content: `Get My Batches Today`'s body type
- Data source: **Get My Batches Today**
  - `Authorization` = `"Bearer " + AuthGuard's access_token`
  - `p_date` = page's `today`
  - `limit` = `500`
- Cell shows `batch_name`, `start_time_text`–`end_time_text`,
  `roster_count`, `marked_count`, `status_label`
- Conditional: when `is_overdue` is yes → row background red-ish
  (that is §6.1's "unmarked batches after cutoff are flagged")

**Mark button workflow**
1. Set state `selected_batch_id` = Current cell's `batch_id`
2. Set state `selected_batch_name` = Current cell's `batch_name`
3. Set states `absent_ids` / `late_ids` / `leave_ids` = *empty list* (clear old)

### 5.5 RG Roster (inside Group Sheet)

- Data source: **Get Attendance Sheet**
  - `p_batch_id` = page's `selected_batch_id`
  - `p_date` = page's `today`
  - `limit` = page's `sheet_bust`
- Group Sheet visible only when `selected_batch_id` is not empty

**Seed the toggles from saved data** — event *"RepeatingGroup Roster's list of
items is loaded"*:

1. Set `absent_ids` = `RG Roster's list :filtered (status = "absent") :each item's student_id`
2. Set `late_ids` = same with `"late"`
3. Set `leave_ids` = same with `"leave"`

Anything not in those three lists renders as **Present** — matching §6.1's
"default all-present".

### 5.6 The four status buttons (per cell)

| Button | Actions |
|---|---|
| Present | `absent_ids :minus item` · `late_ids :minus item` · `leave_ids :minus item` |
| Absent | `absent_ids :plus item` · minus from other two |
| Late | `late_ids :plus item` · minus from other two |
| Leave | `leave_ids :plus item` · minus from other two |

Item = `Current cell's student_id`.

**Selected styling** — conditional on each button:
`when page's absent_ids contains Current cell's student_id` → background solid.
Present button: `when none of the three lists contain the id` → solid.

### 5.7 Save button

Disabled when `saving` is yes, or `can_edit` is no.

Build `p_marks` as four joined chunks (empty chunks are safely ignored):

```
RG Roster's list of items :each item's student_id
  :minus list absent_ids :minus list late_ids :minus list leave_ids
  :formatted as text  →  "This text|present"  delimiter ","
+ ","
+ absent_ids :formatted as text → "This text|absent"  delimiter ","
+ ","
+ late_ids   :formatted as text → "This text|late"    delimiter ","
+ ","
+ leave_ids  :formatted as text → "This text|leave"   delimiter ","
```

Workflow:
1. Set `saving` = yes
2. **Save Attendance** — `p_batch_id`, `p_date` = `today`, `p_marks` = above
3. Set `sheet_bust` = `sheet_bust + 1` (reloads the sheet with saved values)
4. Display list on RG Batches → **Get My Batches Today** (refresh progress)
5. Set `saving` = no
6. *On error* → show alert with the returned message, set `saving` = no

Do **not** loop 25 separate inserts. One call, one round trip, matching §6.1's
"save once".

### 5.8 Empty & error states

| Condition | Show |
|---|---|
| RG Batches count = 0 | "No batches assigned to you yet." |
| `roster_count` = 0 | "No students enrolled in this batch today." |
| `can_edit` = no | Banner: "View only — teachers can edit today only." |
| Save error | Alert with the server message |

---

## 6. Page build — `teacher_assessments`

New page, same AuthGuard pattern.

### 6.1 States

`selected_batch_id`, `selected_assessment_id`, `assessments_bust`,
`marks_bust`, `marks_entered` (list of texts), `saving`.

### 6.2 Three panels

**A. Batch picker** — reuse **Get My Batches Today** (same call, no new API).

**B. Assessment list** — **Get My Assessments** with `p_batch_id`, `limit` =
`assessments_bust`. Show `subject_name`, `assessment_date_text`, `max_marks`,
`status_label` (`Draft — no marks` / `Draft — partial` / `Ready to publish` /
`Published`).

**C. Create assessment popup**
- Subject dropdown ← **Get Subjects by Batch** (`batch_id` = selected batch)
- Date picker, Max marks input
- Create → **Create Assessment** → set `selected_assessment_id` =
  `result's assessment_id` → bump `assessments_bust` → open marks sheet

### 6.3 Marks sheet

- RG Marks ← **Get Marks Sheet** (`p_assessment_id`, `limit` = `marks_bust`)
- Header: `batch_name` · `subject_name` · `max_marks` ·
  **`batch_average_display`** (already computed)
- Cell: `student_name` · number input (Initial content =
  `Current cell's obtained_display`) · Absent checkbox · `pct_display`

**On input value changed:**
```
Set state marks_entered =
  marks_entered :filtered (Advanced: This text :truncated to 36
                           is not Current cell's student_id)
              :plus item (Current cell's student_id + "|"
                          + This input's value + "|false")
```

A UUID is exactly 36 characters, so `:truncated to 36` is a reliable key —
this is the one Bubble trick worth memorising.

**On Absent checked:** same filter, `:plus item student_id + "||true"`

**Save Draft:** `p_scores` = `marks_entered :formatted as text` (This text, `,`)
→ bump `marks_bust`. Untouched students are simply not sent, so nothing is lost.

**Publish:** **Publish Assessment** → on success bump both busts; on error show
the server text (`cannot publish assessment …: N roster student(s) missing
marks or absent flag`). Hide/disable the button when `published` is yes.

Validation `obtained ≤ max_marks` is enforced by a DB trigger — surface the
error, don't duplicate the rule in Bubble.

---

## 7. Admin tile + realtime (after teacher pages work)

1. Admin dashboard RG ← **Get Attendance Progress Today**
   (`/rest/v1/rpc/get_attendance_progress_today`, Data)
2. Tile text: `count of is_complete = yes` / `total count`
3. In the Realtime bridge HTML, add an `attendance` subscription that clicks a
   hidden button; that button bumps the admin bust state

Do not wire realtime into `teacher_today` — a teacher marking their own batch
does not need a live feed.

---

## 8. Build order & test gates

| # | Do | Gate |
|---|---|---|
| 1 | ~~Apply the migration~~ | ✅ done — all 8 RPCs live and tested |
| 2 | Create the 8 calls, Initialize with a **teacher** token | Each Data call has a real body type |
| 3 | RG Batches only | Teacher sees only their batches, with counts |
| 4 | Batch → roster sheet | Names appear; all default Present |
| 5 | Toggles | Selected styling correct; state lists update |
| 6 | Save | DB rows created; reopening shows saved statuses |
| 7 | Re-save with changes | No duplicates (unique constraint holds) |
| 8 | Create assessment | Row appears as `Draft — no marks` |
| 9 | Partial marks → Save Draft | Saves without error, status `Draft — partial` |
| 10 | Fill all → Publish | Succeeds; parent can now see |
| 11 | Publish with a gap | Blocked with a clear message |

**Stop at any red gate.** Each one maps directly to a Tasks.md checkbox.

---

## 9. Requirement traceability

### §6.1 Attendance

| Requirement | Where it's met |
|---|---|
| One row per student/batch/date | DB unique constraint + upsert RPC |
| Teacher same-day only | RLS policy + `can_edit` flag |
| Admin corrects any date, logged | `audit_attendance_correction` trigger |
| Teacher's batches only | RLS on `batches` / `attendance` |
| Monthly % per student | `attendance_summary()` |
| Tile X/Y batches | `get_attendance_progress_today()` |
| Cutoff flag | `is_overdue` (21:00 PKT) |
| Tap-toggle, default present, save once | Section 5.6 / 5.7 |

### §7 Assessments & Marks

| Requirement | Where it's met |
|---|---|
| batch + subject + date + max marks | `create_assessment()` |
| Grid entry for roster | `get_marks_sheet()` + RG |
| Absent-for-test flag | `absent` column + checkbox |
| obtained ≤ max | `check_score_max` trigger |
| Percentages + batch average | `pct_display`, `batch_average_display` |
| Teachers restricted to batches | RLS + RPC role checks |
| Parents see published only | `scores_parent_select` policy |
| Partial entry saved as draft | fixed `upsert_assessment_scores` |
| Unpublished invisible to parents | verified in workflow tests |

---

## 10. Mistakes from the batches build — avoided here

| Old problem | Prevention |
|---|---|
| RG bound to a call with no body type | Section 4 checklist |
| Nested RG showed same data in every cell | One call per screen; no nesting |
| Wrong "Use as" (Data vs Action) | Table → Data, jsonb → Action |
| Expired admin JWT in headers | `Authorization` unchecked + runtime override |
| Lists not refreshing after write | `limit`-based bust states |
| Date format mismatches | RPCs return `*_date_text` as `yyyy-mm-dd` |
| Null fields dropped by Initialize | `coalesce` → `status`, `obtained_display` never null |
