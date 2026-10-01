import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { QuotaStore, calculateUsage, HOUR5, WEEK } from '../lib/quota.js'
import { RewardEngine, RewardScheduler } from '../lib/rewards.js'

const config = JSON.parse(await readFile(new URL('../office-boost.config.json', import.meta.url), 'utf8'))
const now = Date.UTC(2026, 8, 28, 0, 0, 0)
const store = () => new QuotaStore('unused', config, now)

test('plans have the requested limits and monthly prices', () => {
  const expected = { free: [1, 0], starter: [1.75, 19.9], plus: [2, 69.9], pro: [10, 99.9], max: [20, 299.9], ultra: [400, 699.9] }
  for (const [id, [multiplier, price]] of Object.entries(expected)) {
    assert.equal(config.plans[id].quotaMultiplier, multiplier)
    assert.equal(config.plans[id].priceMonthlyCny, price)
  }
})

test('usage separates input, cached input, output and discounts cache hits to 1%', () => {
  const bill = calculateUsage({ inputTokens: 100, cacheWriteTokens: 20, cacheReadTokens: 1000, outputTokens: 10 }, 'flash', 'high', now, config)
  assert.deepEqual([bill.input, bill.cacheInput, bill.output], [120, 1000, 10])
  assert.equal(bill.effectiveTokens, 120 + 10 + 40)
  assert.ok(bill.apiCostCny > 0)
})

test('Ultra spends 3x normally and 1x during its experience card', () => {
  const usage = { inputTokens: 100, outputTokens: 10 }
  const normal = calculateUsage(usage, 'flash', 'ultra', now, config)
  const trial = calculateUsage(usage, 'flash', 'ultra', now, config, true)
  assert.equal(normal.effectiveTokens, trial.effectiveTokens * 3)
  assert.equal(normal.apiCostCny, trial.apiCostCny)
  const ledger = store()
  ledger.grant('ultraTrial', now, { minutes: 30 })
  assert.equal(ledger.charge(usage, 'flash', 'ultra', now + 1).ultraMultiplier, 1)
  assert.equal(ledger.charge(usage, 'flash', 'ultra', now + 31 * 60000).ultraMultiplier, 3)
})

test('upgrade immediately restores both token windows to 100%', () => {
  const ledger = store()
  ledger.charge({ inputTokens: 1000 }, 'flash', 'high', now)
  assert.ok(ledger.snapshot(now).fiveHour.remainingRatio < 1)
  assert.ok(ledger.snapshot(now).week.remainingRatio < 1)
  ledger.setPlan('plus', now + 1)
  assert.equal(ledger.snapshot(now + 1).fiveHour.remainingRatio, 1)
  assert.equal(ledger.snapshot(now + 1).week.remainingRatio, 1)
})

test('reset cards affect only the requested windows', () => {
  const ledger = store()
  ledger.charge({ inputTokens: 1000 }, 'flash', 'high', now)
  ledger.grant('resetFiveHour', now + 1)
  assert.equal(ledger.fiveHour.spent, 0)
  assert.ok(ledger.week.spent > 0)
  ledger.grant('resetWeek', now + 2)
  assert.equal(ledger.week.spent, 0)
  ledger.charge({ inputTokens: 1000 }, 'flash', 'high', now + 3)
  ledger.grant('resetAll', now + 4)
  assert.equal(ledger.fiveHour.spent, 0)
  assert.equal(ledger.week.spent, 0)
})

test('temporary plan expires back to base and does not reset again', () => {
  const ledger = store()
  ledger.grant('planTrial', now, { plan: 'plus', minutes: 30 })
  assert.equal(ledger.activePlan(now + 29 * 60000), 'plus')
  ledger.charge({ inputTokens: 1000 }, 'flash', 'high', now + 1000)
  const spent = ledger.fiveHour.spent
  assert.equal(ledger.activePlan(now + 31 * 60000), 'free')
  assert.equal(ledger.fiveHour.spent, spent)
})

test('token windows expire independently; cost protection remains separate', () => {
  const ledger = store()
  ledger.charge({ inputTokens: 1_000_000 }, 'flash', 'high', now)
  assert.equal(ledger.fiveHour.spent, 1_000_000)
  ledger.blocked(now + HOUR5 + 1)
  assert.equal(ledger.fiveHour.spent, 0)
  assert.equal(ledger.week.spent, 1_000_000)
  ledger.blocked(now + WEEK + 1)
  assert.equal(ledger.week.spent, 0)
  ledger.costFiveHour.spent = config.plans.free.fiveHourCostCny
  assert.equal(ledger.blocked(now + WEEK + 2), 'costFiveHour')
})

