// Pulse Play access scopes. Pure checks only: no network, no secrets.
// Full admin: every tournament. Tournament admin: one tournament.
// Age-group operator: one division in one tournament, or in every tournament.

export const AGE_GROUPS = ['U9', 'U11', 'U13', 'U15', 'U17', 'U19'] as const
export const KNOWN_TOURNAMENTS = ['AMLCA', 'NCCA', 'NYCT', 'PSD'] as const

export type ScopeType = 'all' | 'tournament' | 'division'
export type AccessRole = 'admin' | 'operator'
export type GrantStatus = 'pending' | 'active' | 'revoked'

export type AccessGrant = {
  scopeType: ScopeType
  tournament: string | null
  division: string | null
  role: AccessRole
  status: GrantStatus
}

export type ScopeTarget = {
  scopeType: ScopeType
  tournament: string | null
  division: string | null
  role: AccessRole
}

const TOURNAMENT_CODE = /^[A-Z][A-Z0-9]{1,11}$/

export function canonicalTournament(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toUpperCase()
  if (!TOURNAMENT_CODE.test(text)) return null
  return text
}

export function canonicalDivision(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toUpperCase()
  return AGE_GROUPS.includes(text as (typeof AGE_GROUPS)[number]) ? text : null
}

export function tournamentChoices(values: unknown[]): string[] {
  const have = new Set<string>(KNOWN_TOURNAMENTS)
  for (const value of values) {
    const code = canonicalTournament(value)
    if (code) have.add(code)
  }
  return [...have].sort()
}

export function normalizeScope(input: {
  scopeType: unknown
  tournament: unknown
  division: unknown
  role: unknown
  tournaments?: string[] | null
}): { ok: true; scope: ScopeTarget } | { ok: false; error: string } {
  const scopeType = input.scopeType
  const role = input.role
  if (scopeType !== 'all' && scopeType !== 'tournament' && scopeType !== 'division') {
    return { ok: false, error: 'Choose All tournaments, one tournament, or an age group.' }
  }
  if (role !== 'admin' && role !== 'operator') return { ok: false, error: 'Choose Admin or Operator.' }

  if (scopeType === 'all') {
    return { ok: true, scope: { scopeType, tournament: null, division: null, role } }
  }

  const tournament = canonicalTournament(input.tournament)
  if (scopeType === 'tournament') {
    if (!tournament) return { ok: false, error: 'Choose a tournament.' }
    if (input.tournaments && !input.tournaments.includes(tournament)) {
      return { ok: false, error: 'Choose a tournament from the list.' }
    }
    return { ok: true, scope: { scopeType, tournament, division: null, role } }
  }

  const division = canonicalDivision(input.division)
  if (!division) return { ok: false, error: 'Choose an age group from U9 through U19.' }
  if (input.tournament != null && String(input.tournament).trim() !== '' && !tournament) {
    return { ok: false, error: 'Choose a tournament from the list.' }
  }
  if (tournament && input.tournaments && !input.tournaments.includes(tournament)) {
    return { ok: false, error: 'Choose a tournament from the list.' }
  }
  return { ok: true, scope: { scopeType, tournament, division, role } }
}

export function isFullAdminGrant(grant: AccessGrant): boolean {
  return grant.status === 'active' && grant.scopeType === 'all' && grant.role === 'admin'
}

export function grantCoversStream(
  grant: AccessGrant,
  stream: { tournament?: string | null; division?: string | null },
): boolean {
  if (grant.status !== 'active') return false
  if (grant.scopeType === 'all') return true
  const tournament = canonicalTournament(stream.tournament)
  const division = canonicalDivision(stream.division)
  if (grant.scopeType === 'tournament') return Boolean(grant.tournament && tournament && grant.tournament === tournament)
  if (grant.scopeType === 'division') {
    if (!grant.division || !division || grant.division !== division) return false
    if (!grant.tournament) return true
    return Boolean(tournament && grant.tournament === tournament)
  }
  return false
}

