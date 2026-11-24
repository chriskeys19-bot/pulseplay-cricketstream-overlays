import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.81.1'
import { classifyPulsePlayCaller, type PpAdminRecord, type PulsePlayDecision } from './pp_access.ts'

type Account = {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
}

type AdminRow = { id?: string; user_id?: string | null; email?: string | null; active?: boolean | null }
type OperatorRow = { id?: string; user_id?: string | null; divisions?: unknown; active?: boolean | null }

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
  })
}
