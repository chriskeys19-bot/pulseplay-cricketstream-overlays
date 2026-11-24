import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyPulsePlayCaller, type PpAdminRecord } from '../supabase/functions/_shared/pp_access.ts'

const EMAIL = 'cricketforcubs@gmail.com'
const USER = '11111111-1111-1111-1111-111111111111'

function decide(overrides: {
  profileRole?: string | null
  accessStatus?: string | null
  userId?: string
  email?: string | null
  emailConfirmedAt?: string | null
  admins?: PpAdminRecord[]
  operator?: { active: boolean; divisions: string[] } | null
}) {
  return classifyPulsePlayCaller({
    profileRole: overrides.profileRole ?? 'player',
    accessStatus: overrides.accessStatus ?? 'pending',
    userId: overrides.userId ?? USER,
    email: overrides.email === undefined ? EMAIL : overrides.email,
    emailConfirmedAt: overrides.emailConfirmedAt === undefined ? '2026-11-01T00:00:00Z' : overrides.emailConfirmedAt,
    admins: overrides.admins ?? [],
    operator: overrides.operator ?? null,
  })
}

test('an active pp_admins row matched by user id is a full Pulse Play admin', () => {
  const decision = decide({
    emailConfirmedAt: null,
    admins: [{ userId: USER, email: EMAIL, active: true }],
  })
  assert.deepEqual(decision, { kind: 'admin' })
})

test('a verified email match is admin and an unconfirmed email is not', () => {
  const row = { userId: null, email: EMAIL, active: true }
  assert.deepEqual(decide({ admins: [row] }).kind, 'admin')
  assert.deepEqual(decide({ admins: [row], emailConfirmedAt: null }).kind, 'none')
  assert.deepEqual(decide({ admins: [{ userId: null, email: 'other@example.com', active: true }] }).kind, 'none')
})

test('an inactive pp_admins row is rejected', () => {
  assert.deepEqual(
    decide({ admins: [{ userId: USER, email: EMAIL, active: false }] }).kind,
    'none',
  )
})

test('a division operator stays an operator and a club admin stays an admin', () => {
  assert.deepEqual(
    decide({ operator: { active: true, divisions: ['U11'] }, accessStatus: 'active' }),
    { kind: 'operator', divisions: ['U11'] },
  )
  assert.deepEqual(decide({ profileRole: 'admin', accessStatus: 'active' }).kind, 'admin')
  assert.deepEqual(decide({ profileRole: 'admin', accessStatus: 'pending' }).kind, 'pending')
  assert.deepEqual(
    decide({
      profileRole: 'admin',
      accessStatus: 'pending',
      admins: [{ userId: USER, email: EMAIL, active: true }],
    }).kind,
    'admin',
  )
})

test('the migration seeds the Pulse Play admin and does not change club profiles', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261124070000_pp_admins.sql', import.meta.url), 'utf8')
  assert.match(sql, /cricketforcubs@gmail.com/)
  assert.match(sql, /on conflict \(email\) do update/)
  assert.match(sql, /private\.is_pp_admin/)
  assert.equal(/update\s+public\.profiles/i.test(sql), false)
  assert.equal(sql.includes('pulseplay-assets'), true)
  assert.equal(/club_|public\.teams|public\.invites/.test(sql), false)
})
