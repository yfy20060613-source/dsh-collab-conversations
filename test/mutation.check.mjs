// Mutation check: break one defence at a time in the BUILT output and record
// which test catches it. lib/index.js is restored at the end either way.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const target = 'lib/index.js'
const pristine = readFileSync(target, 'utf8')

const mutations = [
  ['star gate on an echoed parent id', `return { ok: false, status: 'not-chain-origin', depth: continued.depth };`, `;`],
  ['star gate on a bare hand-off', `return { ok: false, status: 'not-chain-origin', depth: deepest };`, `;`],
  ['fan-in keeps every master (Set accumulate)', `held.add(correlationId);`, `held.clear(); held.add(correlationId);`],
  ['a forward opens a child chain (new id)', 'const correlationId = `sb-${randomUUID()}`;', 'const correlationId = explicit;'],
  ['ambiguity is refused', 'if (towards.length > 1)', 'if (towards.length > 2)'],
  ['a reply does not ratchet depth', 'return { ok: true, correlationId: explicit, depth: continued.depth, isReply: true };', 'return { ok: true, correlationId: explicit, depth: continued.depth + 1, isReply: true };'],
  ['maxHops bound', 'if (depth > maxHops) {', 'if (depth > maxHops + 9) {'],
]

let survived = 0
try {
  for (const [label, from, to] of mutations) {
    const source = pristine
    if (!source.includes(from)) {
      console.log(`SKIP  ${label}  (anchor not found)`)
      survived += 1
      continue
    }
    writeFileSync(target, source.replace(from, to))
    let out = ''
    let failed = 0
    try {
      out = execFileSync(process.execPath, ['test/logic.test.mjs'], { encoding: 'utf8' })
    } catch (error) {
      out = String(error.stdout ?? '') + String(error.stderr ?? '')
    }
    const caught = out.split('\n').filter((line) => line.startsWith('FAIL'))
    failed = caught.length
    if (failed === 0) {
      survived += 1
      console.log(`SURVIVED  ${label}  — no test failed`)
    } else {
      console.log(`CAUGHT    ${label}  — ${failed} test(s):`)
      for (const line of caught) console.log(`            ${line.trim()}`)
    }
  }
} finally {
  writeFileSync(target, pristine)
}
console.log(`\n${mutations.length - survived}/${mutations.length} mutations caught`)
process.exit(survived === 0 ? 0 : 1)
