/**
 * Logic checks for the session-bus plugin, run against the BUILT output.
 * No Harness runtime is needed: the plugin only touches ctx.agents /
 * ctx.sessions / ctx.sessionQuery / ctx.tools.
 *
 * Each `setup()` call is an isolated plugin instance: chain bookkeeping is
 * per-apply state, so topology behaviour must not be measured through a bus
 * that another section already advanced.
 */
import { apply } from '../lib/index.js'
import * as pkg from '../lib/index.js'

const signal = new AbortController().signal

async function setup(config = {}) {
  const live = new Map()
  const makeAgent = (id) => {
    const agent = { id, sent: [], send(message) { agent.sent.push(message) } }
    live.set(id, agent)
    return agent
  }
  const tools = new Map()
  const ctx = {
    agents: {
      get: (id) => live.get(String(id)),
      resume: async () => {
        throw new Error('resume must not be reached in these checks')
      },
    },
    // No delegation depth recorded: a top-level session.
    sessions: { get: () => undefined },
    sessionQuery: {
      listSessions: async () => {
        throw new Error('corpus unavailable')
      },
      readTitleSnapshots: async () => [],
      readSurface: async () => {
        throw new Error('no such session')
      },
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => {}
      },
    },
    effect(callback) {
      callback()
      return () => {}
    },
    logger: { warn() {} },
  }

  await apply(ctx, config)
  return {
    makeAgent,
    live,
    delivered: (id) => live.get(id)?.sent.length ?? 0,
    as: (id) => ({ agent: { id }, signal, callId: 'test' }),
    send: tools.get('session_send'),
    read: tools.get('session_read'),
    list: tools.get('session_list'),
  }
}

const results = []
const check = (label, ok, detail) => results.push({ label, ok: Boolean(ok), detail })

// ===================================================================
// Entry shape: the host loader unwraps `mod.default ?? mod` before
// ctx.plugin(), and cordis reads the inject map off whatever it gets.
// A default export therefore silently drops all injected services.
// ===================================================================
check('entry exports name/inject/apply', pkg.name === 'session-bus' && typeof pkg.apply === 'function', `name=${pkg.name} apply=${typeof pkg.apply}`)
check('inject map covers every service the plugin touches', Array.isArray(pkg.inject) && ['agents', 'sessions', 'sessionQuery', 'tools'].every((s) => pkg.inject.includes(s)), JSON.stringify(pkg.inject))
check('no default export (host would unwrap it and lose inject)', pkg.default === undefined, `default=${typeof pkg.default}`)

// ===================================================================
// Default topology (star): an origin may dispatch, a delegate may only
// report back to its origin.
// ===================================================================
const star = await setup({})

for (const id of ['root', 'w1', 'w2']) star.makeAgent(id)

const s1 = await star.send.execute({ target: 'w1', message: 'task' }, star.as('root'))
check('star: a session with no task of its own may dispatch', s1.status === 'queued' && s1.hop === 1, `status=${s1.status} hop=${s1.hop}`)

const s2 = await star.send.execute({ target: 'w2', message: 'relay' }, star.as('w1'))
check('star: a delegate may not hand its task to a third session', s2.status === 'not-chain-origin', `status=${s2.status}`)
check('star: a refused hand-off delivers nothing', star.delivered('w2') === 0, `w2 received ${star.delivered('w2')}`)

// The dispatched body tells a delegate to echo its correlation id, so a hand-off
// is usually attempted WITH the parent id — which must not bypass the gate.
const s2b = await star.send.execute({ target: 'w2', message: 'relay', correlationId: s1.correlationId }, star.as('w1'))
check('star: carrying the parent correlation does not bypass the gate', s2b.status === 'not-chain-origin', `status=${s2b.status}`)
check('star: a gate bypass delivers nothing either', star.delivered('w2') === 0, `w2 received ${star.delivered('w2')}`)

const s3 = await star.send.execute({ target: 'w1', message: 'relay again' }, star.as('root'))
check('star: an origin may fan out to several delegates', s3.status === 'queued' && s3.hop === 1, `status=${s3.status}`)

const s4 = await star.send.execute({ target: 'root', message: 'done', correlationId: s1.correlationId }, star.as('w1'))
check('star: a delegate may reply to its origin', s4.status === 'queued' && s4.hop === 1 && s4.correlationId === s1.correlationId, `status=${s4.status} hop=${s4.hop}`)

// ===================================================================
// Regression (v2 section A): replies must not ratchet the originator's
// chain depth.
// ===================================================================
const main = await setup({})
for (const id of ['main', 'wa', 'wb', 'wc']) main.makeAgent(id)

const first = await main.send.execute({ target: 'wa', message: 'do X' }, main.as('main'))
const reply = await main.send.execute({ target: 'main', message: 'X done', correlationId: first.correlationId }, main.as('wa'))
const second = await main.send.execute({ target: 'wb', message: 'do Y' }, main.as('main'))
const reply2 = await main.send.execute({ target: 'main', message: 'Y done', correlationId: second.correlationId }, main.as('wb'))
const third = await main.send.execute({ target: 'wc', message: 'do Z' }, main.as('main'))

