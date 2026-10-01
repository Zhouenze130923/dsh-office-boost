/**
 * Office Boost — Host half.
 *
 * One plugin, five jobs:
 *
 * 1. Own the `deepseek-office` provider route. It is a thin adapter that
 *    delegates every real request to an already-mounted provider (the shipped
 *    DeepSeek account route by default) and only adds what that route cannot
 *    express: three virtual office models in the catalog, and the `ultra`
 *    reasoning tier.
 * 2. Lock the context ceiling at 256k and reuse the shipped compaction policy
 *    by declaring that ceiling in the model metadata, which is exactly where
 *    `compaction` reads it from.
 * 3. Fold observed provider usage into CNY at the published list prices, and
 *    enforce a rolling five-hour window and a rolling seven-day window.
 *    `ultra` bills at a configurable multiplier.
 * 4. Deal the random rewards: a quota-reset card, and a temporary waiver of
 *    the five-hour ceiling.
 * 5. Serve the browser half a read-only status document and register a `/quota`
 *    command, so the sidebar avatar can show remaining quota.
 *
 * This plugin deliberately imports nothing from `@deepseek-ai/*`. A
 * profile-installed bundle resolves its own imports from the profile, where
 * those packages are absent, so importing them would leave the plugin
 * permanently inactive. Everything it needs from the host arrives through
 * `ctx` services.
 *
 * @module @local/dsh-office-boost
 */
import { readFile, readdir, rm } from 'node:fs/promises'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { QuotaStore, PLAN_IDS, validateConfig } from './quota.js'
import { installBrowserTools } from './browser.js'
import { RewardEngine, RewardScheduler, validateRewardPool } from './rewards.js'

/** Provider route this plugin owns. The shipped routes cannot be replaced. */
const PROVIDER = 'deepseek-office'

/** Provider name shown in the model picker. */
const PROVIDER_NAME = 'DeepSeek Office'

/** Upstream provider route every real request is delegated to. */
const UPSTREAM_PROVIDER = 'deepseek-account'

/** Local tier id for the strongest mode. */
const ULTRA = 'ultra'

/** Reasoning levels the upstream wire understands, weakest first. */
const WIRE_EFFORTS = ['off', 'low', 'high', 'max']

/** The `ultra` tier descriptor appended to every virtual model. */
const ULTRA_EFFORT = Object.freeze({
  id: ULTRA,
  name: 'Ultra',
  description: 'Maximum reasoning plus the verification protocol; bills at the configured multiplier.',
})

/**
 * The three virtual office models. Each maps onto a real wire model and a real
 * reasoning level; the difference between them is which combination, plus the
 * system-prompt persona, they select.
 */
const VIRTUAL_MODELS = Object.freeze([
  {
    id: 'flash',
    name: 'Flash',
    description: 'Fast and inexpensive; routine questions, short edits, simple lookups.',
    wire: 'deepseek-flash',
    price: 'flash',
    effort: 'low',
  },
  {
    id: 'work',
    name: 'Work',
    description: 'The everyday balanced mode for documents, spreadsheets, slides, and multi-step tasks.',
    wire: 'deepseek-flash',
    price: 'flash',
    effort: 'high',
  },
  {
    id: 'pro-work',
    name: 'Pro Work',
    description: 'Deepest reasoning for complex analysis, long documents, and high-stakes output.',
    wire: 'deepseek-v4-pro',
    price: 'pro',
    effort: 'max',
  },
])

/** Virtual model id to its declaration. */
const MODEL_BY_ID = new Map(VIRTUAL_MODELS.map((model) => [model.id, model]))

/**
 * Live settings. Plain values, not a Config schema: a schema would have to come
 * from `@deepseek-ai/schemastery`, which this bundle cannot resolve. The
 * bundle patch carries the operator-facing values, and these are the fallbacks.
 */
const settings = {
  contextWindow: Number(process.env.DSH_OFFICE_BOOST_CONTEXT_WINDOW ?? 262144),
  // The frontier agents pair their top reasoning tier with a much larger output
  // reservation, and the Ultra protocol asks for long, verifiable answers.
  maxTokens: Number(process.env.DSH_OFFICE_BOOST_MAX_TOKENS ?? 65536),
  upstreamProvider: process.env.DSH_OFFICE_BOOST_UPSTREAM ?? UPSTREAM_PROVIDER,
}

