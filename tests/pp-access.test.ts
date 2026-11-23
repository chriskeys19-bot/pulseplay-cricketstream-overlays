import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ADMIN_PAGE,
  authorizeBroadcast,
  cleanDivisions,
  divisionPhrase,
  inviteLetter,
  mergeDivisions,
  normalizeEmail,
  operatorSignInUrl,
  smtpFailure,
  smtpReady,
} from '../supabase/functions/_shared/pp_access.ts'

const U11 = { id: 'psd-20261126-stanford-0830', videoId: 'OTsKq9Bejrc', division: 'U11' }
const U13 = { id: 'psd-20261126-ctswest-0830', videoId: 'gaT6eixbK2o', division: 'U13' }
const operator = { admin: false as const, active: true, divisions: ['U11'] }

test('an operator can start and end only a stream in their division', () => {
  const start = authorizeBroadcast({ caller: operator, action: 'start', requestedId: U11.id, rows: [U11] })
  assert.equal(start.ok, true)
  if (start.ok) assert.equal(start.videoId, U11.videoId)
  const end = authorizeBroadcast({ caller: operator, action: 'end', requestedId: U11.videoId, rows: [U11] })
  assert.equal(end.ok, true)
  if (end.ok) assert.equal(end.videoId, U11.videoId)
})

test('an operator cannot start another division, a missing stream, or the full list', () => {
  const other = authorizeBroadcast({ caller: operator, action: 'start', requestedId: U13.videoId, rows: [U13] })
  assert.equal(other.ok, false)
  if (!other.ok) assert.equal(other.status, 403)
  const missing = authorizeBroadcast({ caller: operator, action: 'end', requestedId: 'abcdefghijk', rows: [] })
  assert.equal(missing.ok, false)
  const list = authorizeBroadcast({ caller: operator, action: 'list', requestedId: '', rows: [] })
  assert.equal(list.ok, false)
  if (!list.ok) assert.match(list.error, /own division/)
  const shared = authorizeBroadcast({
    caller: operator,
    action: 'start',
    requestedId: 'sharedvideo1',
    rows: [
      { id: 'a-stream', videoId: 'sharedvideo1', division: 'U11' },
      { id: 'b-stream', videoId: 'sharedvideo1', division: 'U13' },
    ],
  })
  assert.equal(shared.ok, false)
})

test('a revoked operator and an empty division list are refused', () => {
  const revoked = authorizeBroadcast({
    caller: { admin: false, active: false, divisions: ['U11'] },
    action: 'start',
    requestedId: U11.id,
    rows: [U11],
  })
  assert.equal(revoked.ok, false)
  const empty = authorizeBroadcast({
    caller: { admin: false, active: true, divisions: [] },
    action: 'start',
    requestedId: U11.id,
    rows: [U11],
  })
  assert.equal(empty.ok, false)
})

test('an admin can start a stream id or a broadcast that is not in the table', () => {
  const fromStream = authorizeBroadcast({
    caller: { admin: true },
    action: 'start',
    requestedId: U11.id,
    rows: [U11, U13],
  })
  assert.equal(fromStream.ok, true)
  if (fromStream.ok) assert.equal(fromStream.videoId, U11.videoId)
  const loose = authorizeBroadcast({
    caller: { admin: true },
    action: 'end',
    requestedId: 'abcdefghijk',
    rows: [],
  })
  assert.equal(loose.ok, true)
  if (loose.ok) assert.equal(loose.videoId, 'abcdefghijk')
  const list = authorizeBroadcast({ caller: { admin: true }, action: 'list', requestedId: '', rows: [] })
  assert.equal(list.ok, true)
})

test('one person can hold more than one division', () => {
  const caller = { admin: false as const, active: true, divisions: mergeDivisions(['U9'], ['U11', 'U11']) }
  assert.deepEqual(caller.divisions, ['U9', 'U11'])
  const u9 = authorizeBroadcast({
    caller,
    action: 'start',
    requestedId: 'u9video1234',
    rows: [{ id: 'u9-game', videoId: 'u9video1234', division: 'U9' }],
  })
  assert.equal(u9.ok, true)
  assert.equal(cleanDivisions(['U17']), null)
  assert.equal(normalizeEmail('  Coach@Example.com '), 'coach@example.com')
})

test('the YouTube function checks access before it reads the connection', () => {
  const source = readFileSync(new URL('../supabase/functions/youtube-broadcasts/index.ts', import.meta.url), 'utf8')
  const check = source.indexOf('authorizeBroadcast(')
  const connection = source.indexOf("rpc('youtube_connection_read')")
  assert.ok(check > 0)
  assert.ok(connection > check)
})

test('the invite letter names the division and the GitHub Pages admin page', () => {
  const link = operatorSignInUrl('abcDEF1234567890_-token', 'magiclink')
  assert.ok(link)
  assert.equal(link.startsWith(ADMIN_PAGE + '?token_hash='), true)
  const letter = inviteLetter(['U13'], link)
  assert.ok(letter)
  assert.equal(letter.subject, 'Pulse Play streams for U13')
  assert.match(letter.text, /Ben invited you to run the Pulse Play streams for U13/)
  assert.match(letter.text, /github\.io/)
  assert.equal(inviteLetter(['U13'], 'https://example.com/phish'), null)
  assert.equal(divisionPhrase(['U9', 'U15']), 'U9 and U15')
  assert.equal(smtpFailure('', ''), 'Set PP_INVITE_SMTP_USER and PP_INVITE_SMTP_PASS, then resend.')
  assert.equal(smtpFailure('cheetahscc123@gmail.com', 'app-pass-value'), 'PP_INVITE_SMTP_USER must be cricketcrazeusa@gmail.com.')
  assert.equal(smtpFailure('cricketcrazeusa@gmail.com', 'short'), 'PP_INVITE_SMTP_PASS is missing or too short.')
  assert.equal(smtpFailure('cricketcrazeusa@gmail.com', 'app-pass-value'), null)
  assert.equal(smtpReady('cricketcrazeusa@gmail.com', 'app-pass-value'), true)
  const source = readFileSync(new URL('../supabase/functions/pp-access/index.ts', import.meta.url), 'utf8')
  assert.match(source, /PP_INVITE_SMTP_USER/)
  assert.match(source, /PP_INVITE_SMTP_PASS/)
  assert.equal(source.includes("get('INVITE_SMTP_"), false)
  assert.equal(source.includes('cheetahscc123'), false)
})
