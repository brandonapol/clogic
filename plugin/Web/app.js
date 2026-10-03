const doc = globalThis.document
const byId = (id) => doc.getElementById(id)

const els = {
  thread: byId('thread'),
  empty: byId('empty-state'),
  dot: byId('connection-dot'),
  contextName: byId('context-name'),
  banner: byId('connection-banner'),
  bannerTitle: byId('connection-title'),
  bannerDetail: byId('connection-detail'),
  reconnect: byId('reconnect'),
  composer: byId('composer'),
  composerBox: byId('composer-box'),
  send: byId('send'),
  providerLabel: byId('provider-label'),
  tokenCount: byId('token-count'),
  settings: byId('settings'),
  openSettings: byId('open-settings'),
  closeSettings: byId('close-settings'),
  providers: byId('providers'),
  apiKey: byId('api-key'),
  keyHint: byId('key-hint'),
  saveKey: byId('save-key'),
  useProvider: byId('use-provider'),
  confirm: byId('confirm'),
  confirmTitle: byId('confirm-title'),
  confirmReason: byId('confirm-reason'),
  confirmRows: byId('confirm-rows'),
  confirmNote: byId('confirm-note'),
  confirmCancel: byId('confirm-cancel'),
  confirmApply: byId('confirm-apply'),
}

const providerNames = { anthropic: 'Claude', openai: 'OpenAI', xai: 'Grok' }

const endReasonNotes = {
  max_tokens: 'The reply hit the length limit and was cut off.',
  refusal: 'The model declined to answer.',
  iteration_limit: 'Stopped after too many tool calls in one turn.',
  llm_error: 'The provider returned an error.',
  cancelled: 'Stopped.',
  budget_exceeded: 'Stopped: the usage budget for this chat was reached.',
  other: 'The reply ended early.',
}

const connectionTitles = {
  connecting: 'Connecting to the clogic companion',
  offline: 'Companion offline',
  incompatible: 'Companion version mismatch',
}

const state = {
  connection: 'connecting',
  running: false,
  turnId: null,
  tokens: 0,
  providers: new Map(),
  activeProvider: null,
  selectedProvider: 'anthropic',
  messages: new Map(),
  tools: new Map(),
  proposal: null,
  proposalTimer: null,
  keyboardOwned: false,
}

const post = (message) => {
  const handler = globalThis.webkit?.messageHandlers?.clogic
  if (handler) handler.postMessage(message)
}

const iconTemplate = byId('icon-template')

const svgIcon = (id, extraClass) => {
  const svg = iconTemplate.content.firstElementChild.cloneNode(true)
  svg.setAttribute('class', extraClass ? `icon ${extraClass}` : 'icon')
  svg.querySelector('use').setAttribute('href', `#${id}`)
  return svg
}

const el = (tag, className, text) => {
  const node = doc.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const scrollToEnd = () => {
  const thread = els.thread
  const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80
  if (nearBottom) thread.scrollTop = thread.scrollHeight
}

const append = (node) => {
  els.empty.hidden = true
  els.thread.appendChild(node)
  scrollToEnd()
  return node
}

const inline = (text) => {
  const fragment = doc.createDocumentFragment()
  text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter((part) => part.length > 0)
    .forEach((part) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        fragment.appendChild(el('strong', '', part.slice(2, -2)))
      } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        fragment.appendChild(el('code', '', part.slice(1, -1)))
      } else {
        fragment.appendChild(doc.createTextNode(part))
      }
    })
  return fragment
}

const renderMarkdown = (container, text) => {
  container.replaceChildren()
  text
    .split(/\n{2,}/)
    .filter((block) => block.trim().length > 0)
    .forEach((block) => {
      const lines = block.split('\n')
      const isList = lines.every((line) => /^\s*[-*] /.test(line))
      if (isList) {
        const list = el('ul')
        lines.forEach((line) => {
          const item = el('li')
          item.appendChild(inline(line.replace(/^\s*[-*] /, '')))
          list.appendChild(item)
        })
        container.appendChild(list)
      } else {
        const paragraph = el('p')
        paragraph.appendChild(inline(block))
        container.appendChild(paragraph)
      }
    })
}

