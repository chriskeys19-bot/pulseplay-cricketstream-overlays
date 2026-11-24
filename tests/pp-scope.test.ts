import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { authorizeBroadcast } from '../supabase/functions/_shared/pp_access.ts'
import {
  broadcastsInScope,
  canManageTarget,
  dashboardAccess,
  grantCoversStream,
  grantResponse,
  invitePlan,
  normalizeScope,
  redactSecrets,
  streamAllowed,
  tournamentChoices,
} from '../supabase/functions/_shared/pp_scope.ts'
import { classifyPulsePlayCaller } from '../supabase/functions/_shared/pp_access.ts'

const PSD_U11 = { id: 'psd-u11', videoId: 'psdVideo111', division: 'U11', tournament: 'PSD' }
const PSD_U13 = { id: 'psd-u13', videoId: 'psdVideo222', division: 'U13', tournament: 'PSD' }
const NYCT_U11 = { id: 'nyct-u11', videoId: 'nyctVideo11', division: 'U11', tournament: 'NYCT' }

const tournamentAdmin = {
  admin: false as const,
  active: true,
  divisions: [] as string[],
  scopes: [{ scopeType: 'tournament' as const, tournament: 'PSD', division: null, role: 'admin' as const, status: 'active' as const }],
}

const ageOperator = {
  admin: false as const,
  active: true,
  divisions: [] as string[],
  scopes: [{ scopeType: 'division' as const, tournament: 'PSD', division: 'U11', role: 'operator' as const, status: 'active' as const }],
}

test('a full admin grant covers every stream and a revoked grant covers none', () => {
  const all = { scopeType: 'all' as const, tournament: null, division: null, role: 'operator' as const, status: 'active' as const }
  assert.equal(grantCoversStream(all, PSD_U11), true)
  assert.equal(grantCoversStream(all, NYCT_U11), true)
  assert.equal(grantCoversStream({ ...all, status: 'revoked' }, PSD_U11), false)
  assert.equal(streamAllowed([all], { tournament: 'Friendly', division: 'U19' }), true)
})

test('a tournament admin can start every division in that tournament only', () => {
  const inside = authorizeBroadcast({ caller: tournamentAdmin, action: 'start', requestedId: PSD_U13.id, rows: [PSD_U13, NYCT_U11] })
  assert.equal(inside.ok, true)
  if (inside.ok) assert.equal(inside.videoId, PSD_U13.videoId)
  const outside = authorizeBroadcast({ caller: tournamentAdmin, action: 'end', requestedId: NYCT_U11.videoId, rows: [NYCT_U11] })
  assert.equal(outside.ok, false)
  if (!outside.ok) assert.equal(outside.status, 403)
  const list = authorizeBroadcast({ caller: tournamentAdmin, action: 'list', requestedId: '', rows: [] })
  assert.equal(list.ok, true)
  const testConn = authorizeBroadcast({ caller: tournamentAdmin, action: 'test', requestedId: '', rows: [] })
  assert.equal(testConn.ok, false)
})

test('an age-group operator is limited to that division and tournament', () => {
  const own = authorizeBroadcast({ caller: ageOperator, action: 'start', requestedId: PSD_U11.videoId, rows: [PSD_U11] })
  assert.equal(own.ok, true)
  const otherDivision = authorizeBroadcast({ caller: ageOperator, action: 'start', requestedId: PSD_U13.id, rows: [PSD_U13] })
  assert.equal(otherDivision.ok, false)
  const otherTournament = authorizeBroadcast({ caller: ageOperator, action: 'end', requestedId: NYCT_U11.id, rows: [NYCT_U11] })
  assert.equal(otherTournament.ok, false)
  const list = authorizeBroadcast({ caller: ageOperator, action: 'list', requestedId: '', rows: [] })
  assert.equal(list.ok, false)
  if (!list.ok) assert.match(list.error, /own division/)
})