/** Runs inside a profile; the sidebar polls this read-only status route. */
const STATUS_PATH = '/office-boost/status'

/** Prompt sections keyed by virtual model. */
const TIER_PROMPTS = {
  flash:
    'You are in **Flash** mode: answer directly and economically. Prefer one decisive tool call over exploratory ones, skip restating the task, and stop as soon as the question is answered. Say so plainly when a task actually needs a deeper mode rather than guessing.',
  work:
    'You are in **Work** mode: the everyday office setting. Plan briefly, then act. Produce complete, ready-to-use artifacts — documents, spreadsheets, slide decks, mail, summaries — and state any assumption you had to make. Verify deliverables before presenting them.',
  'pro-work':
    'You are in **Pro Work** mode: quality first, cost secondary. Decompose the request before acting, name the failure modes you are checking for, and verify each deliverable against the original requirement before presenting it. Use subagents to work independent parts in parallel when that shortens the critical path. Prefer thoroughness over speed.',
}

/** Office workflow guidance shared by every model and reasoning tier. */
const OFFICE_WORKFLOW_PROMPT = [
  'When the user asks to read, create, edit, analyze, convert, or preview an office file, deliver the actual file rather than only describing how to make it.',
  'First inspect the input and identify its format and the requested output. Load the matching available skill before using office tools: office-docx for Word, office-xlsx for Excel, office-pptx or ppt-master for presentations, and office-pdf for PDFs. Follow the loaded skill and use its supplied runtime and scripts; do not assume a tool or dependency exists without checking.',
  'For edits, preserve the original file and its unaffected content, styles, formulas, charts, and layout where possible. Save a new output unless the user asks to overwrite. Keep an editable source alongside a PDF when practical.',
  'Check the finished file by reopening it. Verify required content and structure; recalculate and inspect spreadsheet formulas when a calculation engine is available. Render and inspect pages or slides when visual quality matters and image inspection is available. Fix concrete defects before delivery.',
  'Give the user a usable path or file link to each deliverable. Mention only assumptions and checks that affect the result, and clearly say when a visual or formula check could not be completed.',
].join('\n')

/**
 * Extra instructions appended whenever the `ultra` tier is active.
 *
 * Every frontier coding agent's top reasoning tier is the same recipe: pin the
 * upstream reasoning level at its maximum, then inject an *orchestration*
 * instruction — decompose and state acceptance criteria first, delegate
 * independent work in parallel, and have the result checked by something other
 * than the context that produced it. The reasoning level itself is already
 * pinned to `max` by {@link upstreamOptions}; this text is the other half.
 */
const ULTRA_PROMPT = [
  '**Ultra reasoning is active.** This mode is graded on quality, not speed. Follow the protocol below.',
  '',
  '1. **Decompose before acting.** Restate the goal in your own words, list the constraints, list the edge cases that would break a naive answer, and write down the acceptance criteria you will be judged against. Only then choose an approach, and say why the alternatives are worse.',
  '2. **Delegate when it pays.** If two or more parts of the work are genuinely independent, hand them to subagents and work them in parallel instead of serially. Be explicit about what each subagent must return. Do not spawn a subagent for work you can finish in one step, and never busy-poll a running one.',
  '3. **Do not certify your own work.** A conclusion you reached inside this context is not evidence. Have an independent subagent re-derive it with read-only tools, or re-derive it from the primary source yourself in a fresh pass, before you present it as verified.',
  '4. **Do not stop at the first plausible answer.** Test your answer against every edge case from step 1. State plainly what you verified, how you verified it, and what you could not verify. Never close with a summary-only answer while a check is still outstanding.',
  '5. **Re-read the original request last.** Before you finish, confirm each part of it is satisfied, and name anything you deliberately left out.',
].join('\n')

// ---------------------------------------------------------------------------
// The provider route
// ---------------------------------------------------------------------------

/**
 * Resolve the virtual model's wire routing.
 * @param modelId - virtual model id.
 * @returns the virtual declaration, or undefined for a foreign model.
 */