const formatValue = (value) => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

const formatDuration = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

const describeInput = (input) => {
  const first = Object.values(input).find((value) => typeof value === 'string')
  if (typeof first === 'string') return first.split('/').pop() || first
  const text = JSON.stringify(input)
  return text.length > 60 ? `${text.slice(0, 57)}...` : text
}

const addNote = (text) => append(el('div', 'note-line', text))

const addErrorBanner = (title, detail) => {
  const banner = el('div', 'banner')
  banner.setAttribute('role', 'alert')
  banner.appendChild(svgIcon('i-alert'))
  const body = el('div', 'banner-body')
  body.appendChild(el('div', 'banner-title', title))
  if (detail) body.appendChild(el('div', '', detail))
  banner.appendChild(body)
  return append(banner)
}

const setKeyboardOwned = (owned) => {
  if (owned === state.keyboardOwned) return
  state.keyboardOwned = owned
  post({ type: 'keyboard.focus', owned })
}

const refreshKeyboardOwnership = () => {
  const active = doc.activeElement
  const typing = active !== null && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')
  setKeyboardOwned(typing || !els.confirm.hidden)
}

const updateComposer = () => {
  const ready = state.connection === 'ready'
  els.send.disabled = !ready || (!state.running && els.composer.value.trim().length === 0)
  els.send.replaceChildren(svgIcon(state.running ? 'i-stop' : 'i-send'))
  els.send.setAttribute('aria-label', state.running ? 'Stop' : 'Send')
  els.saveKey.disabled = !ready || els.apiKey.value.trim().length === 0
  els.useProvider.disabled = !ready || state.providers.get(state.selectedProvider) !== true
}

const updateProviderLabel = () => {
  const active = state.activeProvider
  els.providerLabel.textContent = active ? providerNames[active] || active : 'No provider'
  els.tokenCount.textContent = `${state.tokens.toLocaleString()} tokens this chat`
}

const renderProviders = () => {
  els.providers.querySelectorAll('[data-provider]').forEach((card) => {
    const provider = card.getAttribute('data-provider')
    card.setAttribute('aria-checked', String(provider === state.selectedProvider))
  })
  els.providers.querySelectorAll('[data-state-for]').forEach((node) => {
    const provider = node.getAttribute('data-state-for')
    const configured = state.providers.get(provider) === true
    node.textContent = configured
      ? provider === state.activeProvider
        ? 'Key saved · active'
        : 'Key saved'
      : 'No key'
    node.classList.toggle('configured', configured)
  })
  updateComposer()
}

const setHint = (text, kind) => {
  els.keyHint.textContent = text
  els.keyHint.className = kind ? `hint ${kind}` : 'hint'
}

const openSettings = () => {
  els.settings.hidden = false
  renderProviders()
  els.apiKey.focus()
}

const closeSettings = () => {
  els.apiKey.value = ''
  setHint('', '')
  els.settings.hidden = true
  els.composer.focus()
}

const setConnection = (event) => {
  state.connection = event.state
  els.dot.className = `dot ${event.state}`
  if (event.state === 'ready') {
    els.banner.hidden = true
    post({ type: 'keys.status' })
  } else {
    els.banner.hidden = false
    els.banner.classList.toggle('connecting', event.state === 'connecting')
    els.bannerTitle.textContent = connectionTitles[event.state] || 'Companion offline'
    els.bannerDetail.textContent = event.detail || ''
    els.reconnect.hidden = event.state === 'connecting'
    if (state.running) {
      state.running = false
      state.turnId = null
    }
  }
  updateComposer()
}

