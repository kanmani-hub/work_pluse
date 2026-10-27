#!/usr/bin/env bash
# RLS / role-security regression tests for C1 (email backdoor) and C2 (role escalation).
#
# Builds THROWAWAY databases from supabase/migrations on a disposable PostgreSQL server you point it at.
# Never point this at Supabase staging or production: it drops and creates databases.
#
#   PGHOST=/tmp PGPORT=55432 PGUSER=postgres bash supabase/tests/rls/run_rls_tests.sh
#
# Requires: psql + a PostgreSQL 15/16 superuser on a local/disposable server.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIG_SRC="$ROOT/supabase/migrations"
ROLLBACK="$ROOT/supabase/rollbacks/20261014090000_admin_security_hardening.rollback.sql"
NEW_MIG="20261014090000_admin_security_hardening.sql"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

: "${PGHOST:=/tmp}" "${PGPORT:=5432}" "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER
PSQL_ADMIN="psql -X -q -v ON_ERROR_STOP=1"

# Copy migrations. Test-only patch for N1: 0015_auto_clock_out.sql uses v_status without declaring it,
# which makes the migration fail on a clean database. The repo file itself is not changed.
cp -r "$MIG_SRC" "$WORK/mig"
# (only while the repo file still lacks the declaration; it has been fixed in the migration itself since)
grep -qE '^\s*v_status\s' "$WORK/mig/0015_auto_clock_out.sql" || \
  sed -i 's/^    v_total_duration_hrs DECIMAL(10,4);/    v_total_duration_hrs DECIMAL(10,4);\n    v_status VARCHAR; -- TEST-ONLY patch (N1)/' "$WORK/mig/0015_auto_clock_out.sql"
# pg_net is not available on plain PostgreSQL; the shim provides a stub net.http_post.
sed -i -E 's/^CREATE EXTENSION IF NOT EXISTS pg_net.*$/-- pg_net stubbed by test shim/' "$WORK/mig/20261004120100_notification_push_trigger.sql"

