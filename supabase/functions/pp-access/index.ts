import nodemailer from 'npm:nodemailer@6.10.1'
import { json, preflight, redactForLog } from '../_shared/http.ts'
import { serviceClient } from '../_shared/club_user.ts'
import { requirePulsePlayUser } from '../_shared/pp_caller.ts'
import {
  ADMIN_PAGE,
  SMTP_MAILBOX,
  operatorSignInUrl,
  scopeInviteLetter,
  smtpFailure,
  smtpMode,
  type PulsePlayDecision,
} from '../_shared/pp_access.ts'
import {
  AGE_GROUPS,
  canManageTarget,
  dashboardAccess,
  grantResponse,
  invitePlan,
  normalizeScope,
  redactSecrets,
  scopeLabel,
  tournamentChoices,
  type AccessGrant,
  type ScopeTarget,
} from '../_shared/pp_scope.ts'

// Access grants for Pulse Play. verify_jwt stays on.
// OPTIONS uses preflight() so a 204 is never given a body.
// Invites use the service role (auth.admin), not a personal access token.
// A custom mailbox is used only when PP_INVITE_SMTP_USER and
// PP_INVITE_SMTP_PASS are set. Otherwise Supabase Auth sends the invite.
// If sending fails, the pending grant remains and the response includes a link.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Admin = NonNullable<ReturnType<typeof serviceClient>>

type GrantRecord = {
  id: string
  email: string
  userId: string | null
  scopeType: ScopeTarget['scopeType']
  tournament: string | null
  division: string | null
  role: ScopeTarget['role']
  status: 'pending' | 'active' | 'revoked'
  createdAt: string | null
  updatedAt: string | null
}

function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function smtpSettings(): { user: string; pass: string } | null {
  const user = (Deno.env.get('PP_INVITE_SMTP_USER') ?? '').trim().toLowerCase()
  const pass = (Deno.env.get('PP_INVITE_SMTP_PASS') ?? '').replace(/\s+/g, '')
  if (smtpMode(user, pass) !== 'ready') return null
  return { user, pass }
}

function currentSmtpMode(): 'ready' | 'unset' | 'invalid' {
  const user = (Deno.env.get('PP_INVITE_SMTP_USER') ?? '').trim().toLowerCase()
  const pass = (Deno.env.get('PP_INVITE_SMTP_PASS') ?? '').replace(/\s+/g, '')
  return smtpMode(user, pass)
}

function logFailure(error: unknown, secrets: string[]): void {
  const raw = error instanceof Error ? error.message : 'send failed'
  console.error('access invite failed', redactForLog(redactSecrets(raw, secrets)))
}

function cleanAuthError(message: string, secrets: string[]): string {
  const text = redactSecrets(message || '', secrets).replace(/\s+/g, ' ').trim()
  if (/redirect/i.test(text)) {
    return 'Add the GitHub Pages admin.html address to the Supabase Auth redirect allowlist, then try again.'
  }
  if (/already (?:been )?registered/i.test(text)) return 'That person already has an account.'
  if (!text) return 'The invite email could not be sent.'
  return text.slice(0, 180)
}

type MailTransport = { sendMail: (message: Record<string, unknown>) => Promise<unknown> }

function createTransport(options: Record<string, unknown>): MailTransport {
  const candidate = nodemailer as {
    createTransport?: (options: Record<string, unknown>) => MailTransport
    default?: { createTransport?: (options: Record<string, unknown>) => MailTransport }
  }
  const factory = candidate.createTransport ?? candidate.default?.createTransport
  if (!factory) throw new Error('SMTP client is unavailable')
  return factory(options)
}

