/** Configurable daily rewards. This module has no DSH core dependencies. */
import { randomInt } from 'node:crypto'

export const REWARD_TYPES = Object.freeze([
  'reset_five_hour', 'reset_week', 'reset_all', 'week_percent',
  'extra_quota', 'max_trial', 'ultra_trial', 'ultra_multiplier_trial',
])

export function durationMinutes(spec) {
  if (Number.isFinite(spec.durationMinutes)) return spec.durationMinutes
  if (Number.isFinite(spec.expireMinutes)) return spec.expireMinutes
  const match = /^(\d+)(m|h|d)$/.exec(spec.duration ?? '')
  if (match) return Number(match[1]) * ({ m: 1, h: 60, d: 1440 })[match[2]]
  return null
}

export function rewardTime(value) {
  if (value === undefined || value === null) return null
  const timestamp = typeof value === 'string' ? Date.parse(value) : value
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('invalid reward time')
  return timestamp
}

function dayParts(now, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(({ type, value }) => [type, value]))
  return { key: `${values.year}-${values.month}-${values.day}`, minute: Number(values.hour) * 60 + Number(values.minute) }
}

export function validateRewardPool(config) {
  const daily = config?.dailyRewards
  if (daily?.enabled !== true) return
  if (!Number.isInteger(daily.count) || daily.count < 1 || daily.count > 20) throw new Error('dailyRewards.count must be 1-20')
  if (typeof daily.timeZone !== 'string') throw new Error('dailyRewards.timeZone is required')
  try { new Intl.DateTimeFormat('en-US', { timeZone: daily.timeZone }) } catch { throw new Error('invalid dailyRewards.timeZone') }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(daily.at)) throw new Error('dailyRewards.at must be HH:MM')
  if (!Array.isArray(config.rewardPool) || config.rewardPool.length === 0) throw new Error('rewardPool must contain entries')
  let total = 0
  for (const entry of config.rewardPool) {
    if (!REWARD_TYPES.includes(entry?.type)) throw new Error(`invalid reward type: ${entry?.type}`)
    if (!Number.isFinite(entry.weight) || entry.weight < 0) throw new Error(`invalid weight: ${entry.type}`)
    if (entry.weight === 0) continue
    total += entry.weight
    validateRewardSpec(entry)
  }
  if (total <= 0) throw new Error('rewardPool must have positive weight')
}

export function validateRewardSpec(spec) {
  if (!REWARD_TYPES.includes(spec?.type)) throw new Error(`invalid reward type: ${spec?.type}`)
  if (['week_percent', 'extra_quota'].includes(spec.type)) {
    const key = spec.type === 'week_percent' ? 'percent' : 'amount'
    if (!Number.isFinite(spec[key]) || spec[key] <= 0) throw new Error(`${spec.type}.${key} must be positive`)
  }
  if (['max_trial', 'ultra_trial', 'ultra_multiplier_trial'].includes(spec.type)) {
    if (!(durationMinutes(spec) > 0) && spec.expire_time === undefined) throw new Error(`${spec.type} needs a positive duration or expire_time`)
  }
  if (spec.type === 'ultra_multiplier_trial' && (spec.ultraMultiplier ?? spec.ultra_multiplier) !== 1) throw new Error('ultra_multiplier_trial multiplier must be 1')
  if (spec.scope !== undefined && !['fiveHour', 'week', 'both'].includes(spec.scope)) throw new Error('invalid reward scope')
  if (spec.expireMinutes !== undefined && (!Number.isFinite(spec.expireMinutes) || spec.expireMinutes <= 0)) throw new Error('invalid expireMinutes')
  const start = rewardTime(spec.start_time)
  const expire = rewardTime(spec.expire_time)
  if (expire !== null && start !== null && expire <= start) throw new Error('expire_time must follow start_time')
}

export class RewardEngine {
  constructor(config, random = () => randomInt(0, 0x100000000) / 0x100000000) {
    this.config = config
    this.random = random
    validateRewardPool(config)
  }

  select() {
    const entries = this.config.rewardPool.filter((entry) => entry.weight > 0)
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
    let position = this.random() * total
    for (const entry of entries) {
      position -= entry.weight
      if (position < 0) return entry
    }
    return entries.at(-1)
  }

  award(store, now, source = 'daily') {
    return store.addReward(this.select(), now, source)
  }
}

export class RewardScheduler {
  constructor(store, engine, persist, now = () => Date.now(), onError = () => {}) {
    this.store = store
    this.engine = engine
    this.persist = persist
    this.now = now
    this.onError = onError
    this.busy = false
    this.timer = null
  }

  async tick() {
    if (this.busy || this.engine.config.dailyRewards?.enabled !== true) return []
    this.busy = true
    try {
      const now = this.now()
      const daily = this.engine.config.dailyRewards
      const { key, minute } = dayParts(now, daily.timeZone)
      const [hour, minuteOfHour] = daily.at.split(':').map(Number)
      if (minute < hour * 60 + minuteOfHour || this.store.lastRewardDay === key) return []
      const rewards = Array.from({ length: daily.count }, () => this.engine.award(this.store, now))
      this.store.lastRewardDay = key
      await this.persist()
      return rewards
    } finally { this.busy = false }
  }

  start(intervalMs = 60000) {
    void this.tick().catch(this.onError)
    this.timer = setInterval(() => void this.tick().catch(this.onError), intervalMs)
    return () => { clearInterval(this.timer); this.timer = null }
  }
}
