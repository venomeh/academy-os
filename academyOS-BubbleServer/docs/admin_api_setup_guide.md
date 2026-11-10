# AcademyOS — Admin API Connector Setup Guide

> Provider: **Supabase Data** (existing)  
> Base URL: `https://<PROJECT_REF>.supabase.co`  
> Anon Key: `<SUPABASE_ANON_KEY>`  
> Academy ID: `00000000-0000-0000-0000-000000000001`

---

## Common Setup for Every Call

Every call gets these **two headers**:

| Header Key | Value | Private? |
|------------|-------|----------|
| `apikey` | (the anon key above) | No |
| `Authorization` | `Bearer ` | No — leave empty or put placeholder; at runtime you'll pass `Bearer` + AuthGuard's `access_token` dynamically |

Additionally, **POST** and **PATCH** calls get these extra headers:

| Header Key | Value | Private? |
|------------|-------|----------|
| `Content-Type` | `application/json` | No |
| `Prefer` | `return=representation` | No |

> **"return=representation"** makes Supabase return the created/updated row in the response — essential for getting the `id` of new records.

---

## How to Read This Guide

- **Use as: Data** = call is used as a data source for Repeating Groups, Dropdowns, etc.
- **Use as: Action** = call is used inside a Workflow (button click, etc.)
- **`[param]`** in the URL = URL parameter. Bubble auto-detects these. You'll pass them dynamically at runtime.
- **Body params** = fields you fill in via workflow actions. Listed with test values for initialization.

---

## Quick Reference — All 18 Calls

| # | Name | Method | Use As | Purpose |
|---|------|--------|--------|---------|
| 1 | Get All Batches | GET | Data | Batch list with subjects & teachers |
| 2 | Create Batch | POST | Action | Add new batch |
| 3 | Update Batch | PATCH | Action | Edit batch details |
| 4 | Delete Batch | DELETE | Action | Remove a batch |
| 5 | Create Subject | POST | Action | Add subject to batch |
| 6 | Delete Subject | DELETE | Action | Remove subject from batch |
| 7 | Assign Teacher | POST | Action | Link teacher to batch |
| 8 | Remove Teacher | DELETE | Action | Unlink teacher from batch |
| 9 | Get Teachers List | GET | Data | Teacher dropdown data |
| 10 | Get Students Detail | GET | Data | Students with guardian & enrollment info |
| 11 | Create Student | POST | Action | Enroll new student |
| 12 | Update Student | PATCH | Action | Edit student info |
| 13 | Create Enrollment | POST | Action | Add student to a batch |
| 14 | End Enrollment | PATCH | Action | Remove student from batch (set end_date) |
| 15 | Get Guardians Dropdown | GET | Data | Guardian picker data |
| 16 | Get Siblings | GET | Data | Children under a guardian |
| 17 | Get All Assessments | GET | Data | Admin assessment overview |
| 18 | Get Today Attendance | GET | Data | Today's attendance summary |

---

---

## CALL 1: Get All Batches

**Use as:** Data  
**Method:** GET  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/batches?select=id,name,grade_level,days_of_week,start_time,end_time,monthly_tuition,active,subjects(id,name),batch_teachers(teacher_id,profiles(id,full_name))&active=eq.true&order=name
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | `<SUPABASE_ANON_KEY>` | No |
| Authorization | `Bearer` (dynamic at runtime) | No |

**URL Parameters:** None

**Body:** None

**Initialize:** Just click Initialize — returns your existing 2 batches with nested subjects and teachers.

**Expected response structure:**
```json
[
  {
    "id": "uuid",
    "name": "Grade 5 Evening",
    "grade_level": "5",
    "days_of_week": null,
    "start_time": null,
    "end_time": null,
    "monthly_tuition": 5000,
    "active": true,
    "subjects": [{"id": "uuid", "name": "Mathematics"}],
    "batch_teachers": [{"teacher_id": "uuid", "profiles": {"id": "uuid", "full_name": "Teacher One"}}]
  }
]
```

---

## CALL 2: Create Batch

**Use as:** Action  
**Method:** POST  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/batches
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |
| Content-Type | `application/json` | No |
| Prefer | `return=representation` | No |

