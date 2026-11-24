/**
 * Root cause proof for: cannot get property "tools" without inject
 *
 * Host loader does  unwrapExports(mod) ->  mod.default ?? mod  when the module
 * has a default export, so `export default apply` hands cordis a bare function
 * whose .inject is undefined -> the fiber mounts with an EMPTY inject map ->
 * ctx.tools is not an injected accessor -> and because the tool registry is not
 * committed yet at that moment, the guard throws the literal "without inject".
 * A module WITHOUT a default export keeps its namespace, so inject is honoured
 * and cordis holds the plugin until the registry exists.
 */
import { Context } from '@deepseek-ai/cordis'
import * as withDefault from '../lib/index.js'          // our build: HAS `export default apply`

// Same namespace, minus the default export (the proposed fix).
const withoutDefault = { Config: withDefault.Config, name: withDefault.name, inject: withDefault.inject, apply: withDefault.apply }

function harness() {
  const ctx = new Context()
  // NOTE: `tools` is deliberately NOT provided yet, like in the host at mount time.
  ctx.provide('agents', { get: () => undefined, resume: async () => {} })
  ctx.provide('sessions', { get: () => undefined })
  ctx.provide('sessionQuery', { listSessions: async () => [], readTitleSnapshots: async () => [], readSurface: async () => ({}) })
  const registry = { register: (t) => { console.log('   REG', t.name); return () => {} } }
  return { ctx, registry }
}

function unwrapExports(mod) {
  const isPluginShape = typeof mod === 'function' || (mod && typeof mod.apply === 'function' && mod[Symbol.toStringTag] !== 'Module')
  return isPluginShape || (mod = mod.default ?? mod, !mod.__esModule) ? mod : mod.default ?? mod
}

console.log('host unwrapExports() picks:', typeof unwrapExports(withDefault), '(typeof of what the loader passes to ctx.plugin)')

const a = harness()
try {
  await a.ctx.plugin(unwrapExports(withDefault), {})
  console.log('A with default export  -> MOUNT OK (unexpected)')
} catch (e) {
  console.log('A with default export  -> ', e?.message)
}

const b = harness()
try {
  const fiber = b.ctx.plugin(withoutDefault, {})
  await Promise.race([fiber, new Promise((r) => setTimeout(r, 50))])
  console.log('B without default      -> held (waiting for the registry), no error thrown')
  b.ctx.provide('tools', b.registry)
  await fiber
  console.log('B without default      -> MOUNT OK once tools exists')
} catch (e) {
  console.log('B without default      -> ', e?.message)
}
process.exit(0)