async function sendSmtp(to: string, label: string, link: string, pass: string): Promise<void> {
  const letter = scopeInviteLetter(label, link)
  if (!letter) throw new Error('invite letter is empty')
  const html = `<!DOCTYPE html><html lang="en"><body style="font-family:Arial,sans-serif;color:#202018;">
<p>You have been invited to Pulse Play (${escapeHtml(label)}).</p>
<p><a href="${escapeHtml(link)}">Sign in to Pulse Play</a></p>
<p>If this note was not meant for you, ignore it.</p></body></html>`
  const transport = createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: SMTP_MAILBOX, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  })
  await transport.sendMail({
    from: { name: 'Pulse Play', address: SMTP_MAILBOX },
    to,
    replyTo: SMTP_MAILBOX,
    subject: headerSafe(letter.subject),
    text: letter.text,
    html,
  })
}

function linkFromProperties(
  properties: { action_link?: string; hashed_token?: string; verification_type?: string } | null | undefined,
): string | null {
  const actionLink = properties?.action_link ?? ''
  if (actionLink.startsWith('https://') && !/\s/.test(actionLink)) return actionLink
  const token = properties?.hashed_token ?? ''
  const type = properties?.verification_type ?? ''
  return operatorSignInUrl(token, type)
}

async function makeLink(
  admin: Admin,
  email: string,
  existing: boolean,
): Promise<{ link: string; userId: string } | { error: string }> {
  const first = existing ? 'magiclink' : 'invite'
  let result = await admin.auth.admin.generateLink({
    type: first,
    email,
    options: { redirectTo: ADMIN_PAGE },
  })
  if (result.error) {
    result = await admin.auth.admin.generateLink({
      type: existing ? 'invite' : 'magiclink',
      email,
      options: { redirectTo: ADMIN_PAGE },
    })
  }
  if (result.error || !result.data?.user?.id) {
    return { error: cleanAuthError(result.error?.message ?? '', []) }
  }
  const link = linkFromProperties(result.data.properties)
  if (!link) return { error: 'Could not create a sign-in link. Try again.' }
  return { link, userId: result.data.user.id }
}

async function sendBuiltin(admin: Admin, email: string, existing: boolean): Promise<{ ok: true } | { error: string }> {
  if (!existing) {
    const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: ADMIN_PAGE })
    if (!invited.error) return { ok: true }
    return { error: cleanAuthError(invited.error.message, []) }
  }
  const otp = await admin.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: ADMIN_PAGE, shouldCreateUser: false },
  })
  if (!otp.error) return { ok: true }
  return { error: cleanAuthError(otp.error.message, []) }
}

type AuthHit = { id: string; confirmed: boolean }

async function findAuthUser(admin: Admin, email: string): Promise<AuthHit | null | { error: string }> {
  const result = await admin.rpc('pp_auth_user_by_email', { p_email: email })
  if (result.error) {
    const message = result.error.message || ''
    if (/pp_auth_user_by_email|schema cache|does not exist|PGRST202/i.test(message)) {
      return { error: 'Apply the pp_access_grants migration before adding people.' }
    }
    console.error('access lookup failed', redactForLog(message))
    return { error: 'Could not look up that email. Try again.' }
  }
  const row = Array.isArray(result.data) ? result.data[0] : result.data
  if (!row || typeof row !== 'object') return null
  const record = row as { id?: unknown; email_confirmed_at?: unknown }
  if (typeof record.id !== 'string') return null
  return { id: record.id, confirmed: typeof record.email_confirmed_at === 'string' && record.email_confirmed_at.length > 0 }
}

