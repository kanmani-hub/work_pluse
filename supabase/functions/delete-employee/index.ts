import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { runEmployeeDeletion, type DeletionPorts } from '../_shared/employeeAdminRules.ts'

/**
 * delete-employee (bug report C3 / R2)
 *
 * - ADMIN only (role read from the caller's own active profile — never by email).
 * - Refuses self-deletion and any ADMIN target.
 * - Never deletes history: an employee with attendance, leave, payroll, audit or other records
 *   must be deactivated instead (409 HAS_HISTORY). Only a record with no history (e.g. created by
 *   mistake) is removed, and every step is checked.
 * All rules live in ../_shared/employeeAdminRules.ts and are unit-tested.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Use POST.' })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json(401, { success: false, code: 'UNAUTHORIZED', error: 'Missing access token.' })

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    // Caller-scoped client: reads only what the caller's own RLS allows.
    const callerClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error: authError } = await callerClient.auth.getUser(authHeader.slice(7).trim())
    if (authError || !user) return json(401, { success: false, code: 'UNAUTHORIZED', error: 'Invalid or expired session.' })

    let body: { employeeId?: unknown } = {}
    try { body = await req.json() } catch { return json(400, { success: false, code: 'BAD_REQUEST', error: 'Invalid JSON body.' }) }

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const ports: DeletionPorts = {
      loadCallerProfile: (authUserId) => callerClient.from('profiles')
        .select('auth_user_id, employee_id, is_active, roles(name), employees(status)')
        .eq('auth_user_id', authUserId).maybeSingle() as any,
      loadTargetEmployee: (id) => admin.from('employees').select('id, role_id, roles(name)').eq('id', id).maybeSingle() as any,
      loadTargetProfile: (id) => admin.from('profiles').select('id, auth_user_id, role_id, is_active, roles(name)').eq('employee_id', id).maybeSingle() as any,
      countRows: (table, column, id) => admin.from(table).select('*', { count: 'exact', head: true }).eq(column, id) as any,
      deleteProfile: (profileId) => admin.from('profiles').delete().eq('id', profileId) as any,
      restoreProfile: (p) => admin.from('profiles').insert({
        id: p.id, auth_user_id: p.auth_user_id, employee_id: p.employee_id, role_id: p.role_id, is_active: p.is_active,
      }) as any,
      deleteEmployee: (id) => admin.from('employees').delete().eq('id', id) as any,
      deleteAuthUser: async (authUserId) => {
        const { error } = await admin.auth.admin.deleteUser(authUserId)
        return { data: null, error: error ? { message: error.message } : null }
      },
    }

    const outcome = await runEmployeeDeletion(ports, user.id, body.employeeId)
    return json(outcome.status, outcome.body)
  } catch (err) {
    console.error('delete-employee failed:', err instanceof Error ? err.message : err)
    return json(500, { success: false, code: 'INTERNAL', error: 'Internal error. Refresh the employee list before trying again.' })
  }
})
