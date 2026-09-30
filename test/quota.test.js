import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { QuotaStore, calculateUsage, HOUR5, WEEK } from '../lib/quota.js'

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

test('public status exposes token categories and plan prices without real API costs', () => {
  const ledger = store()
  ledger.charge({ inputTokens: 1000, cacheReadTokens: 200, outputTokens: 300 }, 'flash', 'high', now)
  ledger.costFiveHour.spent = config.plans.free.fiveHourCostCny
  const publicStatus = ledger.snapshot(now)
  assert.equal(publicStatus.blocked, 'service')
  assert.deepEqual(Object.keys(publicStatus.fiveHour).sort(), ['remainingRatio', 'resetsAt'])
  assert.deepEqual(publicStatus.usage, { inputTokens: 1000, cacheInputTokens: 200, outputTokens: 300 })
  assert.equal(publicStatus.plans.find((plan) => plan.id === 'plus').priceMonthlyCny, 69.9)
  assert.equal(JSON.stringify(publicStatus).includes('Cost'), false)
  assert.equal(ledger.adminSnapshot(now).fiveHourCost.limit, 4)
})