test('an age-group operator with no tournament covers that age group everywhere', () => {
  const caller = {
    admin: false as const,
    active: true,
    divisions: [] as string[],
    scopes: [{ scopeType: 'division' as const, tournament: null, division: 'U11', role: 'operator' as const, status: 'active' as const }],
  }
  assert.equal(authorizeBroadcast({ caller, action: 'start', requestedId: PSD_U11.id, rows: [PSD_U11] }).ok, true)
  assert.equal(authorizeBroadcast({ caller, action: 'start', requestedId: NYCT_U11.id, rows: [NYCT_U11] }).ok, true)
  assert.equal(authorizeBroadcast({ caller, action: 'end', requestedId: PSD_U13.id, rows: [PSD_U13] }).ok, false)
})

test('a scoped list only keeps broadcasts for covered streams', () => {
  const broadcasts = [{ id: 'psdVideo111' }, { id: 'psdVideo222' }, { id: 'nyctVideo11' }, { id: 'looseVideo1' }]
  const visible = broadcastsInScope(ageOperator, broadcasts, [PSD_U11, PSD_U13, NYCT_U11])
  assert.deepEqual(visible.map((row) => row.id), ['psdVideo111'])
  const all = broadcastsInScope({ admin: true }, broadcasts, [])
  assert.equal(all.length, 4)
})

test('only a full admin or a tournament admin can grant inside that tournament', () => {
  const grants = tournamentAdmin.scopes
  assert.equal(canManageTarget({
    fullAdmin: false,
    grants,
    target: { scopeType: 'division', tournament: 'PSD', division: 'U15' },
  }), true)
  assert.equal(canManageTarget({
    fullAdmin: false,
    grants,
    target: { scopeType: 'tournament', tournament: 'PSD', division: null },
  }), true)
  assert.equal(canManageTarget({
    fullAdmin: false,
    grants,
    target: { scopeType: 'tournament', tournament: 'NYCT', division: null },
  }), false)
  assert.equal(canManageTarget({
    fullAdmin: false,
    grants,
    target: { scopeType: 'all', tournament: null, division: null },
  }), false)
  assert.equal(canManageTarget({
    fullAdmin: false,
    grants,
    target: { scopeType: 'division', tournament: null, division: 'U11' },
  }), false)
  assert.equal(canManageTarget({
    fullAdmin: true,
    grants: [],
    target: { scopeType: 'all', tournament: null, division: null },
  }), true)
  assert.equal(canManageTarget({ fullAdmin: false, grants: ageOperator.scopes, target: { scopeType: 'division', tournament: 'PSD', division: 'U11' } }), false)
})

test('scope normalization accepts all, one tournament, and an age group', () => {
  const all = normalizeScope({ scopeType: 'all', tournament: 'PSD', division: 'U11', role: 'admin', tournaments: ['PSD', 'NYCT'] })
  assert.equal(all.ok, true)
  if (all.ok) assert.deepEqual(all.scope, { scopeType: 'all', tournament: null, division: null, role: 'admin' })
  const tournament = normalizeScope({ scopeType: 'tournament', tournament: 'nyct', division: '', role: 'admin', tournaments: ['NYCT', 'PSD'] })
  assert.equal(tournament.ok, true)
  if (tournament.ok) assert.equal(tournament.scope.tournament, 'NYCT')
  const age = normalizeScope({ scopeType: 'division', tournament: '', division: 'u17', role: 'operator' })
  assert.equal(age.ok, true)
  if (age.ok) assert.deepEqual(age.scope, { scopeType: 'division', tournament: null, division: 'U17', role: 'operator' })
  assert.equal(normalizeScope({ scopeType: 'division', tournament: '', division: 'U21', role: 'operator' }).ok, false)
  assert.equal(normalizeScope({ scopeType: 'tournament', tournament: 'CLUB', division: '', role: 'admin', tournaments: ['PSD'] }).ok, false)
  assert.deepEqual(tournamentChoices(['amlca', 'not a code', 'CPL']), ['AMLCA', 'CPL', 'NCCA', 'NYCT', 'PSD'])
})

