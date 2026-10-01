import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { durationMinutes, rewardTime, validateRewardPool, validateRewardSpec } from './rewards.js'

export const HOUR5 = 5 * 60 * 60 * 1000
export const WEEK = 7 * 24 * 60 * 60 * 1000
export const MONTH = 30 * 24 * 60 * 60 * 1000
export const PLAN_IDS = ['free', 'starter', 'plus', 'pro', 'max', 'ultra']

export function validateConfig(config) {
  if (!PLAN_IDS.includes(config?.plan)) throw new Error('invalid default plan')
  for (const key of ['freeFiveHourTokens', 'freeWeekTokens', 'ultraMultiplier']) {
    if (!(Number.isFinite(config[key]) && config[key] > 0)) throw new Error(`invalid ${key}`)
  }
  if (!(Number.isFinite(config.cacheReadWeight) && config.cacheReadWeight >= 0 && config.cacheReadWeight <= 1)) throw new Error('invalid cacheReadWeight')
  for (const id of PLAN_IDS) {
    for (const key of ['quotaMultiplier', 'maxStepsPerTurn', 'monthlyCostCny', 'fiveHourCostCny', 'weekCostCny']) {
      if (!(Number.isFinite(config.plans?.[id]?.[key]) && config.plans[id][key] > 0)) throw new Error(`invalid ${id}.${key}`)
    }
  }
  for (const id of ['flash', 'pro']) {
    for (const key of ['cacheHit', 'cacheMiss', 'output']) {
      if (!(Number.isFinite(config.modelPricesCnyPerMillion?.[id]?.[key]) && config.modelPricesCnyPerMillion[id][key] > 0)) throw new Error(`invalid ${id}.${key} price`)
    }
  }
  const chance = Object.values(config.rewardChances ?? {}).reduce((sum, value) => sum + Number(value), 0)
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) throw new Error('reward chances must total at most 1')
  validateRewardPool(config)
  return config
}

function amount(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function peakMultiplier(now) {
  const beijing = new Date(now + 8 * 3600 * 1000)
  const day = beijing.getUTCDay()
  const hour = beijing.getUTCHours()
  return day !== 0 && day !== 6 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)) ? 2 : 1
}

/** DeepSeek usage fields are disjoint: input excludes cache-read/write tokens. */
export function calculateUsage(usage, model, effort, now, config, ultraTrial = false) {
  const price = config.modelPricesCnyPerMillion[model === 'pro' ? 'pro' : 'flash']
  const input = amount(usage?.inputTokens) + amount(usage?.cacheWriteTokens)
  const cacheInput = amount(usage?.cacheReadTokens)
  const output = amount(usage?.outputTokens) + amount(usage?.reasoningTokens)
  const peak = peakMultiplier(now)
  const ultra = effort === 'ultra' && !ultraTrial ? config.ultraMultiplier : 1
  const inputWeight = price.cacheMiss / config.modelPricesCnyPerMillion.flash.cacheMiss
  const outputWeight = price.output / config.modelPricesCnyPerMillion.flash.cacheMiss
  return {
    input,
    cacheInput,
    output,
    effectiveTokens: (input * inputWeight + cacheInput * inputWeight * config.cacheReadWeight + output * outputWeight) * ultra,
    apiCostCny: (input * price.cacheMiss + cacheInput * price.cacheHit + output * price.output) * peak / 1e6,
    ultraMultiplier: ultra,
  }
}

class Window {
  constructor(spanMs) {
    this.spanMs = spanMs
    this.start = Date.now()
    this.spent = 0
  }

  roll(now) {
    if (now >= this.start + this.spanMs || now < this.start) this.reset(now)
  }

  reset(now) {
    this.start = now
    this.spent = 0
  }

  add(value, now) {
    this.roll(now)
    this.spent += value
  }

