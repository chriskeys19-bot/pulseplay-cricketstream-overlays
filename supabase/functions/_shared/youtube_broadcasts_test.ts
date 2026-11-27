import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALREADY_ENDED,
  ENCODER_NOT_READY,
  NOT_LIVE_YET,
  RECONNECT_MESSAGE,
  executeEnd,
  executeStart,
  parseBroadcastItem,
  parseStreamLabels,
  planEnd,
  planStart,
  publicConnection,
  broadcastByIdUrl,
  broadcastByIdsUrl,
  broadcastListUrl,
  cleanBroadcastIds,
  listChannelBroadcasts,
  readBroadcastHealth,
  readGoogleFailure,
  syncPlan,
  toClientBroadcast,
  watchUrl,
  type ParsedBroadcast,
  type YoutubeCaller,
} from './youtube_broadcasts.ts'

const ID = 'abcdefghijk'
const STREAM = 'streamKeyId123'

function broadcast(lifeCycle: string, bound = STREAM): ParsedBroadcast {
  return {
    id: ID,
    title: 'Pulse Play vs Hawks',
    scheduledStart: '2026-11-26T18:00:00.000Z',
    actualStart: null,
    actualEnd: null,
    lifeCycle,
    boundStreamId: bound,
  }
}

function apiBroadcast(lifeCycle: string, id = ID) {
  return {
    id,
    snippet: { title: 'Pulse Play vs Hawks', scheduledStartTime: '2026-11-26T18:00:00Z' },
    status: { lifeCycleStatus: lifeCycle },
    contentDetails: { boundStreamId: STREAM },
  }
}

function caller(routes: (url: string, method: string) => { status: number; json: unknown }): YoutubeCaller {
  return (input) => Promise.resolve(routes(input.url, input.method))
}

test('start goes testing then live only when YouTube is receiving video', () => {
  assert.equal(planStart({ lifeCycle: 'ready', ingest: 'inactive', bound: true }).kind, 'error')
  assert.equal(planStart({ lifeCycle: 'ready', ingest: null, bound: true }).kind, 'error')
  assert.equal(planStart({ lifeCycle: 'ready', ingest: 'active', bound: false }).kind, 'error')
  const ready = planStart({ lifeCycle: 'ready', ingest: 'active', bound: true })
  assert.deepEqual(ready, { kind: 'transition', steps: ['testing', 'live'] })
  assert.deepEqual(planStart({ lifeCycle: 'testing', ingest: 'active', bound: true }), {
    kind: 'transition',
    steps: ['live'],
  })
  assert.equal(planStart({ lifeCycle: 'testStarting', ingest: 'active', bound: true }).kind, 'wait')
  assert.equal(planStart({ lifeCycle: 'live', ingest: 'active', bound: true }).kind, 'done')
  assert.equal(planStart({ lifeCycle: 'complete', ingest: 'active', bound: true }).kind, 'error')
  assert.equal(planStart({ lifeCycle: 'created', ingest: 'active', bound: true }).kind, 'error')
})

test('end completes a live broadcast and refuses one that never started', () => {
  assert.equal(planEnd('live').kind, 'transition')
  assert.equal(planEnd('testing').kind, 'transition')
  assert.equal(planEnd('complete').kind, 'done')
  const upcoming = planEnd('ready')
  assert.equal(upcoming.kind, 'error')
  if (upcoming.kind === 'error') assert.equal(upcoming.message, NOT_LIVE_YET)
})

