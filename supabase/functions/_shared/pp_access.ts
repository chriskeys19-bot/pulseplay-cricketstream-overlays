// Division operators for Pulse Play. Pure checks only: no network, no secrets.

export const DIVISIONS = ['U9', 'U11', 'U13', 'U15'] as const
export const ADMIN_PAGE = 'https://chriskeys19-bot.github.io/pulseplay-cricketstream-overlays/admin.html'
export const SMTP_MAILBOX = 'cricketcrazeusa@gmail.com'

const REQUEST_ID = /^[A-Za-z0-9_-]{6,80}$/
const VIDEO_ID = /^[A-Za-z0-9_-]{6,64}$/

export type StreamRow = {
  id: string
  videoId: string
  division: string
}

export type Caller =
  | { admin: true }
  | { admin: false; active: boolean; divisions: string[] }

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length < 6 || email.length > 200) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

export function cleanDivisions(values: unknown): string[] | null {
  if (!Array.isArray(values) || values.length === 0 || values.length > DIVISIONS.length) return null
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || !DIVISIONS.includes(value as (typeof DIVISIONS)[number])) return null
    if (!out.includes(value)) out.push(value)
  }
  return out.length ? out : null
}

export function mergeDivisions(current: string[], extra: string[]): string[] {
  const have = new Set<string>()
  for (const value of current.concat(extra)) {
    if (DIVISIONS.includes(value as (typeof DIVISIONS)[number])) have.add(value)
  }
  return DIVISIONS.filter((value) => have.has(value))
}

export function divisionPhrase(divisions: string[]): string {
  const clean = mergeDivisions([], divisions)
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`
}

export function operatorSignInUrl(tokenHash: string, type: string): string | null {
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(tokenHash)) return null
  if (type !== 'magiclink' && type !== 'invite' && type !== 'signup' && type !== 'email') return null
  return `${ADMIN_PAGE}?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`
}

export function inviteLetter(divisions: string[], link: string): { subject: string; text: string } | null {
  const phrase = divisionPhrase(divisions)
  if (!phrase || !link.startsWith(ADMIN_PAGE)) return null
  const subject = `Pulse Play streams for ${phrase}`
  const text = [
    'Hello,',
    '',
    `Ben invited you to run the Pulse Play streams for ${phrase}.`,
    'Open this link to sign in. It opens the Pulse Play dashboard and shows only your division.',
    '',
    link,
    '',
    'The link signs you in. It does not give you the YouTube account, setup screens, or other divisions.',
    'If this note was not meant for you, ignore it.',
    '',
    'Pulse Play',
  ].join('\n')
  return { subject, text }
}

export function smtpFailure(user: string, pass: string): string | null {
  const account = user.trim().toLowerCase()
  const secret = pass.replace(/\s+/g, '')
  if (!account || !secret) return 'Set PP_INVITE_SMTP_USER and PP_INVITE_SMTP_PASS, then resend.'
  if (account !== SMTP_MAILBOX) return 'PP_INVITE_SMTP_USER must be cricketcrazeusa@gmail.com.'
  if (secret.length < 8) return 'PP_INVITE_SMTP_PASS is missing or too short.'
  return null
}

export function smtpReady(user: string, pass: string): boolean {
  return smtpFailure(user, pass) === null
}

export function authorizeBroadcast(input: {
  caller: Caller
  action: string
  requestedId: string
  rows: StreamRow[]
}): { ok: true; videoId: string } | { ok: false; status: number; error: string } {
  const action = input.action
  if (action !== 'status' && action !== 'list' && action !== 'test' && action !== 'start' && action !== 'end') {
    return { ok: false, status: 400, error: 'Choose a broadcast action.' }
  }
  if (!input.caller.admin) {
    if (!input.caller.active || input.caller.divisions.length === 0) {
      return { ok: false, status: 403, error: 'This operator invite is no longer active.' }
    }
    if (action !== 'start' && action !== 'end') {
      return { ok: false, status: 403, error: 'Operators start and end their own division. An admin manages the YouTube connection.' }
    }
  }
  if (action !== 'start' && action !== 'end') return { ok: true, videoId: '' }

  const requestedId = input.requestedId.trim()
  if (!REQUEST_ID.test(requestedId)) return { ok: false, status: 400, error: 'Choose a broadcast.' }

  const rows = input.rows.filter((row) => row.id === requestedId || row.videoId === requestedId)
  if (input.caller.admin) {
    const exact = rows.find((row) => row.id === requestedId)
    if (exact) return videoOf(exact, rows.filter((row) => row.id === requestedId))
    if (rows.length === 0) {
      if (!VIDEO_ID.test(requestedId)) return { ok: false, status: 400, error: 'Choose a broadcast.' }
      return { ok: true, videoId: requestedId }
    }
    return videoOf(rows[0], rows)
  }

  if (rows.length === 0) return { ok: false, status: 403, error: 'That stream is not in your division.' }
  const allowed = new Set(input.caller.divisions)
  if (rows.some((row) => !allowed.has(row.division))) {
    return { ok: false, status: 403, error: 'That stream is not in your division.' }
  }
  return videoOf(rows[0], rows)
}

function videoOf(
  first: StreamRow,
  rows: StreamRow[],
): { ok: true; videoId: string } | { ok: false; status: number; error: string } {
  if (!VIDEO_ID.test(first.videoId)) return { ok: false, status: 409, error: 'That stream has no YouTube broadcast yet.' }
  if (rows.some((row) => row.videoId !== first.videoId)) {
    return { ok: false, status: 409, error: 'That id matches more than one broadcast.' }
  }
  return { ok: true, videoId: first.videoId }
}

export type PpAdminRecord = {
  userId: string | null
  email: string
  active: boolean
}

export type PulsePlayDecision =
  | { kind: 'admin' }
  | { kind: 'operator'; divisions: string[] }
  | { kind: 'pending' }
  | { kind: 'none' }

export function classifyPulsePlayCaller(input: {
  profileRole: string | null | undefined
  accessStatus: string | null | undefined
  userId: string
  email: string | null | undefined
  emailConfirmedAt: string | null | undefined
  admins: PpAdminRecord[]
  operator: { active: boolean; divisions: string[] } | null
}): PulsePlayDecision {
  const email = (input.email ?? '').trim().toLowerCase()
  const verified = Boolean(input.emailConfirmedAt) && Boolean(email)
  const ppAdmin = input.admins.some((row) => {
    if (!row.active) return false
    if (row.userId && row.userId === input.userId) return true
    return verified && row.email.trim().toLowerCase() === email
  })
  if ((input.profileRole === 'admin' && input.accessStatus !== 'pending') || ppAdmin) return { kind: 'admin' }
  if (input.profileRole === 'admin' && input.accessStatus === 'pending') return { kind: 'pending' }
  const divisions = input.operator && input.operator.active ? cleanDivisions(input.operator.divisions) : null
  if (divisions) return { kind: 'operator', divisions }
  return { kind: 'none' }
}