const assistantMessage = (messageId) => {
  const existing = state.messages.get(messageId)
  if (existing) return existing
  const node = el('div', 'msg assistant')
  const entry = { node, parts: [] }
  state.messages.set(messageId, entry)
  append(node)
  return entry
}

const finishStreaming = () => {
  els.thread.querySelectorAll('.streaming').forEach((node) => node.classList.remove('streaming'))
}

const onDelta = (params) => {
  const entry = assistantMessage(params.messageId)
  entry.parts[params.index] = params.text
  renderMarkdown(entry.node, entry.parts.join(''))
  const last = entry.node.lastElementChild
  const target = last && last.tagName === 'UL' ? last.lastElementChild : last
  if (target) target.classList.add('streaming')
  scrollToEnd()
}

const onMessage = (params) => {
  const entry = assistantMessage(params.messageId)
  entry.parts = [params.text]
  renderMarkdown(entry.node, params.text)
  scrollToEnd()
}

const onDone = (params) => {
  finishStreaming()
  if (params.turnId === state.turnId || state.turnId === null) {
    state.running = false
    state.turnId = null
  }
  const note = endReasonNotes[params.reason]
  if (note) addNote(note)
  updateComposer()
}

const onToolStarted = (params) => {
  const row = el('div', 'tool')
  const icon = svgIcon('i-spinner', 'sm spin')
  const summary = el('span', 'summary', describeInput(params.input))
  const time = el('span', 'time', '…')
  row.append(icon, el('span', 'name', params.name), summary, time)
  state.tools.set(params.callId, { row, icon, summary, time, started: Date.now() })
  append(row)
}

const onToolFinished = (params) => {
  const entry = state.tools.get(params.callId)
  if (!entry) return
  const icon =
    params.status === 'ok'
      ? svgIcon('i-check', 'sm ok')
      : params.status === 'proposed'
        ? svgIcon('i-sliders', 'sm proposed')
        : svgIcon('i-alert', 'sm failed')
  entry.icon.replaceWith(icon)
  entry.summary.textContent = params.summary
  entry.time.textContent = formatDuration(Date.now() - entry.started)
  entry.row.classList.toggle('error', params.status === 'error')
}

const onAnalysis = (params) => {
  const card = el('section', 'card')
  card.setAttribute('aria-label', `${params.analysis} result`)
  const head = el('div', 'card-head')
  head.append(svgIcon('i-meter'), el('span', 'label', params.analysis))
  card.appendChild(head)
  card.appendChild(el('div', '', params.summary))
  const facts = Object.entries(params.data)
    .filter(([, value]) => ['number', 'string', 'boolean'].includes(typeof value))
    .slice(0, 8)
  if (facts.length > 0) {
    const list = el('dl', 'facts')
    facts.forEach(([key, value]) =>
      list.append(el('dt', '', key), el('dd', '', formatValue(value))),
    )
    card.appendChild(list)
  }
  append(card)
}

const selectedRowIds = () =>
  Array.from(els.confirmRows.querySelectorAll('input[type="checkbox"]'))
    .filter((box) => box.checked)
    .map((box) => box.getAttribute('data-row-id'))

const proposalExpired = () =>
  state.proposal !== null && Date.parse(state.proposal.expiresAt) <= Date.now()

const updateConfirmCount = () => {
  const count = selectedRowIds().length
  const plural = count === 1 ? 'change' : 'changes'
  els.confirmTitle.textContent = `Apply ${count} ${plural} to your session?`
  els.confirmApply.textContent = `Apply ${count} ${plural}`
  els.confirmApply.disabled = count === 0 || proposalExpired()
}

const closeConfirm = () => {
  els.confirm.hidden = true
  state.proposal = null
  if (state.proposalTimer !== null) globalThis.clearTimeout(state.proposalTimer)
  state.proposalTimer = null
  refreshKeyboardOwnership()
  els.composer.focus()
}