test('public status exposes only percentages and current benefits, never usage or costs', () => {
  const ledger = store()
  ledger.charge({ inputTokens: 1000, cacheReadTokens: 200, outputTokens: 300 }, 'flash', 'high', now)
  ledger.costFiveHour.spent = config.plans.free.fiveHourCostCny
  const publicStatus = ledger.snapshot(now)
  assert.equal(publicStatus.blocked, 'service')
  assert.deepEqual(Object.keys(publicStatus.fiveHour).sort(), ['remainingRatio', 'resetsAt'])
  assert.equal(publicStatus.usage, undefined)
  assert.equal(publicStatus.plans, undefined)
  assert.equal(JSON.stringify(publicStatus).includes('Tokens'), false)
  assert.equal(JSON.stringify(publicStatus).includes('Cost'), false)
  assert.equal(ledger.adminSnapshot(now).fiveHourCost.limit, 4)
})

test('daily scheduler issues exactly two rewards after the configured time and survives restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'office-reward-'))
  try {
    const path = join(directory, 'ledger.json')
    const ledger = new QuotaStore(path, config, now)
    const engine = new RewardEngine({ ...config, rewardPool: [{ type: 'extra_quota', weight: 1, amount: 1000, scope: 'both', expireMinutes: 1440 }] }, () => 0)
    let clock = Date.UTC(2026, 8, 28, 0, 59) // 08:59 in Asia/Shanghai
    const scheduler = new RewardScheduler(ledger, engine, () => ledger.persist(), () => clock)
    assert.equal((await scheduler.tick()).length, 0)
    clock += 60000
    assert.equal((await scheduler.tick()).length, 2)
    assert.equal((await scheduler.tick()).length, 0)
    assert.equal(ledger.rewards.length, 2)
    assert.ok(ledger.rewards.every((reward) => reward.source === 'daily' && reward.start_time === clock && !reward.used))
    const restored = new QuotaStore(path, config, clock)
    await restored.load()
    assert.equal(restored.rewards.length, 2)
    assert.equal(restored.lastRewardDay, '2026-09-28')
    const restarted = new RewardScheduler(restored, engine, () => restored.persist(), () => clock)
    assert.equal((await restarted.tick()).length, 0)
    clock += 24 * 60 * 60 * 1000
    assert.equal((await restarted.tick()).length, 2)
    assert.equal(restored.rewards.length, 4)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('reward quotas stack without changing the base plan and expire independently', () => {
  const ledger = store()
  ledger.addReward({ type: 'week_percent', percent: 10, expireMinutes: 60 }, now, 'admin')
  ledger.addReward({ type: 'extra_quota', amount: 1_000_000, scope: 'both', expireMinutes: 120 }, now, 'daily')
  assert.equal(ledger.plan, 'free')
  assert.equal(ledger.rewardQuota(now + 1, 'free').week, 6_000_000)
  assert.equal(ledger.rewardQuota(now + 1, 'free').fiveHour, 1_000_000)
  assert.equal(ledger.week.snapshot(50_000_000 + ledger.rewardQuota(now + 1, 'free').week, now + 1).limit, 56_000_000)
  assert.equal(ledger.rewardQuota(now + 61 * 60000, 'free').week, 1_000_000)
  assert.equal(ledger.rewardQuota(now + 121 * 60000, 'free').week, 0)
})

test('Max and Ultra trials restore the prior plan; multiplier trial expires to 3x', () => {
  const ledger = store()
  ledger.addReward({ type: 'max_trial', durationMinutes: 60 }, now, 'daily')
  ledger.addReward({ type: 'ultra_trial', durationMinutes: 30 }, now, 'daily')
  ledger.addReward({ type: 'ultra_multiplier_trial', durationMinutes: 15, ultraMultiplier: 1 }, now, 'daily')
  assert.equal(ledger.activePlan(now + 1), 'ultra')
  assert.equal(ledger.charge({ inputTokens: 100 }, 'flash', 'ultra', now + 1).ultraMultiplier, 1)
  assert.equal(ledger.charge({ inputTokens: 100 }, 'flash', 'ultra', now + 16 * 60000).ultraMultiplier, 3)
  assert.equal(ledger.activePlan(now + 31 * 60000), 'max')
  assert.equal(ledger.activePlan(now + 61 * 60000), 'free')
  assert.equal(ledger.plan, 'free')
})

test('manual reward deletion removes an active entitlement', () => {
  const ledger = store()
  const reward = ledger.addReward({ type: 'extra_quota', amount: 1000, scope: 'week', expireMinutes: 60 }, now)
  assert.equal(ledger.rewardQuota(now, 'free').week, 1000)
  assert.equal(ledger.removeReward(reward.id), true)
  assert.equal(ledger.rewardQuota(now, 'free').week, 0)
  assert.equal(ledger.removeReward(reward.id), false)
})

test('new reset rewards apply immediately and are recorded as used', () => {
  const ledger = store()
  ledger.charge({ inputTokens: 1000 }, 'flash', 'high', now)
  const fiveHour = ledger.addReward({ type: 'reset_five_hour' }, now + 1, 'daily')
  assert.equal(fiveHour.used, true)
  assert.equal(ledger.fiveHour.spent, 0)
  assert.ok(ledger.week.spent > 0)
  ledger.addReward({ type: 'reset_week' }, now + 2, 'daily')
  assert.equal(ledger.week.spent, 0)
  ledger.charge({ inputTokens: 1000 }, 'flash', 'high', now + 3)
  ledger.addReward({ type: 'reset_all' }, now + 4, 'daily')
  assert.equal(ledger.fiveHour.spent, 0)
  assert.equal(ledger.week.spent, 0)
  assert.equal(ledger.activeRewards(now + 4).length, 0)
})

test('reward pool weights select configured entries', () => {
  const pool = { ...config, rewardPool: [
    { type: 'reset_five_hour', weight: 3 },
    { type: 'reset_week', weight: 1 },
  ] }
  assert.equal(new RewardEngine(pool, () => 0.1).select().type, 'reset_five_hour')
  assert.equal(new RewardEngine(pool, () => 0.9).select().type, 'reset_week')
})

test('explicit reward times and 24h duration are accepted', () => {
  const ledger = store()
  const future = now + 60000
  const reward = ledger.addReward({ type: 'ultra_trial', duration: '24h', ultra_multiplier: 1, start_time: future }, now)
  assert.equal(reward.expire_time, future + 24 * 60 * 60000)
  assert.equal(ledger.activePlan(now), 'free')
  assert.equal(ledger.activePlan(future), 'ultra')
  assert.equal(ledger.charge({ inputTokens: 100 }, 'flash', 'ultra', future).ultraMultiplier, 1)
  assert.equal(ledger.activePlan(reward.expire_time), 'free')
})

test('temporary entitlements survive restart and still expire on time', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'office-trial-'))
  try {
    const path = join(directory, 'ledger.json')
    const original = new QuotaStore(path, config, now)
    original.addReward({ type: 'max_trial', durationMinutes: 30 }, now)
    original.addReward({ type: 'ultra_multiplier_trial', durationMinutes: 30, ultraMultiplier: 1 }, now)
    await original.persist()
    const restored = new QuotaStore(path, config, now)
    await restored.load()
    assert.equal(restored.activePlan(now + 1000), 'max')
    assert.equal(restored.charge({ inputTokens: 10 }, 'flash', 'ultra', now + 1000).ultraMultiplier, 1)
    assert.equal(restored.activePlan(now + 31 * 60000), 'free')
    assert.equal(restored.charge({ inputTokens: 10 }, 'flash', 'ultra', now + 31 * 60000).ultraMultiplier, 3)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('administrator commands queue separate reward changes and save pool weights', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'office-admin-'))
  const run = promisify(execFile)
  const script = new URL('../scripts/office-admin.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
  try {
    const options = { env: { ...process.env, DSH_OFFICE_BOOST_STORAGE: directory } }
    await run(process.execPath, [script, 'rewards', 'add', 'extra_quota', '{"amount":1234}'], options)
    await run(process.execPath, [script, 'rewards', 'delete', 'test-id'], options)
    await run(process.execPath, [script, 'rewards', 'pool', 'set', 'reset_five_hour', '7'], options)
    const files = await readdir(join(directory, 'office-boost-controls'))
    assert.equal(files.length, 3)
    const actions = await Promise.all(files.map(async (name) => JSON.parse(await readFile(join(directory, 'office-boost-controls', name), 'utf8')).action))
    assert.deepEqual(actions.sort(), ['rewardAdd', 'rewardDelete', 'rewardPool'].sort())
    const override = JSON.parse(await readFile(join(directory, 'office-boost-reward-pool.json'), 'utf8'))
    assert.equal(override.rewardPool.find((entry) => entry.type === 'reset_five_hour').weight, 7)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