**Body (JSON, raw):**
```json
{
  "academy_id": "00000000-0000-0000-0000-000000000001",
  "name": "<name>",
  "grade_level": "<grade_level>",
  "days_of_week": "<days_of_week>",
  "start_time": "<start_time>",
  "end_time": "<end_time>",
  "monthly_tuition": "<monthly_tuition>"
}
```

**Body Parameters for Initialization:**

| Param | Test Value | Private |
|-------|-----------|---------|
| name | `Test Batch` | No |
| grade_level | `4` | No |
| days_of_week | `["Mon","Wed","Fri"]` | No |
| start_time | `09:00` | No |
| end_time | `11:00` | No |
| monthly_tuition | `3000` | No |

**Initialize:** Click Initialize → returns the created batch. **After initialization, delete the test batch from Supabase dashboard** (Table Editor → batches → delete "Test Batch" row).

**Expected response:**
```json
[
  {
    "id": "generated-uuid",
    "academy_id": "00000000-0000-0000-0000-000000000001",
    "name": "Test Batch",
    "grade_level": "4",
    "days_of_week": ["Mon","Wed","Fri"],
    "start_time": "09:00:00",
    "end_time": "11:00:00",
    "monthly_tuition": 3000,
    "active": true,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

---

## CALL 3: Update Batch

**Use as:** Action  
**Method:** PATCH  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/batches?id=eq.[batch_id]
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |
| Content-Type | `application/json` | No |
| Prefer | `return=representation` | No |

**URL Parameters:**

| Param | Test Value | Private |
|-------|-----------|---------|
| batch_id | `00000000-0000-0000-0000-ffffffffffff` | No |

**Body (JSON):**
```json
{
  "name": "<name>",
  "grade_level": "<grade_level>",
  "days_of_week": "<days_of_week>",
  "start_time": "<start_time>",
  "end_time": "<end_time>",
  "monthly_tuition": "<monthly_tuition>"
}
```

**Body Parameters for Initialization:**

| Param | Test Value | Private |
|-------|-----------|---------|
| name | `Grade 5 Evening` | No |
| grade_level | `5` | No |
| days_of_week | `["Mon","Tue","Wed","Thu","Fri"]` | No |
| start_time | `16:00` | No |
| end_time | `18:00` | No |
| monthly_tuition | `5000` | No |

**Initialize:** Uses existing batch — safe, just re-sets same values.

---

## CALL 4: Delete Batch

**Use as:** Action  
**Method:** DELETE  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/batches?id=eq.[batch_id]
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |

**URL Parameters:**

| Param | Test Value | Private |
|-------|-----------|---------|
| batch_id | (create a test batch first, use its UUID, then initialize this call to delete it) | No |

**Body:** None

**Initialize:** First create a throwaway batch via the Supabase dashboard, copy its ID, paste here, then initialize. The test batch gets deleted.

---

## CALL 5: Create Subject

**Use as:** Action  
**Method:** POST  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/subjects
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |
| Content-Type | `application/json` | No |
| Prefer | `return=representation` | No |

**Body (JSON):**
```json
{
  "academy_id": "00000000-0000-0000-0000-000000000001",
  "batch_id": "<batch_id>",
  "name": "<name>"
}
```

**Body Parameters for Initialization:**

| Param | Test Value | Private |
|-------|-----------|---------|
| batch_id | `00000000-0000-0000-0000-ffffffffffff` | No |
| name | `Science` | No |

**Initialize:** Creates a "Science" subject on "Grade 5 Evening". Delete it after from Supabase dashboard if you don't want it.

---

## CALL 6: Delete Subject

**Use as:** Action  
**Method:** DELETE  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/subjects?id=eq.[subject_id]
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |

**URL Parameters:**

| Param | Test Value | Private |
|-------|-----------|---------|
| subject_id | (use the UUID of the "Science" subject you just created in CALL 5) | No |

**Body:** None

**Initialize:** Deletes the test subject.

---

## CALL 7: Assign Teacher

**Use as:** Action  
**Method:** POST  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/batch_teachers
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |
| Content-Type | `application/json` | No |
| Prefer | `return=representation` | No |

**Body (JSON):**
```json
{
  "batch_id": "<batch_id>",
  "teacher_id": "<teacher_id>"
}
```

**Body Parameters for Initialization:**

| Param | Test Value | Private |
|-------|-----------|---------|
| batch_id | `00000000-0000-0000-0000-ffffffffffff` | No |
| teacher_id | `00000000-0000-0000-0000-bbbbbbbbbb02` | No |

> This assigns "Teacher Two" to "Grade 5 Evening". You can remove it after.

**Initialize:** Creates the assignment row.

---

## CALL 8: Remove Teacher from Batch

**Use as:** Action  
**Method:** DELETE  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/batch_teachers?batch_id=eq.[batch_id]&teacher_id=eq.[teacher_id]
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |

**URL Parameters:**

| Param | Test Value | Private |
|-------|-----------|---------|
| batch_id | `00000000-0000-0000-0000-ffffffffffff` | No |
| teacher_id | `00000000-0000-0000-0000-bbbbbbbbbb02` | No |

**Body:** None

**Initialize:** Removes the assignment you just made in CALL 7.

---

## CALL 9: Get Teachers List

**Use as:** Data  
**Method:** GET  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/profiles?select=id,full_name&role=eq.teacher&active=eq.true&order=full_name
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |

**URL Parameters:** None  
**Body:** None

**Initialize:** Returns list of active teachers (id + full_name).

**Expected response:**
```json
[
  {"id": "00000000-0000-0000-0000-bbbbbbbbbb01", "full_name": "Teacher One"},
  {"id": "00000000-0000-0000-0000-bbbbbbbbbb02", "full_name": "Teacher Two"}
]
```

---

## CALL 10: Get Students Detail

**Use as:** Data  
**Method:** GET  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/students?select=id,name,grade,status,joined_at,fee_override,override_reason,guardian_id,guardians(id,name,phone),enrollments(id,start_date,end_date,batch_id,batches(id,name))&order=name
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |

**URL Parameters:** None  
**Body:** None

**Initialize:** Returns all students with nested guardian and enrollment data.

**Expected response:**
```json
[
  {
    "id": "uuid",
    "name": "Child A1",
    "grade": "5",
    "status": "active",
    "joined_at": "2026-07-29",
    "fee_override": null,
    "override_reason": null,
    "guardian_id": "uuid",
    "guardians": {"id": "uuid", "name": "Parent A", "phone": "+921111111111"},
    "enrollments": [
      {
        "id": "uuid",
        "start_date": "2026-07-29",
        "end_date": null,
        "batch_id": "uuid",
        "batches": {"id": "uuid", "name": "Grade 5 Evening"}
      }
    ]
  }
]
```

---

## CALL 11: Create Student

**Use as:** Action  
**Method:** POST  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/students
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |
| Content-Type | `application/json` | No |
| Prefer | `return=representation` | No |

**Body (JSON):**
```json
{
  "academy_id": "00000000-0000-0000-0000-000000000001",
  "guardian_id": "<guardian_id>",
  "name": "<name>",
  "grade": "<grade>",
  "joined_at": "<joined_at>",
  "status": "active"
}
```

**Body Parameters for Initialization:**

| Param | Test Value | Private |
|-------|-----------|---------|
| guardian_id | `00000000-0000-0000-0000-dddddddddd01` | No |
| name | `Test Child` | No |
| grade | `4` | No |
| joined_at | `c` | No |

**Initialize:** Creates a test student under "Parent A". Delete after from dashboard.

**Expected response:**
```json
[
  {
    "id": "generated-uuid",
    "academy_id": "00000000-0000-0000-0000-000000000001",
    "guardian_id": "00000000-0000-0000-0000-dddddddddd01",
    "name": "Test Child",
    "grade": "4",
    "status": "active",
    "joined_at": "2026-08-04",
    "fee_override": null,
    "override_reason": null,
    "needs_fee_review": false,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

---

## CALL 12: Update Student

**Use as:** Action  
**Method:** PATCH  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/students?id=eq.[student_id]
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |
| Content-Type | `application/json` | No |
| Prefer | `return=representation` | No |

**URL Parameters:**

| Param | Test Value | Private |
|-------|-----------|---------|
| student_id | (use UUID of the "Test Child" you just created, or any existing student) | No |

**Body (JSON):**
```json
{
  "name": "<name>",
  "grade": "<grade>",
  "status": "<status>",
  "fee_override": "<fee_override>",
  "override_reason": "<override_reason>"
}
```

**Body Parameters for Initialization:**

| Param | Test Value | Private |
|-------|-----------|---------|
| name | `Test Child Updated` | No |
| grade | `5` | No |
| status | `active` | No |
| fee_override | `4500` | No |
| override_reason | `Scholarship` | No |

**Initialize:** Updates the test student.

---

## CALL 13: Create Enrollment

**Use as:** Action  
**Method:** POST  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/enrollments
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |
| Content-Type | `application/json` | No |
| Prefer | `return=representation` | No |

**Body (JSON):**
```json
{
  "student_id": "<student_id>",
  "batch_id": "<batch_id>",
  "start_date": "<start_date>"
}
```

**Body Parameters for Initialization:**

| Param | Test Value | Private |
|-------|-----------|---------|
| student_id | (UUID of test student from CALL 11) | No |
| batch_id | `00000000-0000-0000-0000-ffffffffffff` | No |
| start_date | `2026-08-04` | No |

**Initialize:** Enrolls the test student into "Grade 5 Evening".

**Expected response:**
```json
[
  {
    "id": "generated-uuid",
    "student_id": "...",
    "batch_id": "00000000-0000-0000-0000-ffffffffffff",
    "start_date": "2026-08-04",
    "end_date": null,
    "created_at": "..."
  }
]
```

---

## CALL 14: End Enrollment

**Use as:** Action  
**Method:** PATCH  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/enrollments?id=eq.[enrollment_id]
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |
| Content-Type | `application/json` | No |
| Prefer | `return=representation` | No |

**URL Parameters:**

| Param | Test Value | Private |
|-------|-----------|---------|
| enrollment_id | (UUID from CALL 13 response) | No |

**Body (JSON):**
```json
{
  "end_date": "<end_date>"
}
```

**Body Parameters for Initialization:**

| Param | Test Value | Private |
|-------|-----------|---------|
| end_date | `2026-08-04` | No |

**Initialize:** Sets an end_date on the test enrollment.

---

## CALL 15: Get Guardians Dropdown

**Use as:** Data  
**Method:** GET  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/guardians?select=id,name,phone&order=name
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |

**URL Parameters:** None  
**Body:** None

**Initialize:** Returns all guardians with id, name, phone.

**Expected response:**
```json
[
  {"id": "uuid", "name": "Parent A", "phone": "+921111111111"},
  {"id": "uuid", "name": "Parent B", "phone": "+922222222222"}
]
```

---

## CALL 16: Get Siblings by Guardian

**Use as:** Data  
**Method:** GET  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/students?select=id,name,grade,status&guardian_id=eq.[guardian_id]&order=name
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |

**URL Parameters:**

| Param | Test Value | Private |
|-------|-----------|---------|
| guardian_id | `00000000-0000-0000-0000-dddddddddd01` | No |

**Body:** None

**Initialize:** Returns children under "Parent A".

**Expected response:**
```json
[
  {"id": "uuid", "name": "Child A1", "grade": "5", "status": "active"},
  {"id": "uuid", "name": "Child A2", "grade": "3", "status": "active"}
]
```

---

## CALL 17: Get All Assessments

**Use as:** Data  
**Method:** GET  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/assessments?select=id,date,max_marks,published,created_at,batches(id,name),subjects(id,name)&order=date.desc
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |

**URL Parameters:** None  
**Body:** None

**Initialize:** Returns all assessments with batch and subject names.

**Expected response:**
```json
[
  {
    "id": "uuid",
    "date": "2026-08-01",
    "max_marks": 100,
    "published": true,
    "created_at": "...",
    "batches": {"id": "uuid", "name": "Grade 5 Evening"},
    "subjects": {"id": "uuid", "name": "Mathematics"}
  }
]
```

---

## CALL 18: Get Today Attendance

**Use as:** Data  
**Method:** GET  
**URL:**
```
https://<PROJECT_REF>.supabase.co/rest/v1/attendance?select=id,batch_id,student_id,status&date=eq.[today]
```

**Headers:**

| Key | Value | Private |
|-----|-------|---------|
| apikey | (anon key) | No |
| Authorization | `Bearer` (dynamic) | No |

**URL Parameters:**

| Param | Test Value | Private |
|-------|-----------|---------|
| today | `2026-08-04` | No |

**Body:** None

**Initialize:** Returns today's attendance records (may be empty if nothing marked today).

**Expected response:**
```json
[
  {"id": "uuid", "batch_id": "uuid", "student_id": "uuid", "status": "present"},
  {"id": "uuid", "batch_id": "uuid", "student_id": "uuid", "status": "absent"}
]
```

---

---

## Initialization Order (Recommended)

Do the calls in this order so that each one has data available for initialization:

### Round 1 — GET calls (no side effects, safe to repeat)

1. **CALL 9** — Get Teachers List
2. **CALL 15** — Get Guardians Dropdown
3. **CALL 1** — Get All Batches
4. **CALL 10** — Get Students Detail
5. **CALL 16** — Get Siblings (use guardian_id: `00000000-0000-0000-0000-dddddddddd01`)
6. **CALL 17** — Get All Assessments
7. **CALL 18** — Get Today Attendance (use today: `2026-08-04`)

### Round 2 — POST calls (create test data, then clean up)

8. **CALL 2** — Create Batch → creates "Test Batch" → note the returned `id`
9. **CALL 5** — Create Subject → use batch_id from step 8 → note returned `id`
10. **CALL 7** — Assign Teacher → use batch_id from step 8 + teacher_id `00000000-0000-0000-0000-bbbbbbbbbb02`
11. **CALL 11** — Create Student → note the returned `id`
12. **CALL 13** — Create Enrollment → use student_id from step 11 + batch_id from step 8 → note returned `id`

### Round 3 — PATCH calls (modify test data)

13. **CALL 3** — Update Batch → use batch_id from step 8
14. **CALL 12** — Update Student → use student_id from step 11
15. **CALL 14** — End Enrollment → use enrollment_id from step 12

### Round 4 — DELETE calls (clean up test data)

16. **CALL 8** — Remove Teacher → batch_id from step 8 + teacher_id `00000000-0000-0000-0000-bbbbbbbbbb02`
17. **CALL 6** — Delete Subject → subject_id from step 9
18. **CALL 4** — Delete Batch → batch_id from step 8

> After Round 4, also delete the test student and enrollment from Supabase dashboard (Table Editor) to keep data clean.

---

## After Initialization — Runtime Usage

When you use these calls in Bubble workflows or as data sources:

- **Authorization header**: Pass `Bearer ` + `AuthGuard's access_token` (the custom state on your AuthGuard reusable element)
- **URL parameters** (batch_id, student_id, etc.): Pass dynamically from the current cell's data, popup states, or workflow results
- **Body parameters**: Map to input fields in your popup/form

### Example: Create Batch workflow

1. User fills form (name, grade, etc.) in a popup
2. Button click → workflow:
   - Step 1: **Supabase Data — Create Batch**
     - name = Input Name's value
     - grade_level = Input Grade's value
     - days_of_week = MultiSelect Days's value (formatted as JSON array)
     - start_time = TimePicker Start's value
     - end_time = TimePicker End's value
     - monthly_tuition = Input Tuition's value
     - Authorization = `Bearer ` + AuthGuard's access_token
   - Step 2: **Display list** on RG Batches (re-fetches Get All Batches)
   - Step 3: **Hide** popup

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 401 Unauthorized | Authorization header isn't passing the token. Check AuthGuard's access_token custom state is not empty |
| 403 Forbidden | RLS policy blocked the request. Ensure you're logged in as admin |
| 404 Not Found | URL typo — double-check the endpoint path |
| 400 Bad Request | Body JSON is malformed. Check that parameters are correctly typed (numbers as numbers, not strings) |
| Empty array `[]` | No matching data exists — not an error. Check filter conditions |
| `"details":"...violates foreign key constraint"` | The referenced ID doesn't exist (e.g., batch_id or guardian_id is wrong) |
| `"details":"...duplicate key value"` | Trying to create a record that already exists (e.g., same teacher already assigned to batch) |
