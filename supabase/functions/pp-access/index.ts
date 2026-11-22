import nodemailer from 'npm:nodemailer@6.10.1'
import { json, redactForLog } from '../_shared/http.ts'
import { serviceClient } from '../_shared/club_user.ts'
import { requireBroadcastCaller } from '../_shared/pp_caller.ts'
import {
  ADMIN_PAGE,
  SMTP_MAILBOX,
  cleanDivisions,
  inviteLetter,
  mergeDivisions,
  normalizeEmail,
  operatorSignInUrl,
  smtpReady,
} from '../_shared/pp_access.ts'

// Admin-only invites. Sends through the Gmail SMTP secrets already on this
// project (INVITE_SMTP_USER, INVITE_SMTP_PASS). Never returns the sign-in link.

const NOT_CONFIGURED = 'Invite email is not set up yet. Check the SMTP secrets, then resend.'
const SEND_FAILED = 'The operator is saved, but the email did not send. Press Resend.'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const user = (Deno.env.get('INVITE_SMTP_USER') ?? '').trim().toLowerCase()
  const pass = (Deno.env.get('INVITE_SMTP_PASS') ?? '').replace(/\s+/g, '')
  if (!smtpReady(user, pass)) return null
  return { user, pass }
}

function logSendFailure(error: unknown, pass: string): void {
  const raw = error instanceof Error ? error.message : 'send failed'
  const clean = pass ? raw.split(pass).join('[redacted]') : raw
  console.error('operator invite send failed', redactForLog(clean))
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

async function sendInvite(to: string, divisions: string[], link: string, pass: string): Promise<void> {
  const letter = inviteLetter(divisions, link)
  if (!letter) throw new Error('invite letter is empty')
  const safeLink = escapeHtml(link)
  const phrase = escapeHtml(letter.subject.replace('Pulse Play streams for ', ''))
  const html = `<!DOCTYPE html><html lang="en"><body style="font-family:Arial,sans-serif;color:#202018;">
<p>Ben invited you to run the Pulse Play streams for ${phrase}.</p>
<p><a href="${safeLink}">Sign in to Pulse Play</a></p>
<p>The link signs you in. It does not give you the YouTube account, setup screens, or other divisions.</p>
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

async function signInParts(
  admin: NonNullable<ReturnType<typeof serviceClient>>,
  email: string,
): Promise<{ tokenHash: string; type: string; userId: string } | { error: string }> {
  let result = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: ADMIN_PAGE },
  })
  if (result.error) {
    result = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: ADMIN_PAGE },
    })
  }
  if (result.error || !result.data?.properties || !result.data.user?.id) {
    const message = result.error?.message ?? ''
    if (/redirect/i.test(message)) {
      return { error: 'Add the GitHub Pages admin.html address to the Supabase Auth redirect allowlist, then resend.' }
    }
    return { error: 'Could not create a sign-in link. Try again.' }
  }
  const tokenHash = result.data.properties.hashed_token
  const type = result.data.properties.verification_type
  if (!tokenHash || !type) return { error: 'Could not create a sign-in link. Try again.' }
  return { tokenHash, type, userId: result.data.user.id }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: json(req, 204, {}).headers })
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const callerResult = await requireBroadcastCaller(req)
  if ('error' in callerResult) return json(req, callerResult.status, { error: callerResult.error })
  if (!callerResult.caller.admin) return json(req, 403, { error: 'Only a Pulse Play admin can invite operators.' })

  const text = await req.text()
  if (text.length > 4000) return json(req, 413, { error: 'That request is too large.' })
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
  if (!admin) return json(req, 500, { error: 'Invites are not available right now.' })

  if (action === 'list') {
    const listed = await admin
      .from('pp_operators')
      .select('id, email, divisions, active, created_at')
      .eq('active', true)
      .order('email')
    if (listed.error) return json(req, 500, { error: 'Invites are not available right now.' })
    return json(req, 200, { operators: listed.data ?? [] })
  }

  if (action === 'revoke' || action === 'resend') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!UUID_PATTERN.test(id)) return json(req, 400, { error: 'Choose an operator.' })
    const found = await admin.from('pp_operators').select('id, email, divisions, active').eq('id', id).maybeSingle()
    if (found.error || !found.data) return json(req, 404, { error: 'That operator is no longer listed.' })
    if (action === 'revoke') {
      const revoked = await admin.from('pp_operators').update({ active: false }).eq('id', id)
      if (revoked.error) return json(req, 500, { error: 'Could not revoke that operator.' })
      return json(req, 200, { ok: true })
    }
    const divisions = cleanDivisions(found.data.divisions)
    if (!divisions) return json(req, 409, { error: 'That operator has no division.' })
    const resent = await deliver(admin, found.data.email, divisions, null)
    return json(req, resent.status, resent.body)
  }

  if (action !== 'invite') return json(req, 400, { error: 'Choose an access action.' })
  const email = normalizeEmail(body.email)
  const divisions = cleanDivisions(body.divisions)
  if (!email || !divisions) return json(req, 400, { error: 'Enter an email and one of U9, U11, U13, or U15.' })

  const existing = await admin.from('pp_operators').select('id, divisions, user_id').eq('email', email).maybeSingle()
  if (existing.error) return json(req, 500, { error: 'Invites are not available right now.' })
  const userResult = await admin.auth.getUser((req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim())
  const invitedBy = userResult.data.user?.id ?? null
  const invited = await deliver(admin, email, mergeDivisions(existing.data?.divisions ?? [], divisions), invitedBy)
  return json(req, invited.status, invited.body)
})

async function deliver(
  admin: NonNullable<ReturnType<typeof serviceClient>>,
  email: string,
  divisions: string[],
  invitedBy: string | null,
): Promise<{ status: number; body: { ok?: true; error?: string } }> {
  const parts = await signInParts(admin, email)
  if ('error' in parts) return { status: 409, body: { error: parts.error } }
  const link = operatorSignInUrl(parts.tokenHash, parts.type)
  if (!link) return { status: 409, body: { error: 'Could not create a sign-in link. Try again.' } }

  const row: { email: string; divisions: string[]; user_id: string; active: boolean; invited_by?: string } = {
    email,
    divisions,
    user_id: parts.userId,
    active: true,
  }
  if (invitedBy) row.invited_by = invitedBy
  const saved = await admin.from('pp_operators').upsert(row, { onConflict: 'email' })
  if (saved.error) return { status: 500, body: { error: 'Could not save that operator.' } }

  const settings = smtpSettings()
  if (!settings) return { status: 503, body: { error: NOT_CONFIGURED } }
  try {
    await sendInvite(email, divisions, link, settings.pass)
  } catch (error) {
    logSendFailure(error, settings.pass)
    return { status: 502, body: { error: SEND_FAILED } }
  }
  return { status: 200, body: { ok: true } }
}
