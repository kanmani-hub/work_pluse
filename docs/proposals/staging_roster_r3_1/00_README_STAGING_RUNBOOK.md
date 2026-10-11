# Roster migration revision 3.1: staging validation runbook

Source of truth: `docs/proposals/PROPOSED_roster_persistence.sql` (revision 3.1) and `PROPOSED_roster_persistence_REVIEW.md`.
The `.sql` files in this folder are generated from that file **without changing what the migration does**. They are only adapted to the Supabase SQL editor.

**Run everything in the STAGING project only.** Never use `supabase db push`. Nothing here touches production.

## Why there are separate files for the SQL editor
| Editor behaviour | Problem with the original file | File used instead |
|---|---|---|
| Shows only the **last** result of a script | PART 0 and PART 2 have many SELECTs, so you'd see only one | `02_part0_summary.sql`, `05_part2_verify_summary.sql` (one table each, with an OK / STOP column) |
| Does **not** show `RAISE NOTICE` | PART 3 reports PASS/FAIL as NOTICEs, so you'd see nothing | `06_part3_selftest_supabase.sql` (results shown in one final error message, which also rolls back) |
| A dry run needs COMMIT → ROLLBACK | Editing by hand is error-prone | `03_part1_DRY_RUN.sql` (ends with a deliberate error, then ROLLBACK, so nothing can be committed) |

Always paste the **whole file** and press **Run**. Don't use "Run selected" except for the optional `*_detail` files, where you run one query at a time.

## 0. Prepare staging (before step 1)
- [ ] The staging project has the **same migrations as production**, up to and including `20261010131800_fix_rosters_rls.sql`, so it has the "Manage rosters" / "Manage roster_assignments" policies (ADMIN, HR).
- [ ] Staging has at least **1 employee** and **1 shift template**. Optionally, also a DRAFT roster for 2026-10-05 → 2026-10-11 like production.
- [ ] Three staging sign-ins exist with roles **ADMIN**, **HR** and **EMPLOYEE**, for step 6 and the app checklist.
- [ ] Check the project name in the dashboard header: it must say STAGING.

## Steps (in this exact order)
| # | File | Changes data? | Expected result | Stop if |
|---|---|---|---|---|
| 1 | `02_part0_summary.sql` | No (read-only) | 18 rows **OK**, 2 rows **INFO**. Write down the INFO row counts. | **Any STOP row** |
| 1b | `01_part0_detail_readonly.sql` (optional) | No | Same facts in detail; run one query at a time | — |
| 2 | `03_part1_DRY_RUN.sql` | No (always rolled back) | **Error:** `DRY RUN OK: every step succeeded and everything was rolled back (this error is expected).` | Any **other** error, e.g. `Pre-check failed: …` |
| 2a | `99_rollback_if_error.sql` | No | Run it after step 2 (harmless) | — |
| 2b | `02_part0_summary.sql` again | No | Still all **OK**, same INFO counts. Proves the dry run left nothing behind. | Any STOP, or the counts changed |
| 3 | `04_part1_APPLY.sql` | **Yes** (one transaction) | Finishes **without error** (last statement is `NOTIFY`) | **Any error.** Nothing is kept: run `99_rollback_if_error.sql` and send the error text |
| 4 | `05_part2_verify_summary.sql` | No | 14 rows **OK**, 1 INFO row with the **same counts as step 1** | Any STOP, or the counts changed |
| 4b | `05b_part2_detail_readonly.sql` (optional) | No | Detail; one query at a time | — |
| 5 | `06_part3_selftest_supabase.sql` | No (always rolled back) | **Error** starting `SELF-TEST FINISHED (all test data rolled back):`, then **10 lines, all PASS** | Any FAIL line, any other error, or `SELF-TEST SKIPPED` |
| 5a | `99_rollback_if_error.sql` | No | Run after step 5 | — |
| 6 | `07_rls_permission_check_staging.sql` | No (always rolled back) | First paste the 3 staging auth user ids (query in the file header). **Error** starting `ROLE CHECK FINISHED (rolled back):`, with the 3 role lines showing ADMIN / HR / EMPLOYEE and **8 PASS lines** | Any FAIL, a role line not showing its role, or `ROLE CHECK NOT RUN` |
| 7 | `05_part2_verify_summary.sql` again | No | Still all OK with the same counts. Proves steps 5 and 6 left no test data. | Any STOP, or the counts changed |