const onProposed = (params) => {
  state.proposal = params
  els.confirmReason.textContent = params.reason
  els.confirmNote.textContent = 'clogic never edits the project file or audio.'
  els.confirmRows.replaceChildren(
    ...params.rows.map((row) => {
      const item = el('li', 'change')
      const box = el('input')
      box.type = 'checkbox'
      box.checked = true
      box.setAttribute('data-row-id', row.id)
      box.setAttribute('aria-label', `${row.control}, ${row.location}`)
      box.addEventListener('change', () => {
        item.classList.toggle('off', !box.checked)
        updateConfirmCount()
      })
      const what = el('div')
      what.append(el('div', 'what', row.control), el('div', 'where', row.location))
      const diff = el('div', 'diff', formatValue(row.before))
      diff.append(svgIcon('i-arrow', 'sm'), el('b', '', formatValue(row.after)))
      item.append(box, what, diff)
      return item
    }),
  )
  els.confirm.hidden = false
  updateConfirmCount()
  const remaining = Date.parse(params.expiresAt) - Date.now()
  if (Number.isFinite(remaining)) {
    state.proposalTimer = globalThis.setTimeout(
      () => {
        els.confirmNote.textContent = 'This suggestion expired. Ask again to get a fresh one.'
        updateConfirmCount()
      },
      Math.max(0, remaining),
    )
  }
  els.confirmCancel.focus()
  refreshKeyboardOwnership()
}

const decide = (acceptedRowIds) => {
  if (state.proposal === null) return
  post({ type: 'change.decide', proposalId: state.proposal.proposalId, acceptedRowIds })
}

const onApplied = (params) => {
  if (state.proposal !== null && state.proposal.proposalId === params.proposalId) closeConfirm()
  const row = el('div', 'tool')
  const failed = params.failed.length
  row.append(
    svgIcon(failed > 0 ? 'i-alert' : 'i-check', failed > 0 ? 'sm failed' : 'sm ok'),
    el('span', 'name', 'session change'),
    el(
      'span',
      'summary',
      `${params.applied.length} applied, ${params.declined.length} declined, ${failed} failed`,
    ),
  )
  row.classList.toggle('error', failed > 0)
  append(row)
  params.failed.forEach((failure) => addErrorBanner('A change failed', failure.message))
}

const onError = (params) => {
  if (params.turnId !== null && params.turnId === state.turnId) {
    state.running = false
    state.turnId = null
    finishStreaming()
    updateComposer()
  }
  addErrorBanner(params.message, params.code)
}

const notificationHandlers = {
  'chat.delta': onDelta,
  'chat.message': onMessage,
  'chat.done': onDone,
  'tool.started': onToolStarted,
  'tool.finished': onToolFinished,
  'change.proposed': onProposed,
  'change.applied': onApplied,
  'analysis.result': onAnalysis,
  usage: (params) => {
    state.tokens += params.inputTokens + params.outputTokens
    updateProviderLabel()
  },
  error: onError,
}

const applyKeyStatus = (result) => {
  state.providers = new Map(result.providers.map((entry) => [entry.provider, entry.configured]))
  state.activeProvider = result.activeProvider
  if (result.activeProvider) state.selectedProvider = result.activeProvider
  updateProviderLabel()
  renderProviders()
  const anyConfigured = result.providers.some((entry) => entry.configured)
  if (!anyConfigured && els.settings.hidden) openSettings()
}