export function streamAllowed(grants: AccessGrant[], stream: { tournament?: string | null; division?: string | null }): boolean {
  return grants.some((grant) => grantCoversStream(grant, stream))
}

export function canManageTarget(input: {
  fullAdmin: boolean
  grants: AccessGrant[]
  target: { scopeType: ScopeType; tournament: string | null; division: string | null }
}): boolean {
  if (input.fullAdmin) return true
  return input.grants.some((grant) => {
    if (grant.status !== 'active' || grant.role !== 'admin' || grant.scopeType !== 'tournament' || !grant.tournament) return false
    if (input.target.scopeType === 'all') return false
    if (input.target.scopeType === 'tournament') return input.target.tournament === grant.tournament
    return input.target.scopeType === 'division' && input.target.tournament === grant.tournament
  })
}

export function dashboardAccess(input: { fullAdmin: boolean; grants: AccessGrant[] }): {
  allowed: boolean
  fullAdmin: boolean
  manage: boolean
  setup: boolean
  broadcasts: boolean
  scopes: AccessGrant[]
} {
  const scopes = input.grants.filter((grant) => grant.status === 'active')
  const fullAdmin = input.fullAdmin || scopes.some(isFullAdminGrant)
  const manage = fullAdmin || scopes.some((grant) => grant.scopeType === 'tournament' && grant.role === 'admin' && Boolean(grant.tournament))
  const setup = fullAdmin || scopes.some((grant) => grant.role === 'admin')
  return {
    allowed: fullAdmin || scopes.length > 0,
    fullAdmin,
    manage,
    setup,
    broadcasts: setup,
    scopes,
  }
}

export function scopeLabel(scope: {
  scopeType: ScopeType
  tournament: string | null
  division: string | null
  role: AccessRole
}): string {
  const role = scope.role === 'admin' ? 'Admin' : 'Operator'
  if (scope.scopeType === 'all') return `All tournaments · ${role}`
  if (scope.scopeType === 'tournament') return `${scope.tournament} · ${role}`
  const where = scope.tournament ? `${scope.division} in ${scope.tournament}` : `${scope.division} in every tournament`
  return `${where} · ${role}`
}

export function invitePlan(
  existingUser: boolean,
  smtp: 'ready' | 'unset' | 'invalid',
): 'grant' | 'smtp' | 'builtin' | 'link' {
  if (existingUser) return 'grant'
  if (smtp === 'ready') return 'smtp'
  if (smtp === 'unset') return 'builtin'
  return 'link'
}

export function grantResponse(input: {
  grantStatus: 'active' | 'pending'
  emailed: boolean
  inviteLink: string | null
  warning: string | null
}): { httpStatus: number; body: Record<string, unknown> } {
  if (!input.emailed && !input.inviteLink && input.grantStatus !== 'active') {
    return {
      httpStatus: 502,
      body: {
        error: input.warning || 'The grant is saved, but the invite email did not send and no sign-in link could be created. Press Resend.',
      },
    }
  }
  const body: Record<string, unknown> = {
    ok: true,
    status: input.grantStatus,
    emailed: input.emailed,
    inviteLink: input.inviteLink,
  }
  if (input.warning) body.warning = input.warning
  return { httpStatus: 200, body }
}

export function broadcastsInScope<T extends { id: string }>(
  caller: { admin: boolean; scopes?: AccessGrant[] },
  broadcasts: T[],
  streams: { videoId: string; tournament?: string | null; division?: string | null }[],
): T[] {
  if (caller.admin) return broadcasts
  const allowed = new Set<string>()
  for (const stream of streams) {
    if (streamAllowed(caller.scopes ?? [], stream)) allowed.add(stream.videoId)
  }
  return broadcasts.filter((row) => allowed.has(row.id))
}

export function redactSecrets(value: string, secrets: string[]): string {
  let out = value
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]')
  }
  return out
}