### Confirming the policies and roles (step 1 rows)
- Row 1: roles `anon`, `authenticated` and `service_role` exist (3).
- Row 2: `get_auth_role()` exists and returns `text`.
- Rows 7–10: exactly **4** policies:
  - two read policies (`SELECT`, `authenticated`, `true`);
  - `Manage rosters` / `Manage roster_assignments` = `FOR ALL TO authenticated USING / WITH CHECK (get_auth_role() IN ('ADMIN','HR'))`;
  - **no** `Admin manages …` policies.
- If you want the raw text, run query **0b** from `01_part0_detail_readonly.sql`. Compare `qual` and `with_check` with: `(get_auth_role() = ANY (ARRAY['ADMIN'::text, 'HR'::text]))`.

### Stop conditions (do not continue, send the output for review)
1. Any **STOP** row in step 1, 2b, 4 or 7.
2. Step 2 shows any error other than `DRY RUN OK …`.
3. Step 3 shows any error. Nothing was applied; the PART 1 pre-checks are built so that nothing is kept.
4. Step 5 or 6 shows a FAIL line, an unexpected error, `SKIPPED` or `NOT RUN`.
5. The row counts differ between step 1 and step 4 or 7 (only possible if someone else wrote data meanwhile).
6. The policies on staging differ from production's (read-only query 0b on both): the test would not represent production.

**Never** "fix" a stop by editing the policies, deleting rows or removing pre-checks. Send the output instead.
**Never** run PART 4 (rollback) or PART 5 (ADMIN-only) from the main file. PART 5 is not approved.

## 8. Application checklist (local app pointed at STAGING, not deployed)
Point a local dev server at staging. Create `.env.staging.local` with the staging `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (don't commit it), then run `npm run kanz -- --mode staging`. In the browser's Network tab, confirm the requests go to the **staging** host.

**As ADMIN (Admin → Shift Roster):**
- [ ] Office: assign a shift with mode **Office**. Expect "Shift saved to the draft roster" (green tick).
- [ ] WFH: another day with mode **WFH**. Expect it saved, and the cell shows WFH.
- [ ] Week Off: another day as **Week Off** (no shift needed). Expect "Week off saved…".
- [ ] Edit: change the Office day to Week Off and back. No error, and there's still one entry for that day.
- [ ] Reload the page (F5): all three days show the saved values.
- [ ] Navigate: previous/next week and the month view. Weeks run Monday–Sunday; the saved week shows its entries; other weeks are empty or their own.
- [ ] Publish: shows "Roster published…". Then try editing a cell: refused with a **red** warning ("…published. Unpublish it…").
- [ ] Unpublish: "Roster unpublished (back to draft)". Editing works again.
- [ ] Error display: try a save that must fail (for example while published). The message is red, stays about 8 seconds, and is never shown as success.

**As HR:**
- [ ] Can open Shift Roster and save, edit, publish and unpublish, exactly like ADMIN (approved: ADMIN + HR manage rosters).

**As EMPLOYEE:**
- [ ] No access to Admin → Shift Roster (redirected / not in the menu).
- [ ] Step 6 already proved at database level that an employee can read rosters but cannot save or change them.

**Payroll link (read-only check):**
- [ ] With the test week **published**, a daily payroll preview treats the roster's Week Off day as a weekly off. Never generate, approve or pay payroll on staging data you need.

**Clean-up on staging (optional):** unpublish and delete your test roster from the app as ADMIN, or leave it. It's staging.

## Afterwards
Send the outputs of steps 1–7 and the checklist. If everything is OK and PASS, the same files (steps 1 → 2 → 2b → 3 → 4) are used for production **only after explicit approval**. Steps 5 and 6 are staging-only.
