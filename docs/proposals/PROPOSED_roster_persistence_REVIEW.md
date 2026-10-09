# Review notes — PROPOSED_roster_persistence.sql (revision 2, 2026-10-10)

Status: **proposal only — not executed anywhere.** No database was queried or changed for this revision.
Inputs inspected: `supabase/migrations/0002_shift_roster_schema.sql` (rosters, roster_assignments, RLS),
`0005` (payroll columns), `0009` / `20260930163500` (`get_auth_role`), `0014` (shift_assignments policy pattern),
`supabase/functions/delete-employee` (service-role deletes), `src/services/shifts/rosterService.ts`,
`rosterRules.ts`, `src/pages/admin/Roster.tsx`, `src/services/payroll/payrollDataService.ts`.

## 1. What changed in revision 2

| # | Safeguard | Design | Why this design |
|---|---|---|---|
| 1 | One active roster per period | `EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&) WHERE (status <> 'ARCHIVED')` | A unique key on (start_date, end_date) is **not enough**: the Roster page can produce **Mon–Sun and Sun–Sat** weeks for the same days (see §3). The exclusion constraint rejects any *overlap*. Archived rosters are excluded, so a period can be planned again after archiving. Built-in GiST range support — no extension needed. |
| 2 | Entry date inside its roster | `roster_assignments_guard` trigger (BEFORE INSERT/UPDATE) | A CHECK constraint cannot read another table. The trigger reads the roster row (locked `FOR SHARE`) and rejects dates outside it. `rosters_guard` also refuses date changes that would leave entries outside. |
| 3 | Published entries protected | `roster_assignments_guard` (BEFORE INSERT/UPDATE/DELETE) + `rosters_guard` (BEFORE UPDATE/DELETE) | Entries can only be added/changed/removed while the roster is **DRAFT**. A PUBLISHED roster cannot change dates or be deleted. Publish = DRAFT→PUBLISHED with ≥1 entry (publication time filled in). Leaving PUBLISHED (unpublish or archive) is refused once payroll for a covered month is APPROVED / PAYMENT_PENDING / PAID / CLOSED — the same rule as the app. The `FOR SHARE` lock serialises "save entry" against "publish", so an entry cannot slip into a roster being published. |
| 4 | Transaction boundaries | PART 1 is `BEGIN; … COMMIT;` with `SET LOCAL lock_timeout = '5s'` and a pre-check `DO` block | Any pre-check failure or statement error aborts everything. Pre-checks: role function present, payroll columns present, not already applied, no duplicates, no out-of-range entries, no unknown statuses, no overlapping active rosters. |
| — | Verification | PART 2 (read-only) and PART 3 (staging self-test, always `ROLLBACK`) | PART 3 runs as an ordinary signed-in user and prints PASS/FAIL for 10 cases (WORK/WEEK_OFF save, out-of-range, WORK without shift, overlap, publish, edit-after-publish, delete-published, unpublish→edit, archive→replan, archived entry). |
| — | Rollback | PART 4, commented out, one transaction, **refuses to run** unless `roster.rollback_confirm = 'DELETE_WEEK_OFFS'` is set in the session | Week Off entries cannot exist in the old schema, so rollback permanently deletes them; WFH modes and publication records are lost too. Export queries are provided. |

Also kept from revision 1: `day_type` / `work_mode` columns, optional shift on a Week Off, one entry per (roster, employee, date), `published_at` / `published_by`, status check, Admin-only write policies.

## 2. Security review

