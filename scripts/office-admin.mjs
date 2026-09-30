import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { PLAN_IDS, QuotaStore } from '../lib/quota.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const configPath = join(root, 'office-boost.config.json')
const storage = join(homedir(), '.dsh', 'storages')
const ledgerPath = join(storage, 'office-boost-quota.json')
const controlPath = join(storage, 'office-boost-control.json')
const [action, ...args] = process.argv.slice(2)

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
  await rename(temp, path)
}

const config = JSON.parse(await readFile(configPath, 'utf8'))
if (action === 'status') {
  const store = new QuotaStore(ledgerPath, config)
  await store.load()
  process.stdout.write(`${JSON.stringify(store.adminSnapshot(Date.now()), null, 2)}\n`)
} else if (action === 'plan') {
  const [plan] = args
  if (!PLAN_IDS.includes(plan)) throw new Error(`plan must be one of: ${PLAN_IDS.join(', ')}`)
  config.plan = plan
  await atomicJson(configPath, config)
  await atomicJson(controlPath, { id: randomUUID(), action, plan })
  process.stdout.write(`Plan change queued: ${plan}\n`)
} else if (action === 'grant') {
  const [kind, plan, minutesRaw] = args
  const kinds = ['resetFiveHour', 'resetWeek', 'resetAll', 'planTrial', 'ultraTrial']
  if (!kinds.includes(kind)) throw new Error(`card must be one of: ${kinds.join(', ')}`)
  const minutes = minutesRaw === undefined ? undefined : Number(minutesRaw)
  if (kind === 'planTrial' && plan !== undefined && !PLAN_IDS.includes(plan)) throw new Error('unknown trial plan')
  await atomicJson(controlPath, { id: randomUUID(), action, kind, ...(kind === 'planTrial' && plan ? { plan } : {}), ...(minutes === undefined ? {} : { minutes }) })
  process.stdout.write(`Card queued: ${kind}\n`)
} else {
  process.stdout.write('Usage: node scripts/office-admin.mjs status | plan <tier> | grant <card> [plan] [minutes]\n')
  process.exitCode = action === undefined ? 0 : 1
}
