/**
 * Office Boost — browser half.
 *
 * Three surfaces, all registered through the host's own slots so the plugin
 * inherits the app's theme, locale, and layout:
 *
 * - `conversation.input.model` — the model and thinking-intensity control in
 *   the composer's built-in model seat.
 * - `sidebar.footer.action` — the avatar button that opens the quota panel
 *   showing "remaining NN%" and a progress bar for each window.
 * - `shell.overlay` — the quota panel itself, plus the reward toast.
 *
 * The panel reads quota through the plugin's own read-only Host route, because
 * a hand-written plugin cannot register a Remote namespace (those require
 * generated strict-codec artifacts).
 *
 * @module @local/dsh-office-boost/client
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-office-boost',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Provider route owned by the Host half. */
    const PROVIDER = 'deepseek-office'

    /** Quota status route served by the Host half. */
    const STATUS_PATH = '/office-boost/status'

    /** Tier ids in ascending strength. The slider index maps onto this list. */
    const EFFORTS = ['low', 'high', 'max', 'ultra']

    /** The virtual model ids, in display order. Their labels and hints come
     * from the locale dictionaries, which keeps display copy in one place. */
    const TIERS = ['flash', 'work', 'pro-work']

    const NS = 'officeBoost'

    const zh = {
      'tier.label': '办公模式',
      'tier.flash': 'Flash',
      'tier.work': 'Work',
      'tier.pro-work': 'Pro Work',
      'tier.flash.hint': '轻快省钱',
      'tier.work.hint': '日常均衡',
      'tier.pro-work.hint': '最强质量',
      'effort.label': '思考强度',
      'effort.off': '关闭',
      'effort.low': '快速',
      'effort.high': '标准',
      'effort.max': '深度',
      'effort.ultra': 'Ultra',
      'effort.ultra.hint': '高级思考',
      'effort.aria': '思考强度',
      'quota.title': '额度',
      'quota.fiveHour': '5 小时额度',
      'quota.week': '本周额度',
      'quota.remaining': '剩余 {percent}%',
      'quota.plan': 'DSH 套餐：{plan}',
      'quota.avatar': '查看额度',
      'quota.blocked.week': '本周额度已用尽',
      'quota.blocked.fiveHour': '五小时额度已用尽',
      'quota.blocked.costMonth': '服务额度暂时不可用',
      'quota.blocked.costWeek': '服务额度暂时不可用',
      'quota.blocked.costFiveHour': '服务额度暂时不可用',
      'quota.blocked.service': '服务额度暂时不可用',
      'quota.close': '关闭',
      'quota.ultra': 'Ultra 消耗倍率：{multiplier}×',
      'card.title': '获得 DSH 额度奖励',
      'card.reset.fiveHour': '5 小时额度已重置',
      'card.reset.week': '本周额度已重置',
      'card.reset.all': '全部额度已重置',
      'card.free': '接下来 {minutes} 分钟不占用 5 小时额度',
      'card.resetFiveHour': '5 小时额度已重置',
      'card.resetWeek': '本周额度已重置',
      'card.resetAll': '5 小时和本周额度已重置',
      'card.planTrial': '获得 {plan} 套餐 {minutes} 分钟体验',
      'card.ultraTrial': '获得 Ultra 体验 {minutes} 分钟，期间按 1× 消耗',
      'card.dismiss': '知道了',
      'toast.title': 'DSH 额度奖励',
      'error.load': '额度信息读取失败',
      'dock.noRemote': '连不上会话服务，模式切换暂不可用',
      'settings.nav': 'Token 用量与套餐',
      'settings.title': 'Token 用量',
      'settings.total': '累计用量',
      'settings.input': '普通输入',
      'settings.cache': '缓存命中输入',
      'settings.output': '输出',
      'settings.plans': '套餐升级',
      'settings.current': '当前套餐',
      'settings.price': '¥{price}/月',
      'settings.multiplier': '{multiplier}× 额度基准',
      'settings.request': '申请升级',
      'settings.requested': '请为我开通 DSH {plan} 套餐（¥{price}/月）。',
      'settings.copy': '复制升级申请',
      'settings.copied': '已复制，请发送给管理员',
      'settings.note': '套餐与体验权益由 DSH 提供；开通由管理员处理。',
    }

    const en = {
      'tier.label': 'Office mode',
      'tier.flash': 'Flash',
      'tier.work': 'Work',
      'tier.pro-work': 'Pro Work',
      'tier.flash.hint': 'Fast and cheap',
      'tier.work.hint': 'Balanced daily',
      'tier.pro-work.hint': 'Best quality',
      'effort.label': 'Thinking',
      'effort.off': 'Off',
      'effort.low': 'Fast',
      'effort.high': 'Standard',
      'effort.max': 'Deep',
      'effort.ultra': 'Ultra',
      'effort.ultra.hint': 'Advanced reasoning',
      'effort.aria': 'Thinking intensity',
      'quota.title': 'Quota',
      'quota.fiveHour': '5-hour quota',
      'quota.week': 'This week',
      'quota.remaining': '{percent}% left',
      'quota.plan': 'DSH plan: {plan}',
      'quota.avatar': 'View quota',
      'quota.blocked.week': 'Weekly quota is spent',
      'quota.blocked.fiveHour': '5-hour quota is spent',
      'quota.blocked.costMonth': 'Service quota is temporarily unavailable',
      'quota.blocked.costWeek': 'Service quota is temporarily unavailable',
      'quota.blocked.costFiveHour': 'Service quota is temporarily unavailable',
      'quota.blocked.service': 'Service quota is temporarily unavailable',
      'quota.close': 'Close',
      'quota.ultra': 'Ultra quota multiplier: {multiplier}×',
      'card.title': 'DSH quota reward',
      'card.reset.fiveHour': 'Your 5-hour quota was reset',
      'card.reset.week': 'Your weekly quota was reset',
      'card.reset.all': 'All quotas were reset',
      'card.free': 'The 5-hour quota is suspended for {minutes} minutes',
      'card.resetFiveHour': 'Your 5-hour quota was reset',
      'card.resetWeek': 'Your weekly quota was reset',
      'card.resetAll': 'Both quotas were reset',
      'card.planTrial': '{minutes} minutes of the {plan} plan',
      'card.ultraTrial': '{minutes} minutes of Ultra at 1× quota use',
      'card.dismiss': 'Got it',
      'toast.title': 'DSH quota reward',
      'error.load': 'Could not read quota',
      'dock.noRemote': 'The session service is unavailable, so mode switching is off',
      'settings.nav': 'Token usage & plans',
      'settings.title': 'Token usage',
      'settings.total': 'Cumulative usage',
      'settings.input': 'Regular input',
      'settings.cache': 'Cached input',
      'settings.output': 'Output',
      'settings.plans': 'Upgrade plan',
      'settings.current': 'Current plan',
      'settings.price': '¥{price}/month',
      'settings.multiplier': '{multiplier}× base allowance',
      'settings.request': 'Request upgrade',
      'settings.requested': 'Please activate the DSH {plan} plan for me (¥{price}/month).',
      'settings.copy': 'Copy upgrade request',
      'settings.copied': 'Copied; send this to your administrator',
      'settings.note': 'Plans and trial benefits are provided by DSH. An administrator activates upgrades.',
    }

    /** Component styles. Tokens only, so light and dark both work. */
    const CSS = `
[data-slot="settings.general.item"]>:has([aria-label="显示代码工作视图"]),[data-slot="settings.general.item"]>:has([aria-label="Show coding view"]){display:none!important}
.ob-dock{align-items:center;gap:14px;flex-wrap:wrap;display:flex;padding:2px 2px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ob-modelSeat{position:relative;display:inline-flex;min-width:0}
.ob-trigger{border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 7px;font:inherit;white-space:nowrap}
.ob-trigger:hover,.ob-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.ob-trigger:disabled{opacity:.5;cursor:default}
.ob-triggerEffort{color:var(--dsw-alias-label-tertiary)}
.ob-menu{box-sizing:border-box;position:absolute;left:0;bottom:calc(100% + 8px);z-index:50;width:max-content;max-width:min(420px,calc(100vw - 32px));border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-base,#fff));box-shadow:0 12px 32px rgba(0,0,0,.18);padding:12px}
.ob-menu .ob-dock{align-items:flex-start;flex-direction:column;gap:10px;padding:0}
.ob-group{align-items:center;gap:8px;min-width:0;display:flex}
.ob-groupLabel{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.ob-seg{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-skeleton);display:inline-flex;overflow:hidden}
.ob-segBtn{border:none;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:3px 10px;font-size:12px;line-height:18px;font-family:inherit}
.ob-segBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ob-segBtn[aria-pressed=true]{background:var(--dsw-alias-state-business-primary);color:#fff}
.ob-segBtn:disabled{opacity:.5;cursor:default}
.ob-slider{align-items:center;gap:8px;display:flex}
.ob-range{width:132px;accent-color:var(--dsw-alias-state-business-primary)}
.ob-effortName{min-width:84px;color:var(--dsw-alias-label-primary);font-weight:500}
.ob-badge{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-state-business-primary);color:#fff;padding:0 6px;font-size:11px;line-height:16px}
.ob-tierHint{color:var(--dsw-alias-label-tertiary)}
.ob-avatar{width:30px;height:30px;border-radius:50%;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-skeleton);color:var(--dsw-alias-label-secondary);cursor:pointer;align-items:center;justify-content:center;display:inline-flex;font-size:11px;font-weight:600;font-family:inherit;padding:0}
.ob-avatar:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ob-avatar[data-blocked=true]{border-color:var(--dsw-alias-state-error-primary,#d33)}
.ob-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-end;justify-content:flex-start;padding:0 0 84px 16px}
.ob-scrim{position:absolute;inset:0;background:transparent}
.ob-panel{position:relative;width:300px;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-base,#fff));box-shadow:0 12px 32px rgba(0,0,0,.18);padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.ob-panelHead{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ob-panelTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ob-close{border:none;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:16px;line-height:16px;padding:2px 6px;font-family:inherit}
.ob-row{display:flex;flex-direction:column;gap:6px}
.ob-rowHead{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.ob-rowName{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ob-rowValue{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ob-bar{height:6px;border-radius:3px;background:var(--dsw-alias-bg-skeleton);overflow:hidden}
.ob-barFill{height:100%;border-radius:3px;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}
.ob-barFill[data-low=true]{background:var(--dsw-alias-state-error-primary,#d33)}
.ob-rowFoot{font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;justify-content:space-between;gap:8px}
.ob-note{font-size:11px;color:var(--dsw-alias-label-tertiary);border-top:.5px solid var(--dsw-alias-border-l2);padding-top:10px}
.ob-card{margin-top:8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-skeleton));padding:10px 12px;display:flex;gap:10px;align-items:flex-start}
.ob-cardTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ob-cardText{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ob-cardBtn{margin-left:auto;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;padding:3px 10px;font-size:12px;font-family:inherit}
.ob-settings{display:flex;flex-direction:column;gap:22px;max-width:760px;padding:8px 0 24px;color:var(--dsw-alias-label-primary)}
.ob-settingsTitle{font-size:18px;font-weight:600;line-height:26px;margin:0 0 12px}
.ob-settingsCard{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);padding:16px;background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-base,#fff))}
.ob-usageGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}
.ob-usageItem{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-skeleton);padding:12px;display:flex;flex-direction:column;gap:5px}
.ob-usageNumber{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
.ob-planGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.ob-planCard{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);padding:14px;display:flex;flex-direction:column;gap:7px}
.ob-planCard[data-current=true]{border-color:var(--dsw-alias-state-business-primary)}
.ob-planName{font-size:15px;font-weight:600}
.ob-planPrice{font-size:17px;font-weight:600}
.ob-planAction{align-self:flex-start;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-state-business-primary);color:#fff;padding:6px 12px;cursor:pointer;font:inherit;font-size:12px}
.ob-planAction:disabled{opacity:.55;cursor:default}
.ob-request{display:flex;align-items:flex-start;gap:8px;margin-top:12px;flex-wrap:wrap}
.ob-requestText{flex:1 1 300px;min-height:48px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary);padding:8px;font:inherit;resize:vertical}
@media(max-width:600px){.ob-planGrid{grid-template-columns:1fr}.ob-usageGrid{grid-template-columns:1fr}}
`

    /** Mount this plugin's stylesheet once per document. */
    function ensureStyles() {
      const tagId = '@local/dsh-office-boost/style'
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-office-boost'
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /** Format a millisecond countdown as a compact human string. */
    function formatCountdown(ms, locale) {
      if (!Number.isFinite(ms) || ms <= 0) return '0m'
      const totalMinutes = Math.ceil(ms / 60000)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      if (hours >= 24) {
        const days = Math.floor(hours / 24)
        const rest = hours % 24
        return locale === 'zh' ? `${days}天${rest}小时` : `${days}d ${rest}h`
      }
      if (hours > 0) return locale === 'zh' ? `${hours}小时${minutes}分` : `${hours}h ${minutes}m`
      return locale === 'zh' ? `${minutes}分钟` : `${minutes}m`
    }

    /**
     * Read the live locale id from the locale service.
     * @param service - the plugin context, passed in so this stays free of
     *   module-level state and can be exercised with a stub.
     */
    function localeId(service) {
      try {
        return service.locale.getLocale().id ?? 'zh'
      } catch {
        // Before `apply` runs there is no context yet, and a component rendered
        // in that window must still produce readable copy.
        return 'zh'
      }
    }

    /** Interpolate `{name}` placeholders from a variables object. */
    function fillVars(text, vars) {
      if (vars === undefined) return text
      return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
    }

    /**
     * Build a translation reader for one component.
     *
     * Resolution order, most specific first:
     *   1. the reader the host injected as a prop, which follows the active
     *      locale and is the intended path;
     *   2. this module's own dictionaries, selected by the live locale id.
     *
     * Step 2 is load-bearing twice over. It keeps copy readable when the locale
     * namespace has not resolved yet (step 1 then answers with the raw key), and
     * it gives every component a reader — several of them render outside
     * `apply`'s scope, where a captured `t` simply does not exist.
     * @param props - the component's props, which may carry `t`.
     * @returns a `(key, vars?) => string` reader that never returns a bare key
     *   unless the key is genuinely unknown to both sources.
     */
    function translator(props) {
      const injected = typeof props?.t === 'function' ? props.t : undefined
      return (key, vars) => {
        if (injected !== undefined) {
          const value = injected(key, vars)
          if (typeof value === 'string' && value.length > 0 && value !== key) return value
        }
        const dict = localeId(ctxRef) === 'en' ? en : zh
        return fillVars(dict[key] ?? key, vars)
      }
    }
    /**
     * Quota store shared by both surfaces: one poller feeds the dock badge and
     * the panel, and drains any rewards the Host has queued.
     */
    function createQuotaStore(ctx) {
      let snapshot = { status: 'loading', data: null }
      const listeners = new Set()
      let pendingCards = []
      const publish = (next) => {
        snapshot = next
        for (const listener of listeners) listener()
      }
      const read = async () => {
        try {
          const response = await fetch(STATUS_PATH, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(String(response.status))
          const data = await response.json()
          if (Array.isArray(data.newCards) && data.newCards.length > 0) {
            pendingCards = [...pendingCards, ...data.newCards]
          }
          publish({ status: 'ready', data })
        } catch (error) {
          publish({ status: 'error', data: snapshot.data, error: String(error) })
        }
      }
      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getSnapshot: () => snapshot,
        refresh: read,
        drainCards() {
          const cards = pendingCards
          pendingCards = []
          return cards
        },
      }
    }

    /** The thinking-intensity slider plus the virtual-model switcher. */
    function OfficeDock(props) {
      // Every prop is treated as optional on purpose. A slot entry that throws
      // during render is deactivated by the host, and a deactivated entry is
      // invisible with no error surface — which is indistinguishable from "the
      // feature was never built". Degrading to a plain, readable control is
      // always better than disappearing.
      const tt = translator(props)
      const sessionId = props.sessionId
      const disabledProp = props.locked || props.disabled
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)
      const menuRef = React.useRef(null)

      React.useLayoutEffect(() => {
        if (!open || !rootRef.current || !menuRef.current) return undefined
        const positionMenu = () => {
          const root = rootRef.current.getBoundingClientRect()
          const card = rootRef.current.closest('[data-composer-card]')?.getBoundingClientRect()
          const leftEdge = Math.max(8, (card?.left ?? 0) + 8)
          const rightEdge = Math.min(window.innerWidth - 8, (card?.right ?? window.innerWidth) - 8)
          const menu = menuRef.current
          menu.style.maxWidth = `${Math.max(0, rightEdge - leftEdge)}px`
          const width = menu.getBoundingClientRect().width
          const centered = root.left + (root.width - width) / 2
          menu.style.left = `${Math.max(leftEdge, Math.min(centered, rightEdge - width)) - root.left}px`
        }
        positionMenu()
        window.addEventListener('resize', positionMenu)
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(positionMenu)
        const cardElement = rootRef.current.closest('[data-composer-card]')
        if (cardElement) observer?.observe(cardElement)
        observer?.observe(rootRef.current)
        return () => {
          window.removeEventListener('resize', positionMenu)
          observer?.disconnect()
        }
      }, [open])

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (!rootRef.current?.contains(event.target)) setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        return () => document.removeEventListener('pointerdown', onPointerDown)
      }, [open])

      let selection
      try {
        if (typeof props.useProjection === 'function') selection = props.useProjection('modelSelection')
      } catch {
        // The projection is a convenience: without it the control still works,
        // it just cannot show which level is currently active.
        selection = undefined
      }

      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)

      const current = selection?.next ?? selection?.lastUsed ?? null
      const onOfficeRoute = current?.provider === PROVIDER
      const tier = onOfficeRoute ? current.model : null
      const effort = onOfficeRoute ? current.reasoningEffort ?? 'high' : null
      const index = effort === null ? 1 : Math.max(0, EFFORTS.indexOf(effort))
      const disabled = busy || disabledProp === true || sessionId === undefined

      const apply = React.useCallback(
        async (nextTier, nextEffort) => {
          setBusy(true)
          setError(null)
          try {
            const session = props.__sessionRemote
            if (session === undefined) {
              throw new Error(tt('dock.noRemote'))
            }
            const result = await session.selectModel({
              sessionId,
              provider: PROVIDER,
              model: nextTier,
              reasoningEffort: nextEffort,
            })
            if (result.ok === false) {
              setError(`${result.error?.code ?? 'error'}: ${result.error?.message ?? ''}`)
            }
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
          } finally {
            setBusy(false)
          }
        },
        [sessionId],
      )

      const onEffort = (next) => {
        const nextEffort = EFFORTS[next]
        if (nextEffort === undefined || nextEffort === effort) return
        // Off-route models have no office tiers, so entering one switches the
        // route first and carries the requested level in the same call.
        void apply(tier ?? 'work', nextEffort)
      }

      const onTier = (next) => {
        if (next === tier) return
        void apply(next, effort ?? 'high')
      }

      const effortLabel = onOfficeRoute ? tt(`effort.${EFFORTS[index]}`) : tt('tier.work.hint')

      const controls = h(
        'div',
        { className: 'ob-dock' },
        h(
          'div',
          { className: 'ob-group' },
          h('span', { className: 'ob-groupLabel' }, tt('tier.label')),
          h(
            'div',
            { className: 'ob-seg', role: 'group' },
            TIERS.map((id) =>
              h(
                'button',
                {
                  key: id,
                  type: 'button',
                  className: 'ob-segBtn',
                  'aria-pressed': tier === id,
                  disabled,
                  title: tt(`tier.${id}.hint`),
                  onClick: () => onTier(id),
                },
                tt(`tier.${id}`),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'ob-group ob-slider' },
          h('span', { className: 'ob-groupLabel' }, tt('effort.label')),
          h('input', {
            className: 'ob-range',
            type: 'range',
            min: 0,
            max: EFFORTS.length - 1,
            step: 1,
            value: index,
            disabled,
            'aria-label': tt('effort.aria'),
            'aria-valuetext': effortLabel,
            onChange: (event) => onEffort(Number(event.target.value)),
          }),
          h('span', { className: 'ob-effortName' }, effortLabel),
          EFFORTS[index] === 'ultra' ? h('span', { className: 'ob-badge' }, tt('effort.ultra.hint')) : null,
        ),
        h('span', { className: 'ob-tierHint' }, onOfficeRoute ? tt(`tier.${tier}.hint`) : tt('tier.work.hint')),
        error === null ? null : h('span', { className: 'ob-tierHint' }, error),
      )

      return h(
        'div',
        { className: 'ob-modelSeat', ref: rootRef, onKeyDown: (event) => { if (event.key === 'Escape') setOpen(false) } },
        h(
          'button',
          {
            type: 'button',
            className: 'ob-trigger',
            disabled,
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': `${tt('tier.label')} · ${tt('effort.label')}`,
            onClick: () => setOpen((value) => !value),
          },
          tt(`tier.${tier ?? 'work'}`),
          h('span', { className: 'ob-triggerEffort' }, effortLabel),
          '⌄',
        ),
        open ? h('div', { className: 'ob-menu', ref: menuRef, role: 'dialog', 'aria-label': tt('tier.label') }, controls) : null,
      )
    }

    /** The sidebar avatar that opens the quota panel. */
    function QuotaAvatar(props) {
      const t = translator(props)
      const store = props.__quotaStore
      const state = React.useSyncExternalStore(
        (listener) => store.subscribe(listener),
        () => store.getSnapshot(),
      )
      const blocked = state.data?.blocked != null
      return h(
        'button',
        {
          type: 'button',
          className: 'ob-avatar',
          'data-blocked': blocked ? 'true' : undefined,
          title: t('quota.avatar'),
          'aria-label': t('quota.avatar'),
          onClick: () => props.__openQuota(!props.__quotaOpen),
        },
        'DS',
      )
    }

    /** The quota panel and the reward toast. */
    function QuotaOverlay(props) {
      const t = translator(props)
      const store = props.__quotaStore
      const state = React.useSyncExternalStore(
        (listener) => store.subscribe(listener),
        () => store.getSnapshot(),
      )
      const [cards, setCards] = React.useState([])

      React.useEffect(() => {
        const drained = store.drainCards()
        if (drained.length > 0) setCards((current) => [...current, ...drained])
      }, [state.data])

      if (!props.__quotaOpen && cards.length === 0) return null

      const data = state.data
      const multiplier = data?.ultraMultiplier ?? 3
      const row = (key, window) => {
        const percent = Math.round((window?.remainingRatio ?? 0) * 100)
        const low = percent <= 20
        return h(
          'div',
          { className: 'ob-row', key },
          h(
            'div',
            { className: 'ob-rowHead' },
            h('span', { className: 'ob-rowName' }, t(key === 'fiveHour' ? 'quota.fiveHour' : 'quota.week')),
            h('span', { className: 'ob-rowValue' }, t('quota.remaining', { percent })),
          ),
          h(
            'div',
            { className: 'ob-bar', role: 'progressbar', 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 },
            h('div', {
              className: 'ob-barFill',
              style: { width: `${Math.max(2, percent)}%` },
              'data-low': low ? 'true' : undefined,
            }),
          ),
        )
      }

      return h(
        React.Fragment,
        null,
        props.__quotaOpen
          ? h(
              'div',
              { className: 'ob-overlay' },
              h('div', { className: 'ob-scrim', onClick: () => props.__openQuota(false) }),
              h(
                'div',
                { className: 'ob-panel', role: 'dialog', 'aria-label': t('quota.title') },
                h(
                  'div',
                  { className: 'ob-panelHead' },
                  h('span', { className: 'ob-panelTitle' }, t('quota.title')),
                  h(
                    'button',
                    { type: 'button', className: 'ob-close', onClick: () => props.__openQuota(false), 'aria-label': t('quota.close') },
                    '×',
                  ),
                ),
                data === null ? h('div', { className: 'ob-rowFoot' }, t('error.load')) : null,
                h('div', { className: 'ob-note' }, t('quota.plan', { plan: data?.plan?.id ?? 'free' })),
                row('fiveHour', data?.fiveHour),
                row('week', data?.week),
                data?.blocked != null
                  ? h('div', { className: 'ob-note' }, t(`quota.blocked.${data.blocked}`))
                  : null,
                h('div', { className: 'ob-note' }, t('quota.ultra', { multiplier })),
              ),
            )
          : null,
        cards.length === 0
          ? null
          : h(
              'div',
              { className: 'ob-overlay', style: { alignItems: 'flex-start', justifyContent: 'flex-end', padding: '64px 16px 0' } },
              h('div', { className: 'ob-scrim' }),
              h(
                'div',
                { className: 'ob-panel', role: 'status' },
                cards.map((card) =>
                  h(
                    'div',
                    { className: 'ob-card', key: card.id },
                    h(
                      'div',
                      null,
                      h('div', { className: 'ob-cardTitle' }, t('toast.title')),
                      h(
                        'div',
                        { className: 'ob-cardText' },
                        t(`card.${card.kind}`, { minutes: card.minutes, plan: card.plan }),
                      ),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'ob-cardBtn',
                        onClick: () => setCards((current) => current.filter((entry) => entry.id !== card.id)),
                      },
                      t('card.dismiss'),
                    ),
                  ),
                ),
              ),
            ),
      )
    }

    /** Replaces the account-and-balance settings page while keeping sign-in alive. */
    function TokenPlanSettings(props) {
      const t = translator(props)
      const state = React.useSyncExternalStore(
        (listener) => props.__quotaStore.subscribe(listener),
        () => props.__quotaStore.getSnapshot(),
      )
      const [requestedPlan, setRequestedPlan] = React.useState(null)
      const [copied, setCopied] = React.useState(false)
      const data = state.data
      const formatTokens = (value) => new Intl.NumberFormat(localeId(ctxRef) === 'en' ? 'en-US' : 'zh-CN').format(Number(value) || 0)
      const usage = data?.usage ?? {}
      const percentage = (window) => Math.max(0, Math.min(100, Math.round((window?.remainingRatio ?? 0) * 100)))
      const quotaRow = (key, window) => {
        const percent = percentage(window)
        return h('div', { className: 'ob-row', key },
          h('div', { className: 'ob-rowHead' },
            h('span', { className: 'ob-rowName' }, t(key)),
            h('span', { className: 'ob-rowValue' }, t('quota.remaining', { percent })),
          ),
          h('div', { className: 'ob-bar', role: 'progressbar', 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 },
            h('div', { className: 'ob-barFill', style: { width: `${percent}%` }, 'data-low': percent <= 20 ? 'true' : undefined }),
          ),
        )
      }
      return h('div', { className: 'ob-settings' },
        h('section', null,
          h('h2', { className: 'ob-settingsTitle' }, t('settings.title')),
          h('div', { className: 'ob-settingsCard' },
            data === null ? h('div', { className: 'ob-rowFoot' }, t('error.load')) : null,
            quotaRow('quota.fiveHour', data?.fiveHour),
            h('div', { style: { height: 16 } }),
            quotaRow('quota.week', data?.week),
            h('div', { className: 'ob-note' }, t('settings.total')),
            h('div', { className: 'ob-usageGrid' },
              [['settings.input', usage.inputTokens], ['settings.cache', usage.cacheInputTokens], ['settings.output', usage.outputTokens]].map(([label, value]) =>
                h('div', { className: 'ob-usageItem', key: label },
                  h('span', { className: 'ob-rowName' }, t(label)),
                  h('strong', { className: 'ob-usageNumber' }, formatTokens(value)),
                ),
              ),
            ),
          ),
        ),
        h('section', null,
          h('h2', { className: 'ob-settingsTitle' }, t('settings.plans')),
          h('div', { className: 'ob-planGrid' },
            (data?.plans ?? []).map((plan) => {
              const current = plan.id === data?.plan?.id
              return h('div', { className: 'ob-planCard', 'data-current': current ? 'true' : undefined, key: plan.id },
                h('span', { className: 'ob-planName' }, plan.id[0].toUpperCase() + plan.id.slice(1)),
                h('span', { className: 'ob-planPrice' }, t('settings.price', { price: plan.priceMonthlyCny })),
                h('span', { className: 'ob-rowName' }, t('settings.multiplier', { multiplier: plan.quotaMultiplier })),
                current
                  ? h('span', { className: 'ob-rowName' }, t('settings.current'))
                  : h('button', { type: 'button', className: 'ob-planAction', onClick: () => { setRequestedPlan(plan.id); setCopied(false) } }, t('settings.request')),
              )
            }),
          ),
          requestedPlan ? h('div', { className: 'ob-request' },
            h('textarea', {
              className: 'ob-requestText', readOnly: true,
              'aria-label': t('settings.request'),
              value: t('settings.requested', {
                plan: requestedPlan,
                price: data?.plans?.find((plan) => plan.id === requestedPlan)?.priceMonthlyCny ?? '',
              }),
            }),
            h('button', {
              type: 'button', className: 'ob-planAction',
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(t('settings.requested', {
                    plan: requestedPlan,
                    price: data?.plans?.find((plan) => plan.id === requestedPlan)?.priceMonthlyCny ?? '',
                  }))
                  setCopied(true)
                } catch { setCopied(false) }
              },
            }, t('settings.copy')),
            copied ? h('span', { className: 'ob-cardText', role: 'status' }, t('settings.copied')) : null,
          ) : null,
          h('p', { className: 'ob-cardText' }, t('settings.note')),
        ),
      )
    }

    /**
     * The browser plugin context, kept module-level because the components need
     * the locale service and are defined before `apply` runs.
     */
    let ctxRef
    function apply(ctx) {
      // The components are defined above and need the locale service, so this is
      // the only binding they can reach at render time.
      ctxRef = ctx
      ensureStyles()

      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'office-boost: dictionaries',
      )
      const t = ctx.locale.bind(NS)

      const store = createQuotaStore(ctx)

      // Match the shipped model-selection plugin: its root injection grants
      // access to the Remote session namespace during apply, and the slot
      // component receives that namespace as a plain prop.
      const sessionRemote = ctx.remote.session

      ctx.inject(['timer'], (scope) => {
        scope.effect(() => {
          void store.refresh()
          const timer = setInterval(() => void store.refresh(), 20000)
          return () => clearInterval(timer)
        }, 'office-boost: quota poller')
      })

      /** Panel visibility, shared by the avatar button and the overlay. */
      let quotaOpen = false
      const openListeners = new Set()
      const setQuotaOpen = (next) => {
        quotaOpen = next
        for (const listener of openListeners) listener()
      }

      ctx.effect(
        () =>
          ctx.slots.inject('conversation.input.model', () =>
            ctx.slots.register(
              { name: 'conversation.input.model' },
              function OfficeDockHost(props) {
                return h(OfficeDock, { ...props, __sessionRemote: sessionRemote })
              },
            ),
          ),
        'office-boost: composer model control',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              { name: 'sidebar.footer.action', id: 'office-boost-quota', order: 20 },
              function SidebarQuotaAvatar(props) {
                const open = React.useSyncExternalStore(
                  (listener) => {
                    openListeners.add(listener)
                    return () => openListeners.delete(listener)
                  },
                  () => quotaOpen,
                )
                return h(QuotaAvatar, {
                  ...props,
                  t,
                  __quotaStore: store,
                  __quotaOpen: open,
                  __openQuota: setQuotaOpen,
                })
              },
            ),
          ),
        'office-boost: sidebar avatar',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              { name: 'shell.overlay', id: 'office-boost-quota-panel', order: 30 },
              function OverlayHost(props) {
                const open = React.useSyncExternalStore(
                  (listener) => {
                    openListeners.add(listener)
                    return () => openListeners.delete(listener)
                  },
                  () => quotaOpen,
                )
                return h(QuotaOverlay, { ...props, t, __quotaStore: store, __quotaOpen: open, __openQuota: setQuotaOpen })
              },
            ),
          ),
        'office-boost: quota overlay',
      )

      ctx.effect(
        () => ctx.slots.inject('settings.section', () => ctx.slots.register(
          { name: 'settings.section', id: 'account', priority: -1, order: -10, label: () => t('settings.nav') },
          function OfficeSettings(props) {
            return h(TokenPlanSettings, { ...props, t, __quotaStore: store })
          },
        )),
        'office-boost: token and plan settings',
      )

      // The official account entry stays mounted for login and account state.
      // Its settings page is shadowed above; remove only its duplicate nav row.
      ctx.effect(() => {
        const hideAccountNav = () => {
          for (const button of document.querySelectorAll('[data-shortcut-modal="settings"] nav button')) {
            if (['账号与余额', 'Account'].includes(button.textContent?.trim())) {
              if (button.style.display !== 'none') button.style.display = 'none'
              button.setAttribute('aria-hidden', 'true')
              button.tabIndex = -1
            }
          }
        }
        const observer = new MutationObserver(hideAccountNav)
        observer.observe(document.body, { childList: true, characterData: true, subtree: true })
        hideAccountNav()
        return () => observer.disconnect()
      }, 'office-boost: hide account balance settings navigation')
    }

    return { apply, NS, inject: ['slots', 'locale', 'sessions', 'remote', 'remote.session'] }
  },
})
