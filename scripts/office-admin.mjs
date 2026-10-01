import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { PLAN_IDS, QuotaStore, validateConfig } from '../lib/quota.js'
import { validateRewardSpec, validateRewardPool } from '../lib/rewards.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const configPath = join(root, 'office-boost.config.json')
const storage = process.env.DSH_OFFICE_BOOST_STORAGE ?? join(homedir(), '.dsh', 'storages')
const ledgerPath = join(storage, 'office-boost-quota.json')
const controlDir = join(storage, 'office-boost-controls')
const poolPath = join(storage, 'office-boost-reward-pool.json')
const [action, ...args] = process.argv.slice(2)

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
  await rename(temp, path)
}

async function queueControl(value) {
  const id = randomUUID()
  await atomicJson(join(controlDir, `${Date.now()}-${id}.json`), { id, ...value })
}

const config = validateConfig(JSON.parse(await readFile(configPath, 'utf8')))
try { config.rewardPool = JSON.parse(await readFile(poolPath, 'utf8')).rewardPool } catch (error) { if (error?.code !== 'ENOENT') throw error }
validateRewardPool(config)
if (action === 'status') {
  const store = new QuotaStore(ledgerPath, config)
  await store.load()
  process.stdout.write(`${JSON.stringify(store.adminSnapshot(Date.now()), null, 2)}\n`)
} else if (action === 'plan') {
  const [plan] = args
  if (!PLAN_IDS.includes(plan)) throw new Error(`plan must be one of: ${PLAN_IDS.join(', ')}`)
  config.plan = plan
  await atomicJson(configPath, config)
  await queueControl({ action, plan })
  process.stdout.write(`Plan change queued: ${plan}\n`)
} else if (action === 'grant') {
  const [kind, plan, minutesRaw] = args
  const kinds = ['resetFiveHour', 'resetWeek', 'resetAll', 'planTrial', 'ultraTrial']
  if (!kinds.includes(kind)) throw new Error(`card must be one of: ${kinds.join(', ')}`)
  const minutes = minutesRaw === undefined ? undefined : Number(minutesRaw)
  if (kind === 'planTrial' && plan !== undefined && !PLAN_IDS.includes(plan)) throw new Error('unknown trial plan')
  await queueControl({ action, kind, ...(kind === 'planTrial' && plan ? { plan } : {}), ...(minutes === undefined ? {} : { minutes }) })
  process.stdout.write(`Card queued: ${kind}\n`)
} else if (action === 'rewards') {
  const [verb, ...rest] = args
  if (verb === 'list') {
    const ledger = new QuotaStore(ledgerPath, config)
    await ledger.load()
    process.stdout.write(`${JSON.stringify(ledger.rewards, null, 2)}\n`)
  } else if (verb === 'add') {
    const [type, optionsRaw] = rest
    const defaults = config.rewardPool.find((entry) => entry.type === type) ?? { type }
    const reward = { ...defaults, ...(optionsRaw ? JSON.parse(optionsRaw) : {}), type }
    validateRewardSpec(reward)
    await queueControl({ action: 'rewardAdd', reward })
    process.stdout.write(`Reward queued: ${type}\n`)
  } else if (verb === 'delete') {
    const [rewardId] = rest
    if (!rewardId) throw new Error('reward id is required')
    await queueControl({ action: 'rewardDelete', rewardId })
    process.stdout.write(`Reward deletion queued: ${rewardId}\n`)
  } else if (verb === 'pool') {
    if (rest.length === 0) process.stdout.write(`${JSON.stringify(config.rewardPool, null, 2)}\n`)
    else if (rest[0] === 'set') {
      const [, type, weightRaw] = rest
      const weight = Number(weightRaw)
      const rewardPool = config.rewardPool.map((entry) => entry.type === type ? { ...entry, weight } : entry)
      if (!rewardPool.some((entry) => entry.type === type)) throw new Error(`type is not in pool: ${type}`)
      validateRewardPool({ ...config, rewardPool })
      await atomicJson(poolPath, { rewardPool })
      await queueControl({ action: 'rewardPool', rewardPool })
      process.stdout.write(`Reward weight updated: ${type}=${weight}\n`)
    } else throw new Error('Usage: rewards pool [set <type> <weight>]')
  } else throw new Error('Usage: rewards list | add <type> [JSON options] | delete <id> | pool [set <type> <weight>]')
} else {
  process.stdout.write('Usage: node scripts/office-admin.mjs status | plan <tier> | grant <card> [plan] [minutes] | rewards list | rewards add <type> [JSON options] | rewards delete <id> | rewards pool [set <type> <weight>]\n')
  process.exitCode = action === undefined ? 0 : 1
}