check('first dispatch opens the chain at hop 1', first.hop === 1, `hop=${first.hop}`)
check('reply continues the chain at the same depth', reply.hop === 1 && reply.correlationId === first.correlationId, `hop=${reply.hop}`)
check('second independent dispatch is still hop 1', second.hop === 1, `hop=${second.hop}`)
check('second reply also stays at hop 1', reply2.hop === 1, `hop=${reply2.hop}`)
check('third dispatch is not poisoned by two round trips', third.status === 'queued' && third.hop === 1, `status=${third.status} hop=${third.hop}`)

// --- Self-target guard. ---
const self = await main.send.execute({ target: 'main', message: 'echo' }, main.as('main'))
check('self dispatch refused', self.status === 'self-target', self.status)

// ===================================================================
// topology: 'chain' — forwarding is allowed and every hand-off (with or
// without the received correlation id) deepens the chain, bounded by maxHops.
// ===================================================================
const chain = await setup({ topology: 'chain' })
for (const id of ['f0', 'f1', 'f2', 'f3', 'f4']) chain.makeAgent(id)

const h1 = await chain.send.execute({ target: 'f1', message: 'h1' }, chain.as('f0'))
const h2 = await chain.send.execute({ target: 'f2', message: 'h2' }, chain.as('f1'))
const h3 = await chain.send.execute({ target: 'f3', message: 'h3' }, chain.as('f2'))
const h4 = await chain.send.execute({ target: 'f4', message: 'h4' }, chain.as('f3'))

check('forwarding adds one hop per hand-off', h1.hop === 1 && h2.hop === 2 && h3.hop === 3, `h1=${h1.hop} h2=${h2.hop} h3=${h3.hop}`)
check('chain is refused past maxHops', h4.status === 'rejected-max-hops' && h4.hop === 4, `status=${h4.status} hop=${h4.hop}`)

// --- P0-1: a forward that carries the correlation it was given. ---
for (const id of ['g0', 'g1', 'g2']) chain.makeAgent(id)

const p1 = await chain.send.execute({ target: 'g1', message: 'p1' }, chain.as('g0'))
const p2 = await chain.send.execute({ target: 'g2', message: 'p2', correlationId: p1.correlationId }, chain.as('g1'))

check('forwarding with the received correlation still deepens the chain', p2.status === 'queued' && p2.hop === 2, `status=${p2.status} hop=${p2.hop}`)
check('a forward opens a child chain instead of reusing the parent id', p2.correlationId !== p1.correlationId, `child=${p2.correlationId} parent=${p1.correlationId}`)

const p3 = await chain.send.execute({ target: 'g1', message: 'p3', correlationId: p2.correlationId }, chain.as('g2'))
check('a reply continues the child chain at its own depth', p3.status === 'queued' && p3.hop === 2 && p3.correlationId === p2.correlationId, `status=${p3.status} hop=${p3.hop}`)

const p4 = await chain.send.execute({ target: 'g0', message: 'p4', correlationId: p1.correlationId }, chain.as('g1'))
check('a reply to the origin after a forward is still at the parent depth', p4.status === 'queued' && p4.hop === 1 && p4.correlationId === p1.correlationId, `status=${p4.status} hop=${p4.hop}`)

// ===================================================================
// P0-2: one delegate serving several masters — the reply must be filed
// against the chain that points at the session being addressed.
// ===================================================================
const fan = await setup({})
for (const id of ['m1', 'm2', 'w']) fan.makeAgent(id)

const cA = (await fan.send.execute({ target: 'w', message: 'from m1' }, fan.as('m1'))).correlationId
const cB = (await fan.send.execute({ target: 'w', message: 'from m2' }, fan.as('m2'))).correlationId

const toM1 = await fan.send.execute({ target: 'm1', message: 'm1 answer' }, fan.as('w'))
check('reply is filed against the chain of the session being addressed', toM1.status === 'queued' && toM1.hop === 1 && toM1.correlationId === cA, `status=${toM1.status} hop=${toM1.hop} cid=${toM1.correlationId}`)

const toM2 = await fan.send.execute({ target: 'm2', message: 'm2 answer' }, fan.as('w'))
check('the second master gets its own chain, not the first one', toM2.status === 'queued' && toM2.hop === 1 && toM2.correlationId === cB, `status=${toM2.status} hop=${toM2.hop} cid=${toM2.correlationId}`)

await fan.send.execute({ target: 'w', message: 'm1 again' }, fan.as('m1'))
const twinA = await fan.send.execute({ target: 'm1', message: 'which one?' }, fan.as('w'))
check('two open chains from one master are refused rather than guessed', twinA.status === 'ambiguous-chain', `status=${twinA.status} cid=${twinA.correlationId}`)
check('an ambiguous reply delivers nothing', fan.delivered('m1') === 1, `m1 received ${fan.delivered('m1')}`)

// ===================================================================
// Read is side-effect free and never throws; corpus failure surfaces.
// ===================================================================
const cold = await main.read.execute({ target: 'session-zzz' }, main.as('main'))
check('cold read reports a status instead of throwing', String(cold.status).startsWith('read-failed'), cold.status)
check('cold read never resumes the session', !main.live.has('session-zzz'), 'not resumed')

const listed = await main.list.execute({}, main.as('main'))
check('list failure is surfaced', listed.status !== 'ok', listed.status)

let failures = 0
for (const result of results) {
  if (!result.ok) failures += 1
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.label}  (${result.detail})`)
}
console.log(`\n${results.length - failures}/${results.length} passed`)
process.exit(failures === 0 ? 0 : 1)