function virtualModel(modelId) {
  return MODEL_BY_ID.get(modelId)
}

/**
 * Build the two configs of one delegated request.
 * @param options - the request the runtime dispatched to this route.
 * @returns the upstream `GenerateOptions` for an explicit reasoning level.
 */
function upstreamOptions(options) {
  const model = virtualModel(options.model)
  const effort = options.reasoningEffort
  const wireEffort = effort === ULTRA ? 'max' : WIRE_EFFORTS.includes(effort) ? effort : undefined
  const next = {
    ...options,
    provider: settings.upstreamProvider,
    model: model === undefined ? options.model : model.wire,
  }
  if (wireEffort === undefined) delete next.reasoningEffort
  else next.reasoningEffort = wireEffort
  return next
}

/**
 * The delegating adapter. It owns the virtual catalog and the `ultra` tier, and
 * forwards every real request to the upstream provider route.
 * @param host - Host context.
 * @param onUsage - receives `{ modelId, effort, usage }` per usage report.
 * @param isDelegating - predicate suppressing quota checks on delegated calls.
 */
function buildAdapter(host, onUsage) {
  /** Fold every usage chunk of one delegated stream into the accounting hook. */
  async function* account(modelId, effort, iterable) {
    for await (const chunk of iterable) {
      if (chunk?.type === 'usage' && chunk.usage !== undefined) onUsage({ modelId, effort, usage: chunk.usage })
      yield chunk
    }
  }

  return {
    providerInfo: (provider) => ({ id: provider, name: PROVIDER_NAME }),

    /**
     * `registerAdapter` validates the full adapter shape before it commits the
     * route, and it calls this method unconditionally. Returning `undefined`
     * means "use the process defaults", which is what the delegated route uses
     * too, so the two paths cannot drift.
     */
    providerRetryPolicy: () => undefined,

    /** The virtual catalog, which is what the picker renders. */
    listModels: () =>
      Promise.resolve(
        VIRTUAL_MODELS.map((model) => ({ provider: PROVIDER, id: model.id, name: model.name, description: model.description })),
      ),

    /**
     * Model metadata. This is the authority for the picker's reasoning list, for
     * request validation, and for the context ceiling that compaction reads.
     */
    resolveModel: async (provider, model) => {
      // An unknown id still has to answer with usable metadata: the runtime
      // validates request config against this result, so a bare rejection here
      // would turn a stale selection into an unresolvable route.
      const virtual = virtualModel(model) ?? MODEL_BY_ID.get('work')
      const efforts = [
        { id: 'low', name: 'Fast', description: 'Prefer for routine or latency-sensitive tasks.' },
        { id: 'high', name: 'Standard', description: 'The default balance for most tasks.' },
        { id: 'max', name: 'Deep', description: 'Reserve for difficult quality-first tasks.' },
        ULTRA_EFFORT,
      ]
      return {
        provider,
        id: model,
        name: virtualModel(model) === undefined ? model : virtual.name,
        description: virtual.description,
        // Both shipped DeepSeek models accept images, and declaring it here
        // avoids a second round trip just to re-read upstream capabilities.
        inputModalities: ['text', 'image'],
        context: { contextWindow: settings.contextWindow },
        defaultMaxTokens: settings.maxTokens,
        reasoning: { efforts, defaultEffort: virtual.effort },
      }
    },

    /** Bind metadata and dispatch to one generation, as the base class does. */
    async prepareCall(provider, model, signal) {
      return {
        model: await this.resolveModel(provider, model, signal),
        stream: (options) => this.stream(options),
      }
    },

    /**
     * Delegate one request to the upstream route. The initiator is detached so
     * the upstream adapter cannot be mistaken for the origin of this call, and
     * a guard marks the delegated call so this plugin's quota listener lets it
     * through unconditionally.
     */
    stream(options) {
      const modelId = options.model
      const effort = options.reasoningEffort
      const delegated = upstreamOptions(options)
      return (async function* delegate() {
        yield* account(modelId, effort, host.delegate(delegated))
      })()
    },
  }
}

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/**
 * Services this plugin works with. `llm` and `systemPrompt` are hard
 * requirements; the rest are optional and resolved lazily, because optional
 * services are only readable once the plugin's fiber is active.
 */
