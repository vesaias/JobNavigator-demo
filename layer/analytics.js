// Umami analytics for the demo (self-hosted at a.viktoresadze.com). No cookies; nothing typed by a
// visitor is ever sent — only what they clicked (the control's own label), which screen they were on,
// and which demo action ran. Off when WEBSITE_ID is empty or the page is not the published site.
//
// EVENTS — name: data
//   click      screen, kind (button|link|menuitem|option|tab|switch|checkbox|select|input|row|other), label
//   dead-click screen, tag, label        a click on something that is not a control (what people expect to work)
//   action     screen, method, route, status   every write the demo server answers, plus downloads / prep / snapshots
//   blocked    screen, method, route     a write the demo refuses ("Disabled in the demo")
//   key        screen, key               feed keyboard shortcuts (j/k/s/x/e/o/f/g, arrows, Enter)
//   session    theme, width, returning   once per load
// Page views come from Umami's own auto-track (History API routes included).

const HOST = 'https://a.viktoresadze.com'
export const WEBSITE_ID = ''                       // Umami → Settings → Websites → JobNavigator demo
const DOMAINS = 'vesaias.github.io'                 // never report local builds
const MAX_EVENTS = 400                              // per page load, so a stuck loop can't flood the server

let sent = 0
export function track(name, data) {
  if (sent >= MAX_EVENTS) return
  try {
    if (window.umami && typeof window.umami.track === 'function') { window.umami.track(name, data); sent++ }
  } catch { /* analytics must never break the demo */ }
}

const base = () => (import.meta.env && import.meta.env.BASE_URL) || '/'
export function screen() {
  const path = window.location.pathname.replace(base().replace(/\/$/, ''), '') || '/'
  return '/' + (path.split('/').filter(Boolean)[0] || 'feed')
}

const clip = (s, n = 48) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
const CONTROL = 'button,a[href],[role=button],[role=menuitem],[role=option],[role=tab],[role=switch],[role=checkbox],[role=radio],input,select,textarea,summary,label'

function kindOf(el) {
  const role = el.getAttribute('role')
  if (role) return { menuitem: 'menuitem', option: 'option', tab: 'tab', switch: 'switch', checkbox: 'checkbox', radio: 'checkbox' }[role] || 'button'
  const tag = el.tagName.toLowerCase()
  if (tag === 'a') return 'link'
  if (tag === 'input') return el.type === 'checkbox' || el.type === 'radio' ? 'checkbox' : 'input'
  if (tag === 'select') return 'select'
  if (tag === 'textarea') return 'input'
  return tag === 'button' ? 'button' : 'other'
}

// The control's own name: aria-label, title, else its visible text. Fields report only their name, never a value.
export function labelOf(el) {
  const kind = kindOf(el)
  if (kind === 'input' || kind === 'select') return clip(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.tagName)
  return clip(el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.textContent || el.tagName)
}

function onClick(e) {
  const t = e.target instanceof Element ? e.target : null
  if (!t) return
  const el = t.closest(CONTROL)
  if (el) { track('click', { screen: screen(), kind: kindOf(el), label: labelOf(el) }); return }
  // rows and cards that open something are divs with a click handler; report the row's first line
  const row = t.closest('[style*="cursor: pointer"],[class*="row"],[class*="card"]')
  if (row) { track('click', { screen: screen(), kind: 'row', label: clip((row.innerText || '').split('\n')[0]) }); return }
  track('dead-click', { screen: screen(), tag: t.tagName.toLowerCase(), label: clip((t.innerText || '').split('\n')[0], 32) })
}

const SHORTCUTS = new Set(['j', 'k', 's', 'x', 'e', 'o', 'f', 'g', 'ArrowDown', 'ArrowUp', 'Enter'])
function onKey(e) {
  if (screen() !== '/feed' || e.ctrlKey || e.metaKey || e.altKey || !SHORTCUTS.has(e.key)) return
  const t = e.target
  if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return
  track('key', { screen: '/feed', key: e.key })
}

// Called by the demo server for each request it answers.
const INTERESTING_GET = /\/(pdf|docx|prep|cached-page)$/
export function onDemoRequest(method, route, status) {
  if (method === 'GET' && !INTERESTING_GET.test(route)) return
  track(status === 403 ? 'blocked' : 'action', { screen: screen(), method, route, status })
}

export function installAnalytics() {
  if (!WEBSITE_ID || typeof document === 'undefined') return
  const s = document.createElement('script')
  s.defer = true
  s.src = `${HOST}/s.js`
  s.setAttribute('data-website-id', WEBSITE_ID)
  s.setAttribute('data-host-url', HOST)
  s.setAttribute('data-domains', DOMAINS)
  s.addEventListener('load', () => {
    let returning = false
    try { returning = !!localStorage.getItem('jn_demo_state_v1') } catch { /* private window */ }
    track('session', { theme: document.documentElement.getAttribute('data-appearance') || 'system',
      width: window.innerWidth < 700 ? 'phone' : window.innerWidth < 1100 ? 'tablet' : 'desktop', returning })
  })
  document.head.appendChild(s)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
}
