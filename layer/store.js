// Edit layer of the demo: prepared data plus whatever the visitor changed,
// persisted in localStorage (key jn_demo_state_v1) and falling back to memory
// when storage is unavailable. A different `version` discards stored state.
export const STORAGE_KEY = 'jn_demo_state_v1'

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const same = (a, b) => String(a) === String(b)

let current = null

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function loadStore(seed, version) {
  const stored = readStored()
  let data = stored && stored.version === version && stored.data ? stored.data : clone(seed || {})

  const save = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version, data })) } catch { /* memory only */ }
  }

  const store = {
    version,
    // a collection is an array of rows (each with an id); anything else is returned as stored
    get(collection) { return data[collection] === undefined ? [] : data[collection] },
    find(collection, id) {
      const rows = data[collection]
      return Array.isArray(rows) ? rows.find((r) => same(r.id, id)) : undefined
    },
    put(collection, id, row) {
      if (!Array.isArray(data[collection])) data[collection] = []
      const rows = data[collection]
      const next = { ...row, id: row?.id ?? id }
      const i = rows.findIndex((r) => same(r.id, id))
      if (i >= 0) rows[i] = next; else rows.push(next)
      save()
      return next
    },
    remove(collection, id) {
      const rows = data[collection]
      if (!Array.isArray(rows)) return
      data[collection] = rows.filter((r) => !same(r.id, id))
      save()
    },
    // replace a whole value (non-collection keys such as settings)
    set(key, value) { data[key] = value; save() },
    reset() {
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      data = clone(seed || {})
    },
  }
  current = store
  return store
}

export const getStore = () => current
export function resetStore() { if (current) current.reset() }

// The app's own browser keys (theme, filters, sort, panels, welcome tour, rail…). Other Pages sites share
// this origin (vesaias.github.io), so only these prefixes are removed, never everything.
const APP_KEY = /^(jn[:_]|jobnavigator_|jobhunter_|v2_|company_)/
export function clearBrowserState() {
  for (const st of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const s = st()
      for (const k of Object.keys(s)) if (APP_KEY.test(k)) s.removeItem(k)
    } catch { /* storage blocked */ }
  }
  try {
    const paths = ['/', (import.meta.env && import.meta.env.BASE_URL) || '/']
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim()
      if (!name) continue
      for (const path of paths) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`
    }
  } catch { /* cookies blocked */ }
}
