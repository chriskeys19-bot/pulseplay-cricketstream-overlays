import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.81.1'
import { classifyPulsePlayCaller, type PpAdminRecord, type PulsePlayDecision } from './pp_access.ts'
import { canonicalDivision, canonicalTournament, type AccessGrant, type AccessRole, type GrantStatus, type ScopeType } from './pp_scope.ts'

type Account = {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
}

type AdminRow = { id?: string; user_id?: string | null; email?: string | null; active?: boolean | null }
type OperatorRow = { id?: string; user_id?: string | null; divisions?: unknown; active?: boolean | null }
type GrantRow = {
  id?: string
  user_id?: string | null
  email?: string | null
  scope_type?: string | null
  tournament?: string | null
  division?: string | null
  role?: string | null
  status?: string | null
}

function asGrant(row: GrantRow): AccessGrant | null {
  const scopeType = row.scope_type
  const role = row.role
  const status = row.status
  if (scopeType !== 'all' && scopeType !== 'tournament' && scopeType !== 'division') return null
  if (role !== 'admin' && role !== 'operator') return null
  if (status !== 'pending' && status !== 'active' && status !== 'revoked') return null
  return {
    scopeType: scopeType as ScopeType,
    tournament: canonicalTournament(row.tournament),
    division: canonicalDivision(row.division),
    role: role as AccessRole,
    status: status as GrantStatus,
  }
}

function records(rows: AdminRow[] | null): PpAdminRecord[] {
  const out: PpAdminRecord[] = []
  for (const row of rows ?? []) {
    if (!row || typeof row.email !== 'string') continue
    out.push({
      userId: typeof row.user_id === 'string' ? row.user_id : null,
      email: row.email,
      active: row.active === true,
    })
  }
  return out
}

export async function resolvePulsePlayCaller(
  admin: SupabaseClient,
  user: Account,
  profile: { role?: string | null; access?: string | null },
): Promise<PulsePlayDecision | { kind: 'error' }> {
  const email = (user.email ?? '').trim().toLowerCase()
  const byId = await admin.from('pp_admins').select('id, user_id, email, active').eq('user_id', user.id)
  if (byId.error) return { kind: 'error' }
  let adminRows = records(byId.data as AdminRow[] | null)
  if (email) {
    const byEmail = await admin.from('pp_admins').select('id, user_id, email, active').eq('email', email)
    if (byEmail.error) return { kind: 'error' }
    adminRows = adminRows.concat(records(byEmail.data as AdminRow[] | null))
    const link = (byEmail.data as AdminRow[] | null)?.find((row) => row && row.active === true && !row.user_id && row.id)
    if (link?.id && user.email_confirmed_at) {
      await admin.from('pp_admins').update({ user_id: user.id }).eq('id', link.id)
    }
  }

  const grants: AccessGrant[] = []
  const byGrantId = await admin
    .from('pp_access_grants')
    .select('id, user_id, email, scope_type, tournament, division, role, status')
    .eq('user_id', user.id)
  if (byGrantId.error && !/pp_access_grants/i.test(byGrantId.error.message)) return { kind: 'error' }
  const grantRows: GrantRow[] = byGrantId.error ? [] : (byGrantId.data as GrantRow[] | null) ?? []
  if (email) {
    const byGrantEmail = await admin
      .from('pp_access_grants')
      .select('id, user_id, email, scope_type, tournament, division, role, status')
      .eq('email', email)
    if (byGrantEmail.error && !/pp_access_grants/i.test(byGrantEmail.error.message)) return { kind: 'error' }
    if (!byGrantEmail.error) {
      for (const row of (byGrantEmail.data as GrantRow[] | null) ?? []) {
        if (row && !grantRows.some((have) => have.id && have.id === row.id)) grantRows.push(row)
      }
    }
  }
  for (const row of grantRows) {
    const parsed = asGrant(row)
    if (!parsed || typeof row.email !== 'string') continue
    const sameEmail = row.email.trim().toLowerCase() === email
    const ownsRow = row.user_id === user.id || (!row.user_id && sameEmail)
    if (!ownsRow) continue
    if (row.id && (row.user_id !== user.id || (parsed.status === 'pending' && user.email_confirmed_at))) {
      const patch: { user_id: string; status?: 'active'; updated_at: string } = {
        user_id: user.id,
        updated_at: new Date().toISOString(),
      }
      if (parsed.status === 'pending' && user.email_confirmed_at) {
        patch.status = 'active'
        parsed.status = 'active'
      }
      await admin.from('pp_access_grants').update(patch).eq('id', row.id)
    }
    grants.push(parsed)
  }

  const byOperatorId = await admin.from('pp_operators').select('id, user_id, divisions, active').eq('user_id', user.id).maybeSingle()
  if (byOperatorId.error) return { kind: 'error' }
  let operator = byOperatorId.data as OperatorRow | null
  if (!operator && email) {
    const byOperatorEmail = await admin.from('pp_operators').select('id, user_id, divisions, active').eq('email', email).maybeSingle()
    if (byOperatorEmail.error) return { kind: 'error' }
    operator = byOperatorEmail.data as OperatorRow | null
    if (operator && !operator.user_id && operator.id) {
      await admin.from('pp_operators').update({ user_id: user.id }).eq('id', operator.id)
    }
  }

  return classifyPulsePlayCaller({
    profileRole: profile.role,
    accessStatus: profile.access,
    userId: user.id,
    email: user.email,
    emailConfirmedAt: user.email_confirmed_at,
    admins: adminRows,
    operator: operator && Array.isArray(operator.divisions)
      ? { active: operator.active === true, divisions: operator.divisions.filter((item): item is string => typeof item === 'string') }
      : null,
    grants,
  })
}