test('inactive stream and revoked token become readable errors', () => {
  const inactive = readGoogleFailure(403, {
    error: { code: 403, message: 'Stream is inactive', errors: [{ reason: 'errorStreamInactive', message: 'inactive' }] },
  })
  assert.equal(inactive?.message, ENCODER_NOT_READY)
  assert.equal(inactive?.reason, 'errorStreamInactive')
  const revoked = readGoogleFailure(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
  assert.equal(revoked?.message, RECONNECT_MESSAGE)
  assert.equal(revoked ? true : false, true)
  const transition = readGoogleFailure(403, { error: { errors: [{ reason: 'invalidTransition' }] } })
  assert.match(transition?.message ?? '', /would not change/i)
})

test('executeStart transitions ready to testing and then live', async () => {
  const calls: string[] = []
  const result = await executeStart(
    ID,
    caller((url, method) => {
      calls.push(`${method} ${url.includes('/transition') ? url.split('broadcastStatus=')[1] : 'read'}`)
      if (url.includes('/liveStreams')) return { status: 200, json: { items: [{ id: STREAM, status: { streamStatus: 'active' } }] } }
      if (url.includes('broadcastStatus=testing')) return { status: 200, json: apiBroadcast('testing') }
      if (url.includes('broadcastStatus=live')) return { status: 200, json: apiBroadcast('live') }
      return { status: 200, json: { items: [apiBroadcast('ready')] } }
    }),
    'ya29.access-token-value',
    { timeoutMs: 0, sleep: () => Promise.resolve() },
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.phase, 'live')
    assert.equal(result.lifeCycle, 'live')
  }
  assert.ok(calls.some((call) => call.startsWith('POST testing')))
  assert.ok(calls.some((call) => call.startsWith('POST live')))
})

test('executeStart stops when the encoder is not sending video', async () => {
  const calls: string[] = []
  const result = await executeStart(
    ID,
    caller((url, method) => {
      calls.push(method)
      if (url.includes('/liveStreams')) {
        return { status: 200, json: { items: [{ id: STREAM, status: { streamStatus: 'inactive' } }] } }
      }
      return { status: 200, json: { items: [apiBroadcast('ready')] } }
    }),
    'ya29.access-token-value',
    { timeoutMs: 0, sleep: () => Promise.resolve() },
  )
  assert.deepEqual(result, { ok: false, message: ENCODER_NOT_READY, reconnect: false })
  assert.equal(calls.includes('POST'), false)
})

test('executeStart tries live when testing is not allowed', async () => {
  const result = await executeStart(
    ID,
    caller((url) => {
      if (url.includes('/liveStreams')) return { status: 200, json: { items: [{ id: STREAM, status: { streamStatus: 'active' } }] } }
      if (url.includes('broadcastStatus=testing')) {
        return { status: 403, json: { error: { errors: [{ reason: 'invalidTransition' }] } } }
      }
      if (url.includes('broadcastStatus=live')) return { status: 200, json: apiBroadcast('live') }
      return { status: 200, json: { items: [apiBroadcast('ready')] } }
    }),
    'ya29.access-token-value',
    { timeoutMs: 0, sleep: () => Promise.resolve() },
  )
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.lifeCycle, 'live')
})

test('executeEnd confirms complete and does not claim success early', async () => {
  const ended = await executeEnd(
    ID,
    caller((url) => {
      if (url.includes('broadcastStatus=complete')) return { status: 200, json: apiBroadcast('complete') }
      return { status: 200, json: { items: [apiBroadcast('live')] } }
    }),
    'ya29.access-token-value',
    { timeoutMs: 0, sleep: () => Promise.resolve() },
  )
  assert.equal(ended.ok, true)
  if (ended.ok) assert.equal(ended.phase, 'complete')

  const early = await executeEnd(
    ID,
    caller(() => ({ status: 200, json: { items: [apiBroadcast('ready')] } })),
    'ya29.access-token-value',
    { timeoutMs: 0, sleep: () => Promise.resolve() },
  )
  assert.equal(early.ok, false)
  if (!early.ok) assert.equal(early.message, NOT_LIVE_YET)
})

test('a matched stream is marked ended only after YouTube complete', () => {
  assert.deepEqual(syncPlan({ phase: 'complete', status: 'ready', openJob: null }), {
    nextStatus: 'ended',
    confirmEnd: true,
  })
  assert.deepEqual(syncPlan({ phase: 'complete', status: 'ended', openJob: { action: 'end', status: 'pending' } }), {
    nextStatus: 'ended',
    confirmEnd: true,
  })
  assert.deepEqual(syncPlan({ phase: 'live', status: 'ended', openJob: null }), {
    nextStatus: 'ready',
    confirmEnd: false,
  })
  assert.deepEqual(syncPlan({ phase: 'live', status: 'awaiting_scorecard', openJob: null }), {
    nextStatus: null,
    confirmEnd: false,
  })
  assert.deepEqual(
    syncPlan({ phase: 'live', status: 'ready', openJob: { action: 'add_scorecard', status: 'running' } }),
    { nextStatus: null, confirmEnd: false },
  )
})