function parseGrant(row: Record<string, unknown>): GrantRecord | null {
  const scopeType = row.scope_type
  const role = row.role
  const status = row.status
  if (typeof row.id !== 'string' || typeof row.email !== 'string') return null
  if (scopeType !== 'all' && scopeType !== 'tournament' && scopeType !== 'division') return null
  if (role !== 'admin' && role !== 'operator') return null
  if (status !== 'pending' && status !== 'active' && status !== 'revoked') return null
  return {
    id: row.id,
    email: row.email,
    userId: typeof row.user_id === 'string' ? row.user_id : null,
    scopeType,
    tournament: typeof row.tournament === 'string' ? row.tournament : null,
    division: typeof row.division === 'string' ? row.division : null,
    role,
    status,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

function toAccessGrant(row: GrantRecord): AccessGrant {
  return {
    scopeType: row.scopeType,
    tournament: row.tournament,
    division: row.division,
    role: row.role,
    status: row.status,
  }
}

function publicGrant(row: GrantRecord): Record<string, unknown> {
  return {
    id: row.id,
    email: row.email,
    userId: row.userId,
    scopeType: row.scopeType,
    tournament: row.tournament,
    division: row.division,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function loadGrants(admin: Admin): Promise<GrantRecord[] | { error: string }> {
  const listed = await admin
    .from('pp_access_grants')
    .select('id, email, user_id, scope_type, tournament, division, role, status, created_at, updated_at')
    .order('email')
  if (listed.error) {
    if (/pp_access_grants|schema cache|does not exist/i.test(listed.error.message)) {
      return { error: 'Apply the pp_access_grants migration before opening Access.' }
    }
    return { error: 'Access grants could not be read. Try again.' }
  }
  const out: GrantRecord[] = []
  for (const row of listed.data ?? []) {
    if (!row || typeof row !== 'object') continue
    const parsed = parseGrant(row as Record<string, unknown>)
    if (parsed) out.push(parsed)
  }
  return out
}

async function tournamentList(admin: Admin): Promise<string[]> {
  const listed = await admin.from('pp_streams').select('event')
  const values: unknown[] = []
  if (!listed.error) {
    for (const row of listed.data ?? []) {
      if (row && typeof row === 'object' && 'event' in row) values.push((row as { event?: unknown }).event)
    }
  }
  return tournamentChoices(values)
}

function manages(decision: PulsePlayDecision, target: { scopeType: ScopeTarget['scopeType']; tournament: string | null; division: string | null }): boolean {
  const grants = decision.kind === 'scoped' ? decision.grants : []
  return canManageTarget({ fullAdmin: decision.kind === 'admin', grants, target })
}

async function findIdentity(admin: Admin, scope: ScopeTarget & { email: string; role: ScopeTarget['role'] }): Promise<GrantRecord | null | { error: string }> {
  let query = admin
    .from('pp_access_grants')
    .select('id, email, user_id, scope_type, tournament, division, role, status, created_at, updated_at')
    .eq('email', scope.email)
    .eq('scope_type', scope.scopeType)
    .eq('role', scope.role)
  query = scope.tournament ? query.eq('tournament', scope.tournament) : query.is('tournament', null)
  query = scope.division ? query.eq('division', scope.division) : query.is('division', null)
  const found = await query.maybeSingle()
  if (found.error) return { error: 'Access grants could not be read. Try again.' }
  if (!found.data) return null
  return parseGrant(found.data as Record<string, unknown>)
}

async function mirrorFullAdmin(admin: Admin, email: string, userId: string | null, active: boolean, invitedBy: string | null): Promise<void> {
  if (active) {
    const existing = await admin.from('pp_admins').select('id, user_id').eq('email', email).maybeSingle()
    if (existing.data?.id) {
      await admin.from('pp_admins').update({ active: true, user_id: existing.data.user_id || userId }).eq('id', existing.data.id)
      return
    }
    await admin.from('pp_admins').insert({ email, user_id: userId, active: true, added_by: invitedBy })
    return
  }
  const still = await admin
    .from('pp_access_grants')
    .select('id')
    .eq('email', email)
    .eq('scope_type', 'all')
    .eq('role', 'admin')
    .eq('status', 'active')
    .limit(1)
  if (still.data && still.data.length > 0) return
  await admin.from('pp_admins').update({ active: false }).eq('email', email)
}

async function writeGrant(
  admin: Admin,
  input: {
    email: string
    userId: string | null
    scope: ScopeTarget
    status: 'pending' | 'active'
    invitedBy: string | null
  },
): Promise<GrantRecord | { error: string }> {
  const identity = await findIdentity(admin, { ...input.scope, email: input.email })
  if (identity && 'error' in identity) return identity
  const payload = {
    email: input.email,
    user_id: input.userId,
    scope_type: input.scope.scopeType,
    tournament: input.scope.tournament,
    division: input.scope.division,
    role: input.scope.role,
    status: input.status,
    invited_by: input.invitedBy,
    updated_at: new Date().toISOString(),
  }
  const saved = identity
    ? await admin.from('pp_access_grants').update({
      user_id: payload.user_id ?? identity.userId,
      scope_type: payload.scope_type,
      tournament: payload.tournament,
      division: payload.division,
      role: payload.role,
      status: payload.status,
      updated_at: payload.updated_at,
    }).eq('id', identity.id).select('id, email, user_id, scope_type, tournament, division, role, status, created_at, updated_at').single()
    : await admin.from('pp_access_grants').insert(payload).select('id, email, user_id, scope_type, tournament, division, role, status, created_at, updated_at').single()
  if (saved.error || !saved.data) return { error: 'Could not save that grant.' }
  const parsed = parseGrant(saved.data as Record<string, unknown>)
  if (!parsed) return { error: 'Could not save that grant.' }
  if (parsed.scopeType === 'all' && parsed.role === 'admin') {
    await mirrorFullAdmin(admin, parsed.email, parsed.userId, parsed.status === 'active', input.invitedBy)
  }
  return parsed
}

async function attachUser(admin: Admin, id: string, userId: string): Promise<void> {
  await admin.from('pp_access_grants').update({ user_id: userId, updated_at: new Date().toISOString() }).eq('id', id)
}

async function deliver(
  admin: Admin,
  email: string,
  label: string,
  existing: boolean,
): Promise<{ emailed: boolean; inviteLink: string | null; warning: string | null; userId: string | null }> {
  const mode = currentSmtpMode()
  const plan = invitePlan(false, mode)
  if (plan === 'grant') return { emailed: false, inviteLink: null, warning: null, userId: null }
  const secrets = smtpSettings()
  const pass = secrets?.pass ?? ''
  if (plan === 'smtp' || plan === 'link') {
    const made = await makeLink(admin, email, existing)
    if ('error' in made) return { emailed: false, inviteLink: null, warning: made.error, userId: null }
    if (plan === 'link') {
      const reason = smtpFailure(
        (Deno.env.get('PP_INVITE_SMTP_USER') ?? '').trim().toLowerCase(),
        (Deno.env.get('PP_INVITE_SMTP_PASS') ?? '').replace(/\s+/g, ''),
      )
      return {
        emailed: false,
        inviteLink: made.link,
        warning: `${reason || 'The invite mailbox is not ready.'} The grant is saved. Copy the invite link.`,
        userId: made.userId,
      }
    }
    try {
      await sendSmtp(email, label, made.link, pass)
      return { emailed: true, inviteLink: made.link, warning: null, userId: made.userId }
    } catch (error) {
      logFailure(error, pass ? [pass] : [])
      return {
        emailed: false,
        inviteLink: made.link,
        warning: 'The grant is saved, but the email did not send. Copy the invite link or press Resend.',
        userId: made.userId,
      }
    }
  }
  const sent = await sendBuiltin(admin, email, existing)
  if ('error' in sent) {
    const made = await makeLink(admin, email, existing)
    if ('error' in made) return { emailed: false, inviteLink: null, warning: sent.error, userId: null }
    return {
      emailed: false,
      inviteLink: made.link,
      warning: `${sent.error} The grant is saved. Copy the invite link.`,
      userId: made.userId,
    }
  }
  const created = await findAuthUser(admin, email)
  const createdId = created && !('error' in created) ? created.id : null
  return { emailed: true, inviteLink: null, warning: null, userId: createdId }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const signedIn = await requirePulsePlayUser(req)
  if ('error' in signedIn) return json(req, signedIn.status, { error: signedIn.error })
  const decision = signedIn.decision
  const actorId = signedIn.userId

  const text = await req.text()
  if (text.length > 8000) return json(req, 413, { error: 'That request is too large.' })
  let body: Record<string, unknown> = {}
  if (text.trim()) {
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      return json(req, 400, { error: 'Send JSON.' })
    }
  }
  const action = body.action
  const admin = serviceClient()
  if (!admin) return json(req, 500, { error: 'Access grants are not available right now.' })

  const tournaments = await tournamentList(admin)
  const callerGrants = decision.kind === 'scoped' ? decision.grants : []
  const access = dashboardAccess({ fullAdmin: decision.kind === 'admin', grants: callerGrants })

  if (action === 'me') {
    const loaded = await loadGrants(admin)
    const ownEmail = (signedIn.email ?? '').trim().toLowerCase()
    const own = Array.isArray(loaded)
      ? loaded.filter((row) => row.userId === actorId || row.email === ownEmail)
      : []
    const summary = dashboardAccess({
      fullAdmin: decision.kind === 'admin',
      grants: own.map(toAccessGrant),
    })
    const legacyDivisions = decision.kind === 'operator' ? decision.divisions : []
    return json(req, 200, {
      fullAdmin: summary.fullAdmin,
      manage: summary.manage,
      setup: summary.setup,
      broadcasts: summary.broadcasts,
      allowed: summary.allowed || legacyDivisions.length > 0,
      grants: own.map(publicGrant),
      divisions: legacyDivisions,
      tournaments,
      ageGroups: AGE_GROUPS,
    })
  }

  if (!access.manage) {
    return json(req, 403, { error: 'Only a full admin, or a tournament admin, can grant access.' })
  }

  if (action === 'list') {
    const loaded = await loadGrants(admin)
    if ('error' in loaded) return json(req, 500, { error: loaded.error })
    const visible = loaded.filter((row) => manages(decision, row) || row.userId === actorId || row.email === (signedIn.email ?? '').toLowerCase())
    return json(req, 200, { grants: visible.map(publicGrant), tournaments, ageGroups: AGE_GROUPS })
  }

  if (action === 'revoke' || action === 'resend' || action === 'link' || action === 'update') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!UUID_PATTERN.test(id)) return json(req, 400, { error: 'Choose a grant.' })
    const found = await admin
      .from('pp_access_grants')
      .select('id, email, user_id, scope_type, tournament, division, role, status, created_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    if (found.error || !found.data) return json(req, 404, { error: 'That grant is no longer listed.' })
    const grant = parseGrant(found.data as Record<string, unknown>)
    if (!grant) return json(req, 404, { error: 'That grant is no longer listed.' })
    if (!manages(decision, grant)) return json(req, 403, { error: 'That grant is outside your tournament.' })

    if (action === 'revoke') {
      if (grant.email === (signedIn.email ?? '').trim().toLowerCase() && grant.scopeType === 'all' && grant.role === 'admin') {
        return json(req, 409, { error: 'You cannot revoke your own full admin grant.' })
      }
      const revoked = await admin.from('pp_access_grants').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('id', id)
      if (revoked.error) return json(req, 500, { error: 'Could not revoke that grant.' })
      if (grant.scopeType === 'all' && grant.role === 'admin') await mirrorFullAdmin(admin, grant.email, grant.userId, false, null)
      return json(req, 200, { ok: true, status: 'revoked' })
    }

    if (grant.status === 'revoked' && action !== 'update') {
      return json(req, 409, { error: 'That grant is revoked. Add the person again to restore it.' })
    }

    if (action === 'link' || action === 'resend') {
      const authUser = await findAuthUser(admin, grant.email)
      if (authUser && 'error' in authUser) return json(req, 409, { error: authUser.error })
      const existing = Boolean(authUser && !('error' in authUser))
      if (action === 'link') {
        const made = await makeLink(admin, grant.email, existing)
        if ('error' in made) return json(req, 409, { error: made.error })
        if (!grant.userId) await attachUser(admin, grant.id, made.userId)
        return json(req, 200, {
          ok: true,
          inviteLink: made.link,
          warning: 'This is a new sign-in link. An older link in an email may stop working.',
        })
      }
      const sent = await deliver(admin, grant.email, scopeLabel(grant), existing)
      if (sent.userId && !grant.userId) await attachUser(admin, grant.id, sent.userId)
      const response = grantResponse({
        grantStatus: grant.status === 'active' ? 'active' : 'pending',
        emailed: sent.emailed,
        inviteLink: sent.inviteLink,
        warning: sent.warning,
      })
      return json(req, response.httpStatus, response.body)
    }

    if (grant.email === (signedIn.email ?? '').trim().toLowerCase() && grant.scopeType === 'all' && grant.role === 'admin') {
      return json(req, 409, { error: 'You cannot change your own full admin grant.' })
    }
    const next = normalizeScope({
      scopeType: body.scopeType,
      tournament: body.tournament,
      division: body.division,
      role: body.role,
      tournaments,
    })
    if (!next.ok) return json(req, 400, { error: next.error })
    if (!manages(decision, next.scope)) return json(req, 403, { error: 'That scope is outside your tournament.' })
    const clash = await findIdentity(admin, { ...next.scope, email: grant.email })
    if (clash && 'error' in clash) return json(req, 500, { error: clash.error })
    if (clash && clash.id !== grant.id) return json(req, 409, { error: 'That person already has this scope.' })
    const updated = await admin
      .from('pp_access_grants')
      .update({
        scope_type: next.scope.scopeType,
        tournament: next.scope.tournament,
        division: next.scope.division,
        role: next.scope.role,
        updated_at: new Date().toISOString(),
      })
      .eq('id', grant.id)
      .select('id, email, user_id, scope_type, tournament, division, role, status, created_at, updated_at')
      .single()
    if (updated.error || !updated.data) return json(req, 500, { error: 'Could not change that scope.' })
    const parsed = parseGrant(updated.data as Record<string, unknown>)
    if (!parsed) return json(req, 500, { error: 'Could not change that scope.' })
    await mirrorFullAdmin(
      admin,
      parsed.email,
      parsed.userId,
      parsed.scopeType === 'all' && parsed.role === 'admin' && parsed.status === 'active',
      actorId,
    )
    if (grant.scopeType === 'all' && grant.role === 'admin' && (parsed.scopeType !== 'all' || parsed.role !== 'admin')) {
      await mirrorFullAdmin(admin, grant.email, grant.userId, false, null)
    }
    return json(req, 200, { ok: true, grant: publicGrant(parsed) })
  }

  if (action !== 'grant') return json(req, 400, { error: 'Choose an access action.' })
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return json(req, 400, { error: 'Enter an email address.' })
  }
  const scope = normalizeScope({
    scopeType: body.scopeType,
    tournament: body.tournament,
    division: body.division,
    role: body.role,
    tournaments,
  })
  if (!scope.ok) return json(req, 400, { error: scope.error })
  if (!manages(decision, scope.scope)) return json(req, 403, { error: 'That scope is outside your tournament.' })

  const authUser = await findAuthUser(admin, email)
  if (authUser && 'error' in authUser) return json(req, 409, { error: authUser.error })
  const existing = Boolean(authUser && !('error' in authUser))
  const userId = existing && authUser && !('error' in authUser) ? authUser.id : null
  const status = existing ? 'active' : 'pending'
  const saved = await writeGrant(admin, { email, userId, scope: scope.scope, status, invitedBy: actorId })
  if ('error' in saved) return json(req, 500, { error: saved.error })

  if (existing) {
    return json(req, 200, { ok: true, status: 'active', emailed: false, inviteLink: null, grant: publicGrant(saved) })
  }
  const sent = await deliver(admin, email, scopeLabel(scope.scope), false)
  if (sent.userId && sent.userId !== saved.userId) await attachUser(admin, saved.id, sent.userId)
  const response = grantResponse({
    grantStatus: 'pending',
    emailed: sent.emailed,
    inviteLink: sent.inviteLink,
    warning: sent.warning,
  })
  return json(req, response.httpStatus, { ...response.body, grant: publicGrant({ ...saved, userId: sent.userId || saved.userId }) })
})