export const inject = ['llm', 'systemPrompt', 'skills']

/**
 * Append one line to the plugin's own activation trace, synchronously.
 *
 * The Host reports a failed entry only as `fiberPhase: failed`, and an async
 * write can lose the race against the failure that follows it, so this uses a
 * synchronous append. Diagnostics must never break activation, hence the catch.
 * @param message - line to record.
 */
function trace(message) {
  try {
    const path = join(homedir(), '.dsh', 'storages', 'office-boost-trace.log')
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    // Diagnostics must never break activation.
  }
}

/** Serialize a thrown value for the trace. */
function describe(error) {
  return error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
}

/**
 * Host plugin body.
 * @param ctx - Host context.
 */
export async function apply(ctx) {
  let step = 'start'
  try {
    trace(`apply() entered`)

    step = 'office PDF skill'
    const pdfSkillPath = fileURLToPath(new URL('../assets/office-pdf/SKILL.md', import.meta.url))
    const pdfSkillDir = dirname(pdfSkillPath)
    const pdfToolPath = join(pdfSkillDir, 'scripts', 'pdf_tool.py')
    const pdfVendorPath = join(homedir(), '.dsh', 'cache', 'office-boost', 'office-assets-v1', 'vendor', 'python')
    const officeAssetsScriptPath = fileURLToPath(new URL('../scripts/ensure-office-assets.py', import.meta.url))
    const pdfCandidate = {
      name: 'office-pdf',
      description: 'Read, create, edit, combine, and preview PDF files with the bundled PDF toolkit and Office conversion workflows.',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'office-boost-pdf',
      source: 'bundled',
      rank: 600,
      resourceBase: { kind: 'directory', path: pdfSkillDir },
      locator: pdfSkillPath,
    }
    ctx.effect(
      () => ctx.skills.registerProvider(() => ({
        name: 'office-boost-pdf',
        list: () => Promise.resolve([pdfCandidate]),
        async get(candidate, options) {
          const { rank: _rank, locator, ...summary } = candidate
          const raw = await readFile(locator, { encoding: 'utf8', signal: options.signal })
          const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '')
          return { ...summary, content: `${content}\n\nInstalled PDF tool: ${pdfToolPath}. It downloads the verified PyMuPDF runtime automatically on first use. Cached Python dependencies: ${pdfVendorPath}.` }
        },
      })),
      'office-boost: PDF skill',
    )
    trace('office PDF skill registered')

    step = 'ppt-master skill'
    const pptSkillPath = fileURLToPath(new URL('../vendor/ppt-master/SKILL.md', import.meta.url))
    const pptSkillDir = dirname(pptSkillPath)
    const pptIconsScriptPath = fileURLToPath(new URL('../scripts/expand-ppt-icons.py', import.meta.url))
    const pptCandidate = {
      name: 'ppt-master',
      description: 'Create and edit professional, editable PowerPoint decks with templates, native shapes, animation, narration, and visual review.',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'office-boost-ppt-master',
      source: 'bundled',
      rank: 600,
      resourceBase: { kind: 'directory', path: pptSkillDir },
      locator: pptSkillPath,
    }
    ctx.effect(
      () => ctx.skills.registerProvider(() => ({
        name: 'office-boost-ppt-master',
        list: () => Promise.resolve([pptCandidate]),
        async get(candidate, options) {
          const { rank: _rank, locator, ...summary } = candidate
          const raw = await readFile(locator, { encoding: 'utf8', signal: options.signal })
          const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '')
          return {
            ...summary,
            content: `## Installed in DSH\nPPT Master v6.6.0 is installed at ${pptSkillDir}. Use that as SKILL_DIR. Use the Python executable supplied by DSH workspace-dependencies. Before using its Python scripts, run ${officeAssetsScriptPath} once to download verified runtime assets. Set PYTHONPATH to ${pdfVendorPath} for every PPT Master Python subprocess. Keep generated projects in the task workspace. If you need the icon templates, run ${pptIconsScriptPath} with --output set to a task workspace directory; use the printed icons path.\n\n${content}`,
          }
        },
      })),
      'office-boost: ppt-master skill',
    )
    trace('ppt-master skill registered')

    step = 'quota store'
    const quotaConfig = validateConfig(JSON.parse(await readFile(fileURLToPath(new URL('../office-boost.config.json', import.meta.url)), 'utf8')))
    try {
      const override = JSON.parse(await readFile(join(homedir(), '.dsh', 'storages', 'office-boost-reward-pool.json'), 'utf8'))
      const next = { ...quotaConfig, rewardPool: override.rewardPool }
      validateRewardPool(next)
      quotaConfig.rewardPool = override.rewardPool
    } catch (error) {
      if (error?.code !== 'ENOENT') trace(`reward pool override ignored: ${describe(error)}`)
    }
    const store = new QuotaStore(join(homedir(), '.dsh', 'storages', 'office-boost-quota.json'), quotaConfig)
    await store.load()
    if (store.setPlan(quotaConfig.plan, Date.now())) await store.persist()
    trace(`quota store ready (${store.plan})`)

    const rewardEngine = new RewardEngine(quotaConfig)
    const rewardScheduler = new RewardScheduler(store, rewardEngine, () => store.persist(), () => Date.now(), (error) => trace(`daily rewards failed: ${describe(error)}`))
    ctx.effect(() => rewardScheduler.start(), 'office-boost: daily rewards')
    // The local operator CLI queues separate files so rapid commands do not
    // overwrite one another. These controls never enter the browser surface.
    const controlDir = join(homedir(), '.dsh', 'storages', 'office-boost-controls')
    const applyControl = async (control) => {
      if (typeof control.id !== 'string' || control.id === store.lastControlId) return
      const now = Date.now()
      if (control.action === 'plan') store.setPlan(control.plan, now)
      else if (control.action === 'grant') store.grant(control.kind, now, { plan: control.plan, minutes: control.minutes })
      else if (control.action === 'rewardAdd') store.addReward(control.reward, now, 'admin')
      else if (control.action === 'rewardDelete') store.removeReward(control.rewardId)
      else if (control.action === 'rewardPool') {
        const next = { ...quotaConfig, rewardPool: control.rewardPool }
        validateRewardPool(next)
        quotaConfig.rewardPool = control.rewardPool
      } else throw new Error('unknown office control action')
      store.lastControlId = control.id
      await store.persist()
    }
    let controlBusy = false
    ctx.effect(() => {
      const timer = setInterval(async () => {
        if (controlBusy) return
        controlBusy = true
        try {
          const names = await readdir(controlDir).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error))
          for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
            const path = join(controlDir, name)
            try {
              await applyControl(JSON.parse(await readFile(path, 'utf8')))
              await rm(path)
            } catch (error) { trace(`office control ${name} failed: ${describe(error)}`) }
          }
        } catch (error) {
          trace(`office control scan failed: ${describe(error)}`)
        } finally {
          controlBusy = false
        }
      }, 1000)
      return () => clearInterval(timer)
    }, 'office-boost: operator controls')
    /** Charge one usage report to both windows. */
    const accountUsage = ({ modelId, effort, usage }) => {
      const virtual = virtualModel(modelId)
      const priceKey = virtual?.price ?? 'flash'
      const now = Date.now()
      store.charge(usage, priceKey, effort, now)
      void store.persist()
    }

    const host = {
      /**
       * Hand one delegated call to the upstream route with the initiator
       * detached, so the upstream adapter is not mistaken for the caller.
       */
      delegate(options) {
        const upstream = ctx.get('llm')
        if (upstream === undefined) throw new Error('office-boost: the llm service is unavailable')
        const agents = ctx.get('agents')
        const operation = () => upstream.stream(options)
        return agents === undefined ? operation() : agents.withoutInitiator(operation)
      },
    }

    step = 'registerAdapter'
    ctx.effect(
      () => ctx.llm.registerAdapter([PROVIDER], buildAdapter(host, accountUsage)),
      'office-boost: provider route',
    )
    trace('provider route registered')

    step = 'systemPrompt.section'
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: 'office-boost:workflow',
          order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 0.25,
          text: OFFICE_WORKFLOW_PROMPT,
        }),
      'office-boost: office workflow prompt',
    )
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: 'office-boost:tier',
        order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 0.5,
        text: (context) => {
          const agent = context?.agent
          const config = agent?.session?.requestHeader?.()?.config
          if (config?.provider !== PROVIDER) return ''
          const base = TIER_PROMPTS[config.model] ?? ''
          return [base, config.reasoningEffort === ULTRA ? ULTRA_PROMPT : '']
            .filter((part) => part.length > 0)
            .join('\n\n')
        },
      }),
    'office-boost: tier prompt',
  )

  // --- Quota enforcement --------------------------------------------------
  // Check at every step. A temporary plan is retained for an already-running
  // turn when it expires, then the next turn sees the base plan.
  step = 'agent/pre-step listener'
  const turnPlans = new WeakMap()
  ctx.on('agent/pre-step', async ({ agent, turn, step: stepNumber }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const now = Date.now()
    let current = turnPlans.get(agent)
    const firstStep = current?.turn !== turn
    if (firstStep) {
      current = { turn, plan: store.activePlan(now) }
      turnPlans.set(agent, current)
    }
    const active = store.activePlan(now)
    if (PLAN_IDS.indexOf(active) > PLAN_IDS.indexOf(current.plan)) current.plan = active
    if (Number.isFinite(stepNumber) && stepNumber > quotaConfig.plans[current.plan].maxStepsPerTurn) {
      ctx.logger?.warn?.('office-boost: turn reached its execution budget')
      return { kind: 'reject' }
    }
    if (store.blocked(now, current.plan) !== null) {
      ctx.logger?.warn?.('office-boost: refusing a step, the quota window is spent')
      return { kind: 'reject' }
    }
    return decision
  })

  // --- Status route for the browser half ----------------------------------
  // Optional services are resolved through `ctx.inject`, which only runs once
  // this plugin's fiber is active and is a no-op in a composition without them.
  step = 'webServer inject'
  try {
    ctx.inject(['webServer'], (scope) => {
      scope.effect(
        () =>
          scope.webServer.register({
            kind: 'exact',
            path: STATUS_PATH,
            handler: (req, res) => {
              if (req.method !== 'GET') {
                res.statusCode = 405
                res.setHeader('allow', 'GET')
                res.end()
                return
              }
              res.statusCode = 200
              res.setHeader('content-type', 'application/json; charset=utf-8')
              res.setHeader('cache-control', 'no-store')
              res.end(
                JSON.stringify({
                  ...store.snapshot(Date.now()),
                }),
              )
            },
          }),
        'office-boost: status route',
      )
    })
    trace('status route injected')
  } catch (error) {
    trace(`status route injection failed:\n${describe(error)}`)
  }

  step = 'commands inject'
  try {
    ctx.inject(['commands'], (scope) => {
      scope.effect(
        () =>
          scope.commands.register({
            name: 'quota',
            description: '查看 5 小时与本周的额度剩余',
            handler: () => {
              const snapshot = store.snapshot(Date.now())
              const percent = (window) => `${Math.round(window.remainingRatio * 100)}%`
              return {
                kind: 'success',
                text: [
                  `套餐：${snapshot.plan.id}`,
                  `5 小时：剩余 ${percent(snapshot.fiveHour)}`,
                  `本周：剩余 ${percent(snapshot.week)}`,
                  `Ultra 消耗倍率：${snapshot.ultraMultiplier}×`,
                ].join('\n'),
              }
            },
          }),
        'office-boost: /quota command',
      )
    })
    trace('quota command injected')
  } catch (error) {
    trace(`quota command injection failed:\n${describe(error)}`)
  }

  step = 'browser tools inject'
  try {
    const browserSystemPrompt = ctx.systemPrompt
    ctx.inject(['tools'], (scope) => {
      installBrowserTools(scope, browserSystemPrompt)
      trace('browser tools registered')
    })
  } catch (error) {
    trace(`browser tools injection failed:\n${describe(error)}`)
  }

  trace('apply() completed successfully')
  } catch (error) {
    // The Host reports a failed entry only as `fiberPhase: failed` and the
    // desktop log prints no stack, so this file is the only place the real
    // cause survives. Keep the failure path; the success path is one line.
    trace(`apply() FAILED at step "${step}":\n${describe(error)}`)
    throw error
  }
}