- **Admin-only writes preserved.** New policies: `FOR ALL TO authenticated USING/WITH CHECK (get_auth_role() = 'ADMIN')`. The existing read-all SELECT policies are **not** dropped or changed; nothing is weakened. HR is intentionally excluded (owner: ADMIN and EMPLOYEE roles only).
- **Guards apply to Admins too.** Only server-side calls with the **service_role** key bypass the guards (`roster_guard_bypass()` checks the JWT role; it supports both PostgREST claim formats and never treats a missing claim as service_role). This keeps the existing `delete-employee` function working.
- **SECURITY DEFINER** guard functions use `SET search_path = public, pg_temp` and only read `rosters`, `roster_assignments` and `payroll`; they cannot be called through the API (trigger functions). `roster_guard_bypass()` is callable via RPC but only returns true/false about the caller — harmless; `REVOKE … FROM PUBLIC` is applied (Supabase's default grants to `anon`/`authenticated` may still allow calling it).
- **Unchanged existing exposure:** every signed-in user can read every roster (from 0002). `get_auth_role()` also treats `admin@gmail.com` as ADMIN (from 20260930163500) — whoever controls that mailbox gets roster write access. Not changed here; worth fixing separately.
- **Direct database sessions** (SQL editor as owner) are *not* exempt; an owner can still disable triggers deliberately. That is expected.

## 3. Consistency with the application (no app code changed)

| App behaviour | Migration | Result |
|---|---|---|
| `assignmentRow`: `day_type` WORK/WEEK_OFF, `work_mode` OFFICE/WFH, shift null on Week Off | checks 1.1 | ✓ |
| `saveCell` upsert `onConflict: 'roster_id,employee_id,assignment_date'` | `roster_assignments_unique_day` | ✓ required — the upsert fails without it |
| `saveCell` refuses a PUBLISHED roster; `dateInPeriodError` | trigger 1.4 (same rules, DB-enforced) | ✓ same messages |
| `publish`: DRAFT→PUBLISHED, sets `published_at`, `published_by`; needs ≥1 entry | trigger 1.5, check 1.2b | ✓ |
| `unpublish`: →DRAFT, clears `published_at`/`published_by`; refused if payroll locked | trigger 1.5 | ✓ same message |
| `getPeriodRoster` uses `maybeSingle()` for one non-archived roster per period | exclusion 1.2c guarantees ≤1 | ✓ |
| `publish` checks only overlapping **published** rosters | DB rejects **any** overlapping active roster earlier (at creation) | ✓ stricter |
| Payroll reads `*, rosters(status, start_date, end_date)`; only PUBLISHED; `day_type` WEEK_OFF = OFF | columns 1.1 | ✓ |

**App defect found while verifying periods (not fixed — app changes were out of scope):**
`Roster.tsx` builds week dates with `toISOString()` (UTC). In IST, simulated with the page's own code:

| Situation | Week saved as |
|---|---|
| First load at 23:58 IST | 2026-10-05 → 2026-10-11 (Mon–Sun) |
| First load at 03:00 IST | 2026-10-04 → 2026-10-10 (**Sun–Sat**) |
| After clicking Previous / Next | **Sun–Sat** weeks |

With the migration, a Sun–Sat roster overlapping an existing Mon–Sun roster is **rejected** (no bad data), but the Admin sees a technical "exclusion constraint" error. **Fix the page's date handling before relying on the Roster page** (separate task).

## 4. Remaining risks

1. **Not executed anywhere.** Syntax was reviewed manually and structurally (balanced quotes, brackets, IF/END IF, transaction blocks); no PostgreSQL parser was available offline. The PART 1 dry run (`ROLLBACK` instead of `COMMIT`) on staging is the real syntax test.
2. **Roster page week-date bug** (§3) — overlaps are blocked, but saves fail confusingly until the page is fixed.
3. **Raw database error text** reaches the Admin for the exclusion constraint (e.g. "conflicting key value violates exclusion constraint …"). Other guard messages are plain English and match the app.
4. **Rollback is destructive** (Week Offs, WFH modes, publication records). It is guarded by an explicit confirmation setting and should only be used if the feature is abandoned.
5. **Schema drift:** the file assumes production matches the repository migrations. PART 0 and the pre-checks catch the important differences, but staging should be built from production's actual schema (dump) where possible.
6. **Archived entries are frozen**; they can only be removed by deleting the archived roster (cascade). Intended.
7. **Lock timeout 5 s:** on a busy database PART 1 may abort with a lock timeout — safe (nothing applied); retry in a quiet window.

## 5. Running it on a separate staging project

1. Create a **new Supabase project** (or branch). Never use production URLs, keys or passwords.
2. Bring its schema to production's state: preferably `supabase db dump --schema-only` from production (read-only; run by you) restored to staging, or `supabase link --project-ref <staging>` + `supabase db push` of `supabase/migrations`, then the proposals already applied in production.
3. In the **staging** SQL editor: PART 0 → compare → PART 1 with `ROLLBACK` (dry run) → PART 1 with `COMMIT` → PART 2 → PART 3 (expect all PASS).
4. Point a local copy of the app at staging (`.env.staging`, `npm run kanz -- --mode staging`), check the screen shows staging data, create a staging Admin and Employee, and test: save Office/WFH/Week Off, re-save the same cell, publish, try editing (refused), unpublish, generate staging payroll and check a Week Off and a rostered Sunday change the absences. As the Employee, reading works and any write is refused.
5. Only after that, plan production in a quiet window with a fresh PART 0.