test('client broadcasts expose the watch URL and never a stream secret', () => {
  assert.equal(watchUrl(ID), 'https://www.youtube.com/watch?v=abcdefghijk')
  assert.equal(watchUrl('bad id'), null)
  const row = toClientBroadcast(broadcast('ready'), null, 'abcdabcdabcdabcdabcd')
  assert.equal(row?.streamKeyName, null)
  assert.equal(row?.watchUrl, 'https://www.youtube.com/watch?v=abcdefghijk')
  const named = toClientBroadcast(broadcast('ready'), 'PSD Key 1', 'Default stream key')
  assert.equal(named?.streamKeyName, 'PSD Key 1')
  const parsed = parseBroadcastItem({
    id: ID,
    snippet: { title: 'Pulse Play', scheduledStartTime: '2026-11-26T18:00:00Z' },
    status: { lifeCycleStatus: 'ready' },
    contentDetails: { boundStreamId: STREAM },
    cdn: { ingestionInfo: { streamName: 'super-secret-key' } },
  })
  assert.equal(JSON.stringify(parsed).includes('super-secret-key'), false)
  const labels = parseStreamLabels({
    items: [{ id: STREAM, snippet: { title: 'Yolobox Pro 1' }, status: { streamStatus: 'active' }, cdn: { ingestionInfo: { streamName: 'secret' } } }],
  })
  assert.equal(labels.get(STREAM)?.title, 'Yolobox Pro 1')
  assert.equal(JSON.stringify([...labels.values()]).includes('secret'), false)
})

test('list URLs use one YouTube filter and never mine', () => {
  const urls = [
    broadcastListUrl('upcoming'),
    broadcastListUrl('completed', 'next-page'),
    broadcastListUrl('all'),
    broadcastByIdUrl(ID),
  ]
  for (const url of urls) assert.equal(url.includes('mine='), false)
  assert.equal(new URL(urls[0]).searchParams.get('broadcastStatus'), 'upcoming')
  assert.equal(new URL(urls[1]).searchParams.get('broadcastStatus'), 'completed')
  assert.equal(new URL(urls[1]).searchParams.get('pageToken'), 'next-page')
  assert.equal(new URL(urls[2]).searchParams.get('broadcastStatus'), 'all')
  assert.equal(new URL(urls[3]).searchParams.get('id'), ID)
  assert.equal(new URL(urls[3]).searchParams.get('broadcastStatus'), null)
})

test('list errors are readable and update errors stay distinct', () => {
  const quota = 'YouTube quota is used up for now. Wait a few minutes, then try again.'
  const reasons = ['incompatibleParameters', 'invalidFilters', 'unexpectedParameter', 'missingRequiredParameter']
  for (const reason of reasons) {
    const body = { error: { errors: [{ reason }] } }
    assert.equal(readGoogleFailure(400, body, 'list')?.message, 'YouTube rejected the broadcast list request. Try again.')
    assert.equal(readGoogleFailure(400, body)?.message, 'YouTube rejected that request. Refresh the list and try again.')
  }
  for (const reason of ['liveStreamingNotEnabled', 'insufficientLivePermissions', 'livePermissionBlocked']) {
    assert.equal(
      readGoogleFailure(403, { error: { errors: [{ reason }] } }, 'list')?.message,
      'Enable live streaming on this YouTube channel, then try again.',
    )
  }
  assert.equal(
    readGoogleFailure(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }, 'list')?.message,
    'The YouTube Data API is not enabled for this project. An admin needs to turn it on, then try again.',
  )
  assert.equal(readGoogleFailure(403, { error: { errors: [{ reason: 'dailyLimitExceeded' }] } }, 'list')?.message, quota)
  assert.equal(readGoogleFailure(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } })?.message, quota)
  assert.equal(
    readGoogleFailure(500, { error: { errors: [{ reason: 'backendError' }] } }, 'list')?.message,
    'YouTube could not load the broadcast list. Try again.',
  )
  assert.equal(
    readGoogleFailure(500, { error: { errors: [{ reason: 'backendError' }] } })?.message,
    'YouTube could not update this broadcast. Refresh the list and try again.',
  )
})