  snapshot(limit, now) {
    this.roll(now)
    const remaining = Math.max(0, limit - this.spent)
    return { remainingRatio: limit > 0 ? remaining / limit : 0, resetsAt: this.start + this.spanMs, spent: this.spent, limit }
  }
}

/** Local single-user entitlement and usage ledger. The API cost ledger is never sent to the client. */
export class QuotaStore {
  constructor(path, config, now = Date.now()) {
    this.path = path
    this.config = config
    this.plan = PLAN_IDS.includes(config.plan) ? config.plan : 'free'
    this.trial = null
    this.ultraTrialUntil = 0
    this.fiveHour = new Window(HOUR5)
    this.week = new Window(WEEK)
    this.costFiveHour = new Window(HOUR5)
    this.costWeek = new Window(WEEK)
    this.costMonth = new Window(MONTH)
    for (const window of this.windows()) window.start = now
    this.breakdown = { input: 0, cacheInput: 0, output: 0 }
    this.cards = []
    this.rewards = []
    this.lastRewardDay = null
    this.lastControlId = null
    this.queue = Promise.resolve()
  }

  windows() { return [this.fiveHour, this.week, this.costFiveHour, this.costWeek, this.costMonth] }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8'))
      if (raw?.version !== 2 && raw?.version !== 3) return
      this.plan = PLAN_IDS.includes(raw.plan) ? raw.plan : this.plan
      this.trial = raw.trial && PLAN_IDS.includes(raw.trial.plan) && Number.isFinite(raw.trial.until) ? raw.trial : null
      this.ultraTrialUntil = amount(raw.ultraTrialUntil)
      for (const key of ['fiveHour', 'week', 'costFiveHour', 'costWeek', 'costMonth']) {
        const stored = raw[key]
        if (Number.isFinite(stored?.start) && stored.start > 0) this[key].start = stored.start
        if (Number.isFinite(stored?.spent) && stored.spent >= 0) this[key].spent = stored.spent
      }
      for (const key of ['input', 'cacheInput', 'output']) this.breakdown[key] = amount(raw.breakdown?.[key])
      this.cards = Array.isArray(raw.cards) ? raw.cards.slice(0, 20) : []
      this.rewards = Array.isArray(raw.rewards) ? raw.rewards.filter((reward) => reward && typeof reward.id === 'string' && typeof reward.type === 'string') : []
      this.lastRewardDay = typeof raw.lastRewardDay === 'string' ? raw.lastRewardDay : null
      this.lastControlId = typeof raw.lastControlId === 'string' ? raw.lastControlId : null
    } catch { /* A missing ledger starts with full allowances. */ }
  }

  activePlan(now) {
    let plan = this.plan
    if (this.trial && now < this.trial.until && PLAN_IDS.indexOf(this.trial.plan) > PLAN_IDS.indexOf(plan)) plan = this.trial.plan
    if (this.trial && now >= this.trial.until) this.trial = null
    for (const reward of this.activeRewards(now)) {
      const trialPlan = reward.type === 'ultra_trial' ? 'ultra' : reward.type === 'max_trial' ? 'max' : null
      if (trialPlan && PLAN_IDS.indexOf(trialPlan) > PLAN_IDS.indexOf(plan)) plan = trialPlan
    }
    return plan
  }

  activeRewards(now) {
    return this.rewards.filter((reward) => !reward.used && reward.start_time <= now && (reward.expire_time === null || now < reward.expire_time))
  }

  addReward(spec, now, source = 'admin') {
    validateRewardSpec(spec)
    const metadata = { ...(spec.metadata && typeof spec.metadata === 'object' ? spec.metadata : {}), ...Object.fromEntries(Object.entries(spec).filter(([key]) => !['type', 'weight', 'metadata', 'start_time', 'expire_time'].includes(key))) }
    const start = rewardTime(spec.start_time) ?? now
    const duration = durationMinutes(spec)
    const expire = rewardTime(spec.expire_time) ?? (duration ? start + duration * 60000 : null)
    if (expire !== null && expire <= start) throw new Error('expire_time must follow start_time')
    if (spec.type.startsWith('reset_') && start > now) throw new Error('reset rewards cannot start in the future')
    const reward = {
      id: randomUUID(), type: spec.type, start_time: start,
      expire_time: expire,
      used: spec.type.startsWith('reset_'), source, metadata,
    }
    if (spec.type === 'reset_five_hour') this.resetScope('fiveHour', now)
    if (spec.type === 'reset_week') this.resetScope('week', now)
    if (spec.type === 'reset_all') this.resetScope('all', now)
    this.rewards.push(reward)
    return reward
  }

  removeReward(id) {
    const index = this.rewards.findIndex((reward) => reward.id === id)
    if (index < 0) return false
    this.rewards.splice(index, 1)
    return true
  }

  rewardQuota(now, planId) {
    const planWeek = this.config.freeWeekTokens * this.config.plans[planId].quotaMultiplier
    const bonus = { fiveHour: 0, week: 0 }
    for (const reward of this.activeRewards(now)) {
      if (reward.type === 'week_percent') bonus.week += planWeek * Number(reward.metadata.percent) / 100
      if (reward.type === 'extra_quota') {
        const amount = Number(reward.metadata.amount)
        const scope = reward.metadata.scope ?? 'both'
        if (scope === 'fiveHour' || scope === 'both') bonus.fiveHour += amount
        if (scope === 'week' || scope === 'both') bonus.week += amount
      }
    }
    return bonus
  }

  setPlan(plan, now) {
    if (!PLAN_IDS.includes(plan)) throw new RangeError(`unknown plan: ${plan}`)
    if (this.plan === plan) return false
    const upgrade = PLAN_IDS.indexOf(plan) > PLAN_IDS.indexOf(this.plan)
    this.plan = plan
    this.trial = null
    if (upgrade) this.resetScope('all', now)
    return true
  }

  grant(kind, now, options = {}) {
    const card = { id: randomUUID(), kind, at: now }
    if (kind === 'resetFiveHour') this.resetScope('fiveHour', now)
    else if (kind === 'resetWeek') this.resetScope('week', now)
    else if (kind === 'resetAll') this.resetScope('all', now)
    else if (kind === 'planTrial') {
      const plan = options.plan ?? this.config.planTrial.plan
      const minutes = options.minutes ?? this.config.planTrial.minutes
      if (!PLAN_IDS.includes(plan) || !(minutes > 0)) throw new RangeError('invalid plan trial')
      this.trial = { plan, until: now + minutes * 60000 }
      card.plan = plan
      card.minutes = minutes
      // A trial starts with the advertised allowance. Returning to the base
      // plan keeps the existing spend, so expiry cannot mint another reset.
      this.resetScope('all', now)
    } else if (kind === 'ultraTrial') {
      const minutes = options.minutes ?? this.config.ultraTrialMinutes
      if (!(minutes > 0)) throw new RangeError('invalid Ultra trial')
      this.ultraTrialUntil = Math.max(this.ultraTrialUntil, now + minutes * 60000)
      card.minutes = minutes
    } else throw new RangeError(`unknown card: ${kind}`)
    this.cards = [card, ...this.cards].slice(0, 20)
    return card
  }

  resetScope(scope, now) {
    if (scope === 'fiveHour' || scope === 'all') this.fiveHour.reset(now)
    if (scope === 'week' || scope === 'all') this.week.reset(now)
  }

  ultraTrialActive(now) {
    return now < this.ultraTrialUntil || this.activeRewards(now).some((reward) => reward.type === 'ultra_multiplier_trial' || (reward.type === 'ultra_trial' && (reward.metadata.ultraMultiplier ?? reward.metadata.ultra_multiplier) === 1))
  }

  charge(usage, model, effort, now) {
    const bill = calculateUsage(usage, model, effort, now, this.config, this.ultraTrialActive(now))
    this.fiveHour.add(bill.effectiveTokens, now)
    this.week.add(bill.effectiveTokens, now)
    this.costFiveHour.add(bill.apiCostCny, now)
    this.costWeek.add(bill.apiCostCny, now)
    this.costMonth.add(bill.apiCostCny, now)
    for (const key of ['input', 'cacheInput', 'output']) this.breakdown[key] += bill[key]
    return bill
  }

  blocked(now, planOverride) {
    const planId = planOverride ?? this.activePlan(now)
    const plan = this.config.plans[planId]
    const reward = this.rewardQuota(now, planId)
    const effective5 = this.fiveHour.snapshot(this.config.freeFiveHourTokens * plan.quotaMultiplier + reward.fiveHour, now)
    const effectiveWeek = this.week.snapshot(this.config.freeWeekTokens * plan.quotaMultiplier + reward.week, now)
    if (this.costMonth.snapshot(plan.monthlyCostCny, now).remainingRatio <= 0) return 'costMonth'
    if (this.costWeek.snapshot(plan.weekCostCny, now).remainingRatio <= 0) return 'costWeek'
    if (this.costFiveHour.snapshot(plan.fiveHourCostCny, now).remainingRatio <= 0) return 'costFiveHour'
    if (effectiveWeek.remainingRatio <= 0) return 'week'
    if (effective5.remainingRatio <= 0) return 'fiveHour'
    return null
  }

  snapshot(now) {
    const id = this.activePlan(now)
    const plan = this.config.plans[id]
    const reward = this.rewardQuota(now, id)
    const reason = this.blocked(now)
    const publicWindow = (window, limit) => {
      const { remainingRatio, resetsAt } = window.snapshot(limit, now)
      return { remainingRatio, resetsAt }
    }
    return {
      plan: { id, trialUntil: Math.max(this.trial?.until ?? 0, ...this.activeRewards(now).filter((item) => item.type === 'max_trial' || item.type === 'ultra_trial').map((item) => item.expire_time ?? 0)) },
      fiveHour: publicWindow(this.fiveHour, this.config.freeFiveHourTokens * plan.quotaMultiplier + reward.fiveHour),
      week: publicWindow(this.week, this.config.freeWeekTokens * plan.quotaMultiplier + reward.week),
      blocked: reason?.startsWith('cost') ? 'service' : reason,
      ultraMultiplier: this.ultraTrialActive(now) ? 1 : this.config.ultraMultiplier,
      ultraTrialUntil: this.ultraTrialUntil,
      entitlements: [...new Set(this.activeRewards(now).map((item) => item.type))],
    }
  }

  adminSnapshot(now) {
    const id = this.activePlan(now)
    const plan = this.config.plans[id]
    return {
      plan: id,
      inputTokens: this.breakdown.input,
      cacheInputTokens: this.breakdown.cacheInput,
      outputTokens: this.breakdown.output,
      fiveHourCost: this.costFiveHour.snapshot(plan.fiveHourCostCny, now),
      weekCost: this.costWeek.snapshot(plan.weekCostCny, now),
      monthCost: this.costMonth.snapshot(plan.monthlyCostCny, now),
      lastRewardDay: this.lastRewardDay,
    }
  }

  persist() {
    const body = JSON.stringify({
      version: 3, plan: this.plan, trial: this.trial, ultraTrialUntil: this.ultraTrialUntil,
      ...Object.fromEntries(['fiveHour', 'week', 'costFiveHour', 'costWeek', 'costMonth'].map((key) => [key, { start: this[key].start, spent: this[key].spent }])),
      breakdown: this.breakdown, cards: this.cards, rewards: this.rewards, lastRewardDay: this.lastRewardDay, lastControlId: this.lastControlId,
    }, null, 2)
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.${randomUUID()}.tmp`
      await writeFile(tmp, body, 'utf8')
      await rename(tmp, this.path)
    }).catch(() => { /* Accounting persistence must not fail a model turn. */ })
    return this.queue
  }
}