const responseHandlers = {
  'chat.send': (event) => {
    if (event.ok) {
      state.turnId = event.result.turnId
    } else {
      state.running = false
      addErrorBanner('Message not sent', event.error.message)
    }
    updateComposer()
  },
  'chat.cancel': (event) => {
    if (!event.ok) addErrorBanner('Could not stop the reply', event.error.message)
  },
  'change.decide': (event) => {
    if (!event.ok) {
      els.confirmNote.textContent = event.error.message
      return
    }
    if (event.result.outcome === 'declined') {
      closeConfirm()
      addNote('Suggested changes declined.')
    } else {
      els.confirmApply.disabled = true
      els.confirmNote.textContent = 'Applying…'
    }
  },
  'keys.status': (event) => {
    if (event.ok) applyKeyStatus(event.result)
  },
  'keys.set': (event) => {
    if (event.ok) {
      state.providers.set(event.result.provider, event.result.configured)
      setHint(`${providerNames[event.result.provider]} key saved.`, 'ok')
      post({ type: 'keys.status' })
    } else {
      setHint(event.error.message, 'err')
    }
    renderProviders()
  },
  'provider.select': (event) => {
    if (event.ok) {
      state.activeProvider = event.result.activeProvider
      updateProviderLabel()
      renderProviders()
      closeSettings()
    } else {
      setHint(event.error.message, 'err')
    }
  },
}

const eventHandlers = {
  connection: setConnection,
  context: (event) => {
    els.contextName.textContent = event.contextName || 'No track name'
  },
  notification: (event) => {
    const handler = notificationHandlers[event.method]
    if (handler) handler(event.params)
  },
  response: (event) => {
    const handler = responseHandlers[event.request]
    if (handler) handler(event)
  },
  problem: (event) => addErrorBanner('Something went wrong', event.message),
}

globalThis.clogicReceive = (event) => {
  const handler = eventHandlers[event.type]
  if (handler) handler(event)
}

const sendMessage = () => {
  if (state.running) {
    post({ type: 'chat.cancel', turnId: state.turnId })
    return
  }
  const text = els.composer.value.trim()
  if (text.length === 0 || state.connection !== 'ready') return
  const bubble = el('div', 'msg user')
  bubble.appendChild(el('p', '', text))
  append(bubble)
  els.composer.value = ''
  state.running = true
  state.turnId = null
  updateComposer()
  post({ type: 'chat.send', text })
}

els.composer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    sendMessage()
  } else if (event.key === 'Escape') {
    els.composer.blur()
  }
})
els.composer.addEventListener('input', () => {
  els.composer.style.height = 'auto'
  els.composer.style.height = `${els.composer.scrollHeight}px`
  updateComposer()
})
els.composer.addEventListener('focus', () => els.composerBox.classList.add('focus'))
els.composer.addEventListener('blur', () => els.composerBox.classList.remove('focus'))
els.send.addEventListener('click', sendMessage)
els.reconnect.addEventListener('click', () => post({ type: 'reconnect' }))

els.openSettings.addEventListener('click', openSettings)
els.closeSettings.addEventListener('click', closeSettings)
els.providers.addEventListener('click', (event) => {
  const card = event.target.closest('[data-provider]')
  if (!card) return
  state.selectedProvider = card.getAttribute('data-provider')
  setHint('', '')
  renderProviders()
})
els.apiKey.addEventListener('input', updateComposer)
els.apiKey.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    els.saveKey.click()
  } else if (event.key === 'Escape') {
    closeSettings()
  }
})
els.saveKey.addEventListener('click', () => {
  const key = els.apiKey.value.trim()
  els.apiKey.value = ''
  if (key.length === 0) return
  setHint('Checking…', '')
  post({ type: 'keys.set', provider: state.selectedProvider, key })
  updateComposer()
})
els.useProvider.addEventListener('click', () =>
  post({ type: 'provider.select', provider: state.selectedProvider }),
)

els.confirmCancel.addEventListener('click', () => decide([]))
els.confirmApply.addEventListener('click', () => {
  if (!proposalExpired()) decide(selectedRowIds())
})
els.confirm.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    decide([])
  }
})

doc.addEventListener('focusin', refreshKeyboardOwnership)
doc.addEventListener('focusout', () => globalThis.setTimeout(refreshKeyboardOwnership, 0))

updateComposer()
updateProviderLabel()
post({ type: 'ready' })