build_db() { # build_db <name> <include_new_migration:yes|no>
  local db=$1 incl=$2
  $PSQL_ADMIN -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null 2>&1
  $PSQL_ADMIN -d "$db" -f "$HERE/00_supabase_shim.sql" >/dev/null 2>"$WORK/err" || { echo "shim failed"; cat "$WORK/err"; exit 2; }
  for f in $(ls "$WORK"/mig/*.sql | sort); do
    [[ "$incl" == "no" && "$(basename "$f")" == "$NEW_MIG" ]] && continue
    [[ "$(basename "$f")" == "$NEW_MIG" ]] && continue   # applied after the seed (needs an ADMIN to exist)
    $PSQL_ADMIN -d "$db" -f "$f" >/dev/null 2>"$WORK/err" || { echo "migration failed: $f"; cat "$WORK/err"; exit 2; }
  done
  $PSQL_ADMIN -d "$db" -f "$HERE/seed.sql" >/dev/null 2>"$WORK/err" || { echo "seed failed"; cat "$WORK/err"; exit 2; }
  if [[ "$incl" == "yes" ]]; then
    $PSQL_ADMIN -d "$db" -f "$WORK/mig/$NEW_MIG" >/dev/null 2>"$WORK/err" || { echo "new migration failed"; cat "$WORK/err"; exit 2; }
  fi
}

DB=""
run_as() { # run_as <auth uid> <email> <sql>   (a PostgREST-style request as role "authenticated")
  local uid=$1 email=$2; shift 2
  psql -X -q -t -A -d "$DB" -v ON_ERROR_STOP=1 2>&1 <<SQL | grep -v '^$' | sed -E 's/^psql:[^E]*ERROR:/ERROR:/'
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"$uid","email":"$email","role":"authenticated"}', true) \g /dev/null
SET LOCAL ROLE authenticated;
$*;
COMMIT;
SQL
}
run_service() { # a request with the service-role key (edge functions)
  psql -X -q -t -A -d "$DB" -v ON_ERROR_STOP=1 2>&1 <<SQL | grep -v '^$' | sed -E 's/^psql:[^E]*ERROR:/ERROR:/'
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) \g /dev/null
SET LOCAL ROLE service_role;
$*;
COMMIT;
SQL
}
fresh() { psql -X -q -d postgres -c "DROP DATABASE IF EXISTS t_case" -c "CREATE DATABASE t_case TEMPLATE $1" >/dev/null 2>&1; DB=t_case; }

ADMIN="11111111-1111-1111-1111-111111111111 realadmin@example.com"
HR="22222222-2222-2222-2222-222222222222 hr@example.com"
EMP="33333333-3333-3333-3333-333333333333 emp@example.com"
GMAIL="44444444-4444-4444-4444-444444444444 admin@gmail.com"
R_ADMIN="00000000-0000-0000-0000-0000000000a1"; R_HR="00000000-0000-0000-0000-0000000000a2"; R_EMP="00000000-0000-0000-0000-0000000000a3"
E_ADMIN="e1111111-1111-1111-1111-111111111111"; E_HR="e2222222-2222-2222-2222-222222222222"; E_EMP="e3333333-3333-3333-3333-333333333333"

PASS=0; FAIL=0
expect() { # expect "<name>" "<substring>" "<actual>"
  if [[ "$3" == *"$2"* ]]; then PASS=$((PASS+1)); echo "PASS  $1"
  else FAIL=$((FAIL+1)); echo "FAIL  $1"; echo "      expected to contain: $2"; echo "      got: ${3//$'\n'/ | }"; fi
}
rows() { echo "with u as ($1 returning 1) select 'rows='||count(*) from u"; }

echo "== building databases =="
build_db t_before no
build_db t_after yes
echo

echo "== baseline (before the fix) — documents the vulnerabilities =="
fresh t_before
expect "BEFORE C1: admin@gmail.com without a profile gets ADMIN" "ADMIN" "$(run_as $GMAIL "select coalesce(public.get_auth_role(),'NULL')")"
expect "BEFORE C2: HR can promote itself" "rows=1" "$(run_as $HR "$(rows "update profiles set role_id='$R_ADMIN' where auth_user_id=auth.uid()")")"
echo

echo "== C1: no authorization by email =="
fresh t_after
expect "C1.1 admin@gmail.com without a profile has no role" "NULL" "$(run_as $GMAIL "select coalesce(public.get_auth_role(),'NULL')")"
psql -X -q -d "$DB" -c "insert into rosters (id, name, status, start_date, end_date) values ('99999999-0000-0000-0000-000000000001','Draft roster','DRAFT','2026-11-01','2026-11-30')" >/dev/null 2>&1 \
  || psql -X -q -d "$DB" -c "insert into rosters (id, name, status) values ('99999999-0000-0000-0000-000000000001','Draft roster','DRAFT')" >/dev/null 2>&1
expect "C1.2 admin@gmail.com cannot read DRAFT rosters" "0" "$(run_as $GMAIL "select count(*) from rosters where status='DRAFT'")"
expect "C1.3 admin@gmail.com cannot change rosters" "rows=0" "$(run_as $GMAIL "$(rows "update rosters set status='ARCHIVED'")")"
expect "C1.4 admin@gmail.com cannot read others' shift assignments" "0" "$(run_as $GMAIL "select count(*) from shift_assignments")"
expect "C1.5 admin@gmail.com cannot write profiles" "ERROR" "$(run_as $GMAIL "insert into profiles (auth_user_id, role_id, is_active) values (auth.uid(), '$R_ADMIN', true)")"
expect "C1.6 real ADMIN (provisioned profile) keeps ADMIN" "ADMIN" "$(run_as $ADMIN "select public.get_auth_role()")"
expect "C1.7 real ADMIN can read DRAFT rosters" "1" "$(run_as $ADMIN "select count(*) from rosters where status='DRAFT'")"
expect "C1.8 HR keeps HR" "HR" "$(run_as $HR "select public.get_auth_role()")"
expect "C1.4b EMPLOYEE still reads own shift assignment" "1" "$(run_as $EMP "select count(*) from shift_assignments")"
expect "C1.9 EMPLOYEE keeps EMPLOYEE and own employee id" "EMPLOYEE|$E_EMP" "$(run_as $EMP "select public.get_auth_role()||'|'||public.get_auth_employee_id()")"
psql -X -q -d "$DB" -c "update employees set status='INACTIVE' where id='$E_EMP'" >/dev/null
expect "C1.10 deactivated employee resolves to no role" "NULL" "$(run_as $EMP "select coalesce(public.get_auth_role(),'NULL')||coalesce(public.get_auth_employee_id()::text,'')")"
echo

echo "== C2: only ADMIN changes roles and account access =="
fresh t_after
expect "C2.1 HR cannot promote itself (profiles.role_id)" "rows=0" "$(run_as $HR "$(rows "update profiles set role_id='$R_ADMIN' where auth_user_id=auth.uid()")")"
expect "C2.2 HR still HR after the attempt" "HR" "$(run_as $HR "select public.get_auth_role()")"
expect "C2.3 HR cannot promote another employee" "rows=0" "$(run_as $HR "$(rows "update profiles set role_id='$R_HR' where employee_id='$E_EMP'")")"
expect "C2.4 HR cannot demote the ADMIN" "rows=0" "$(run_as $HR "$(rows "update profiles set role_id='$R_EMP' where employee_id='$E_ADMIN'")")"
expect "C2.5 HR cannot disable the ADMIN's profile" "rows=0" "$(run_as $HR "$(rows "update profiles set is_active=false where employee_id='$E_ADMIN'")")"
expect "C2.6 HR cannot create a profile" "ERROR" "$(run_as $HR "insert into profiles (auth_user_id, employee_id, role_id, is_active) values ('22222222-0000-0000-0000-000000000009','$E_EMP','$R_ADMIN',true)")"
expect "C2.7 HR cannot delete the ADMIN's profile" "rows=0" "$(run_as $HR "$(rows "delete from profiles where employee_id='$E_ADMIN'")")"
run_as $HR "delete from profiles where auth_user_id=auth.uid()" >/dev/null
run_as $HR "update profiles set auth_user_id=auth.uid() where employee_id='$E_ADMIN'" >/dev/null
expect "C2.8 HR cannot take over the ADMIN profile (delete own, then swap auth_user_id)" "11111111-1111-1111-1111-111111111111" "$(psql -X -q -t -A -d "$DB" -c "select auth_user_id from profiles where employee_id='$E_ADMIN'")"
expect "C2.8b ...and HR's own profile was not deleted" "1" "$(psql -X -q -t -A -d "$DB" -c "select count(*) from profiles where employee_id='$E_HR'")"
expect "C2.9 EMPLOYEE cannot change own role" "rows=0" "$(run_as $EMP "$(rows "update profiles set role_id='$R_ADMIN' where auth_user_id=auth.uid()")")"
fresh t_after   # independent of the attempts above
expect "C2.10 HR cannot change employees.role_id" "ERROR" "$(run_as $HR "update employees set role_id='$R_ADMIN' where id='$E_HR'")"
expect "C2.11 HR cannot deactivate the ADMIN's employee record" "ERROR" "$(run_as $HR "update employees set status='INACTIVE' where id='$E_ADMIN'")"
expect "C2.12 HR cannot create an HR/ADMIN employee" "ERROR" "$(run_as $HR "insert into employees (employee_code, first_name, last_name, email, joining_date, role_id) values ('X-1','X','Y','x@example.com','2026-10-01','$R_ADMIN')")"
expect "C2.13 HR can still create an EMPLOYEE" "rows=1" "$(run_as $HR "$(rows "insert into employees (employee_code, first_name, last_name, email, joining_date, role_id) values ('X-2','X','Z','x2@example.com','2026-10-01','$R_EMP')")")"
expect "C2.14 HR can still edit an employee's normal fields" "rows=1" "$(run_as $HR "$(rows "update employees set designation='Analyst', phone='999' where id='$E_EMP'")")"
expect "C2.15 HR can still deactivate a normal employee" "rows=1" "$(run_as $HR "$(rows "update employees set status='INACTIVE' where id='$E_EMP'")")"
expect "C2.16 HR can still read profiles" "4" "$(run_as $HR "select count(*) from profiles")"
fresh t_after
expect "C2.17 ADMIN can change an employee's role" "rows=1" "$(run_as $ADMIN "$(rows "update profiles set role_id='$R_HR' where employee_id='$E_EMP'")")"
expect "C2.18 ADMIN can change employees.role_id" "rows=1" "$(run_as $ADMIN "$(rows "update employees set role_id='$R_HR' where id='$E_EMP'")")"
expect "C2.19 the last ADMIN cannot demote themself" "ERROR" "$(run_as $ADMIN "update profiles set role_id='$R_EMP' where employee_id='$E_ADMIN'")"
expect "C2.20 the last ADMIN profile cannot be deleted, even by the service role" "ERROR" "$(run_service "delete from profiles where employee_id='$E_ADMIN'")"
expect "C2.21 service role (edge functions) can still change roles" "rows=1" "$(run_service "$(rows "update profiles set role_id='$R_HR' where employee_id='$E_EMP'")")"
echo

echo "== migration safety =="
DB=t_before
fresh t_before
psql -X -q -d "$DB" -c "update profiles set is_active=false where employee_id='$E_ADMIN'" >/dev/null
out=$(psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$WORK/mig/$NEW_MIG" 2>&1)
expect "M.1 migration refuses to run when no active ADMIN profile exists" "no active ADMIN profile" "$out"
expect "M.2 ...and changes nothing (fallback still present)" "ADMIN" "$(run_as $GMAIL "select coalesce(public.get_auth_role(),'NULL')")"
fresh t_after
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROLLBACK" >/dev/null 2>&1
expect "M.3 rollback restores the previous behaviour" "ADMIN" "$(run_as $GMAIL "select coalesce(public.get_auth_role(),'NULL')")"
out=$(psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -f "$WORK/mig/$NEW_MIG" 2>&1)
expect "M.4 migration re-applies cleanly after rollback" "NULL" "$(run_as $GMAIL "select coalesce(public.get_auth_role(),'NULL')")"
echo

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS t_case" -c "DROP DATABASE IF EXISTS t_before" -c "DROP DATABASE IF EXISTS t_after" >/dev/null 2>&1
echo "RESULT: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