test('listChannelBroadcasts loads upcoming, active, and completed without mine', async () => {
  const urls: string[] = []
  const result = await listChannelBroadcasts(
    caller((url) => {
      urls.push(url)
      const status = new URL(url).searchParams.get('broadcastStatus')
      const life = status === 'active' ? 'live' : status === 'completed' ? 'complete' : 'ready'
      return { status: 200, json: { items: [apiBroadcast(life, `broadcast-${status}`)] } }
    }),
    'ya29.access-token-value',
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.rows.map((row) => row.id), ['broadcast-upcoming', 'broadcast-active', 'broadcast-completed'])
  }
  assert.deepEqual(urls.map((url) => new URL(url).searchParams.get('broadcastStatus')), ['upcoming', 'active', 'completed'])
  assert.ok(urls.every((url) => !url.includes('mine=')))
})

test('a rejected list page returns the list error and does not ask to reconnect', async () => {
  const result = await listChannelBroadcasts(
    caller(() => ({ status: 400, json: { error: { errors: [{ reason: 'incompatibleParameters' }] } } })),
    'ya29.access-token-value',
  )
  assert.deepEqual(result, {
    ok: false,
    message: 'YouTube rejected the broadcast list request. Try again.',
    reconnect: false,
  })
})

test('connection status for the browser omits the refresh token', () => {
  const shown = publicConnection({
    channelId: 'UCcheetahs',
    channelTitle: 'CricketCrazeUSA',
    connectedAt: '2026-11-22T12:00:00.000Z',
    tokenError: 'expired',
    refreshToken: '1//do-not-send',
  })
  assert.equal(shown.needsReconnect, true)
  assert.equal(shown.message, RECONNECT_MESSAGE)
  assert.equal(JSON.stringify(shown).includes('1//'), false)
  assert.equal(JSON.stringify(shown).includes('refreshToken'), false)
  const ended = planEnd('complete')
  if (ended.kind === 'done') assert.match(ended.message, /already ended/)
  assert.equal(ALREADY_ENDED.length > 0, true)
})

test('health reads streamStatus and healthStatus without the ingest secret', async () => {
  assert.deepEqual(cleanBroadcastIds(['abcdefghijk', 'bad', 'abcdefghijk', 'secondVideo1']), ['abcdefghijk', 'secondVideo1'])
  const url = broadcastByIdsUrl(['abcdefghijk'])
  assert.equal(new URL(url).searchParams.get('id'), 'abcdefghijk')
  assert.equal(url.includes('mine='), false)
  assert.equal(new URL(url).searchParams.get('broadcastStatus'), null)
  const calls: string[] = []
  const result = await readBroadcastHealth(
    ['abcdefghijk', 'missingVideo1'],
    caller((hit) => {
      calls.push(hit)
      if (hit.includes('/liveStreams')) {
        return {
          status: 200,
          json: {
            items: [{
              id: STREAM,
              snippet: { title: 'Yolobox Pro 1' },
              status: {
                streamStatus: 'active',
                healthStatus: {
                  status: 'noData',
                  configurationIssues: [{
                    severity: 'error',
                    reason: 'noData',
                    description: 'YouTube is not receiving data.',
                  }],
                },
              },
              cdn: { ingestionInfo: { streamName: 'super-secret-key' } },
            }],
          },
        }
      }
      return { status: 200, json: { items: [apiBroadcast('live')] } }
    }),
    'ya29.access-token-value',
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.rows[0]?.lifeCycle, 'live')
    assert.equal(result.rows[0]?.streamStatus, 'active')
    assert.equal(result.rows[0]?.healthStatus, 'noData')
    assert.equal(result.rows[0]?.issues[0]?.description, 'YouTube is not receiving data.')
    assert.equal(result.rows[1]?.lifeCycle, null)
    assert.equal(JSON.stringify(result.rows).includes('super-secret-key'), false)
  }
  assert.equal(calls.length, 2)
})
