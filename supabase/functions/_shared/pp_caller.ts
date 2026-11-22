import { createClient } from 'npm:@supabase/supabase-js@2.81.1'
import { serviceClient } from './club_user.ts'
import { cleanDivisions, type Caller } from './pp_access.ts'

export async function requireBroadcastCaller(
  req: Request,
): Promise<{ caller: Caller; userId: string } | { status: number; error: string }> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt || jwt.split('.').length !== 3) return { status: 401, error: 'Sign in again.' }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !anonKey) return { status: 500, error: 'Streams are not available right now.' }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const userResult = await supabase.auth.getUser(jwt)
  const user = userResult.data.user
  if (userResult.error || !user) return { status: 401, error: 'Sign in again.' }

  const profileResult = await supabase.from('profiles').select('role, access_status').eq('id', user.id).maybeSingle()
  let role = profileResult.data?.role
  let access = profileResult.data?.access_status
  if (profileResult.error && /access_status/i.test(profileResult.error.message)) {
    const retry = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (retry.error) return { status: 500, error: 'Streams are not available right now.' }
    role = retry.data?.role
    access = 'active'
  } else if (profileResult.error) {
    return { status: 500, error: 'Streams are not available right now.' }
  }
  if (role === 'admin' && access !== 'pending') return { caller: { admin: true }, userId: user.id }
  if (role === 'admin' && access === 'pending') return { status: 403, error: 'Your club access is still pending.' }

  const admin = serviceClient()
  if (!admin) return { status: 500, error: 'Streams are not available right now.' }
  const email = (user.email ?? '').trim().toLowerCase()
  const byId = await admin
    .from('pp_operators')
    .select('id, user_id, divisions, active')
    .eq('user_id', user.id)
    .maybeSingle()
  if (byId.error) return { status: 500, error: 'Streams are not available right now.' }
  let row = byId.data
  if (!row && email) {
    const byEmail = await admin
      .from('pp_operators')
      .select('id, user_id, divisions, active')
      .eq('email', email)
      .maybeSingle()
    if (byEmail.error) return { status: 500, error: 'Streams are not available right now.' }
    row = byEmail.data
    if (row && !row.user_id) {
      await admin.from('pp_operators').update({ user_id: user.id }).eq('id', row.id)
    }
  }
  const divisions = cleanDivisions(row?.divisions)
  if (!row || !row.active || !divisions) {
    return { status: 403, error: 'Only a Pulse Play admin or division operator can do that.' }
  }
  return { caller: { admin: false, active: true, divisions }, userId: user.id }
}