test('dashboard access follows the widest active grant', () => {
  const full = dashboardAccess({
    fullAdmin: false,
    grants: [{ scopeType: 'all', tournament: null, division: null, role: 'admin', status: 'active' }],
  })
  assert.equal(full.fullAdmin, true)
  assert.equal(full.manage, true)
  const tournament = dashboardAccess({ fullAdmin: false, grants: tournamentAdmin.scopes })
  assert.equal(tournament.fullAdmin, false)
  assert.equal(tournament.manage, true)
  assert.equal(tournament.setup, true)
  const operator = dashboardAccess({ fullAdmin: false, grants: ageOperator.scopes })
  assert.equal(operator.manage, false)
  assert.equal(operator.setup, false)
  assert.equal(operator.broadcasts, false)
  assert.equal(operator.allowed, true)
  const pending = dashboardAccess({
    fullAdmin: false,
    grants: [{ ...ageOperator.scopes[0], status: 'pending' }],
  })
  assert.equal(pending.allowed, false)
})

test('an existing account is granted without mail, and a failed send still returns a link', () => {
  assert.equal(invitePlan(true, 'unset'), 'grant')
  assert.equal(invitePlan(false, 'ready'), 'smtp')
  assert.equal(invitePlan(false, 'unset'), 'builtin')
  assert.equal(invitePlan(false, 'invalid'), 'link')
  const failed = grantResponse({
    grantStatus: 'pending',
    emailed: false,
    inviteLink: 'https://chriskeys19-bot.github.io/pulseplay-cricketstream-overlays/admin.html?token_hash=abc',
    warning: 'The grant is saved, but the email did not send. Copy the invite link or press Resend.',
  })
  assert.equal(failed.httpStatus, 200)
  assert.equal(failed.body.inviteLink?.toString().includes('token_hash=abc'), true)
  assert.equal(JSON.stringify(failed.body).includes('app-pass'), false)
  const secret = 'app-pass-value'
  assert.equal(redactSecrets(`auth failed ${secret}`, [secret]).includes(secret), false)
  const missing = grantResponse({ grantStatus: 'pending', emailed: false, inviteLink: null, warning: null })
  assert.equal(missing.httpStatus, 502)
})

test('active scope grants classify the caller, and a pending invite does not', () => {
  const base = {
    profileRole: 'player',
    accessStatus: 'pending',
    userId: '11111111-1111-1111-1111-111111111111',
    email: 'coach@example.com',
    emailConfirmedAt: '2026-11-01T00:00:00Z',
    admins: [],
    operator: null,
  }
  assert.equal(classifyPulsePlayCaller({
    ...base,
    grants: [{ scopeType: 'all', tournament: null, division: null, role: 'admin', status: 'active' }],
  }).kind, 'admin')
  const scoped = classifyPulsePlayCaller({ ...base, grants: tournamentAdmin.scopes })
  assert.equal(scoped.kind, 'scoped')
  assert.equal(classifyPulsePlayCaller({
    ...base,
    grants: [{ ...ageOperator.scopes[0], status: 'pending' }],
  }).kind, 'invited')
  assert.equal(classifyPulsePlayCaller({
    ...base,
    operator: { active: true, divisions: ['U11'] },
  }).kind, 'operator')
})

test('the grants migration stays inside Pulse Play and keeps pp_admins', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261124180000_pp_access_grants.sql', import.meta.url), 'utf8')
  assert.match(sql, /create table if not exists public\.pp_access_grants/)
  assert.match(sql, /scope_type in \('all', 'tournament', 'division'\)/)
  assert.match(sql, /from public\.pp_admins/)
  assert.match(sql, /private\.pp_can_manage_grant/)
  assert.match(sql, /pp_grounds_select_anon/)
  assert.match(sql, /enable row level security/)
  assert.equal(/update\s+public\.profiles/i.test(sql), false)
  assert.equal(/insert\s+into\s+public\.profiles/i.test(sql), false)
  assert.equal(/club_|public\.teams|public\.invites/.test(sql), false)
  assert.match(sql, /grant execute on function public\.pp_auth_user_by_email\(text\) to service_role/)
  assert.match(sql, /revoke all on function public\.pp_auth_user_by_email\(text\) from authenticated/)
})
