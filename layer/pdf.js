// In-browser rendering of the real résumé / cover-letter templates (nunjucks standing in for Jinja)
// and the browser's print-to-PDF.
import nunjucks from 'nunjucks/browser/nunjucks.js'
import { RESUME_TEMPLATES, COVER_LETTER_TEMPLATES } from './templates.js'

const escapeHtml = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))

// Same as the backend's `bold` filter: escape, then **x** -> <b>x</b>.
const bold = (text) => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

// Jinja -> nunjucks for the few constructs the templates use that nunjucks spells differently.
function toNunjucks(src) {
  return src.replace(/\{[{%][\s\S]*?[}%]\}/g, (tag) => tag
    .replace(/\.startswith\(/g, '.startsWith(')
    .replace(/\.append\(/g, '.push(')
    .replace(/\.items\(\)/g, '')
    .replace(/~/g, '+'))
}

const env = new nunjucks.Environment(null, { autoescape: false })
env.addFilter('bold', bold)

const compiled = {}
function compile(kind, id, sources) {
  const key = `${kind}:${id}`
  if (!compiled[key]) {
    const src = sources[id] ?? Object.values(sources)[0]
    if (src === undefined) throw new Error(`No ${kind} template "${id}"`)
    compiled[key] = new nunjucks.Template(toNunjucks(src), env, key, true)
  }
  return compiled[key]
}

// Mirrors the backend's _render_safe_links: string contact items, no script-capable project / publication links.
const UNSAFE = ['javascript', 'vbscript', 'data', 'file', 'blob']
const text = (v) => (v == null ? '' : typeof v === 'string' ? v : String(v))
function printableLink(url) {
  const m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(text(url).replace(/[\x00-\x20\x7f]/g, '')) // eslint-disable-line no-control-regex
  return m && UNSAFE.includes(m[1].toLowerCase()) ? '' : text(url)
}
// Jinja treats an empty list or dict as false, JS (and so nunjucks) does not: leave those keys out.
function prune(v) {
  if (Array.isArray(v)) return v.map(prune)
  if (v && typeof v === 'object') {
    const out = {}
    for (const [k, x] of Object.entries(v)) {
      const p = prune(x)
      const empty = (Array.isArray(p) && !p.length) || (p && typeof p === 'object' && !Array.isArray(p) && !Object.keys(p).length)
      if (!empty) out[k] = p
    }
    return out
  }
  return v
}

function safeContent(json) {
  const out = {}
  for (const [k, v] of Object.entries(prune(json || {}))) if (!k.startsWith('_')) out[k] = v
  const h = out.header
  if (h && typeof h === 'object' && !Array.isArray(h)) {
    const items = Array.isArray(h.contact_items) ? h.contact_items : []
    out.header = { ...h, contact_items: items.filter((i) => i && typeof i === 'object')
      .map((i) => ({ ...i, text: text(i.text), url: text(i.url) })) }
  }
  for (const key of ['projects', 'publications']) {
    if (Array.isArray(out[key])) out[key] = out[key].map((e) => (e && typeof e === 'object' && e.url ? { ...e, url: printableLink(e.url) } : e))
  }
  return out
}

const fmtOf = (opts) => (opts && opts.pageFormat) || 'letter'

export function renderResumeHtml(templateId, resumeJson, opts) {
  return compile('resume', templateId, RESUME_TEMPLATES)
    .render({ ...safeContent(resumeJson), page_format: fmtOf(opts), fonts_base: '', fonts: {} })
}

export function renderCoverLetterHtml(templateId, letterJson, opts) {
  return compile('letter', templateId, COVER_LETTER_TEMPLATES)
    .render({ ...safeContent(letterJson), page_format: fmtOf(opts), fonts: {} })
}

const FONT_WAIT_MS = 3000

// Page geometry from the template's own CSS: `@page { size: letter|A4; margin: … }`.
const IN = 96   // CSS px per inch
const toPx = (v) => {
  const m = /^([\d.]+)(in|mm|cm|pt|px)?$/.exec(String(v).trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  return { in: n * IN, mm: (n * IN) / 25.4, cm: (n * IN) / 2.54, pt: (n * IN) / 72, px: n }[m[2] || 'px']
}
export function pageGeometry(html) {
  const rule = /@page\s*\{([^}]*)\}/.exec(html)?.[1] || ''
  const a4 = /size:\s*a4/i.test(rule)
  const parts = (/margin:\s*([^;]+);?/.exec(rule)?.[1] || '0.5in').trim().split(/\s+/).map(toPx)
  const [t, r = t, b = t, l = r] = parts
  return { format: a4 ? 'a4' : 'letter', width: a4 ? (210 / 25.4) * IN : 8.5 * IN, height: a4 ? (297 / 25.4) * IN : 11 * IN,
    margin: { top: t, right: r, bottom: b, left: l } }
}

// Where to end a page: at `limit`, unless that cuts through a line of text, then just above that block.
export function cutAt(blocks, limit) {
  let cut = limit
  for (let moved = true; moved;) {
    moved = false
    for (const [top, bottom] of blocks) if (top < cut && bottom > cut && top > 0 && cut - top < limit * 0.6) { cut = top; moved = true }
  }
  return cut
}

const fileName = (html) => {
  const t = (/<title>([^<]*)<\/title>/i.exec(html)?.[1] || 'Document').replace(/&amp;/g, '&').trim()
  return `${t.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, 120) || 'Document'}.pdf`
}

// Render `html` in a hidden frame at print width and save it straight to a PDF file
// (no print dialog). Pages are cut between lines, never through them. Returns true on success.
export async function printHtml(html) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const g = pageGeometry(html)
  const contentW = g.width - g.margin.left - g.margin.right
  const contentH = g.height - g.margin.top - g.margin.bottom
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${Math.ceil(contentW)}px;height:${Math.ceil(contentH)}px;border:0`
  document.body.appendChild(frame)
  try {
    const doc = frame.contentWindow.document
    // the templates' print rules: margins come from @page, so the .page box drops its padding
    doc.open(); doc.write(html.replace('</head>', '<style>.page{width:auto!important;padding:0!important;margin:0!important}html,body{margin:0!important}</style></head>')); doc.close()
    try { await Promise.race([doc.fonts?.ready, new Promise((r) => setTimeout(r, FONT_WAIT_MS))]) } catch { /* render anyway */ }
    const body = doc.body
    // grow the frame to the whole document first, so nothing below the first screen is clipped
    const total = Math.ceil(Math.max(body.scrollHeight, doc.documentElement.scrollHeight))
    frame.style.height = `${total}px`
    await new Promise((r) => setTimeout(r, 50))
    const scale = 2
    // the canvas belongs to the frame's document, so text is drawn with the template's own web fonts
    // (a canvas from this page would fall back to Arial and the word spacing would drift)
    const target = doc.createElement('canvas')
    target.width = Math.ceil(contentW * scale); target.height = Math.ceil(total * scale)
    target.style.width = `${Math.ceil(contentW)}px`; target.style.height = `${total}px`
    const canvas = await html2canvas(body, { canvas: target, scale, backgroundColor: '#ffffff', windowWidth: Math.ceil(contentW), windowHeight: total,
      width: Math.ceil(contentW), height: total, x: 0, y: 0, scrollX: 0, scrollY: 0, logging: false, useCORS: true })
    const blocks = [...body.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,tr,span,a,div')]
      .filter((el) => !el.querySelector('p,li,div,tr'))
      .map((el) => { const r = el.getBoundingClientRect(); return [r.top, r.bottom] })
      .filter(([t, b]) => b > t)
    const pdf = new jsPDF({ unit: 'px', format: g.format, hotfixes: ['px_scaling'] })
    const pw = pdf.internal.pageSize.getWidth()
    const k = pw / g.width   // CSS px -> PDF units
    let y = 0
    let first = true
    while (y < total - 1) {
      const end = total - y <= contentH ? total : cutAt(blocks.map(([t, b]) => [t - y, b - y]), contentH) + y
      const h = Math.max(1, end - y)
      const slice = document.createElement('canvas')
      slice.width = canvas.width; slice.height = Math.ceil(h * scale)
      const ctx = slice.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, slice.width, slice.height)
      ctx.drawImage(canvas, 0, Math.floor(y * scale), canvas.width, slice.height, 0, 0, canvas.width, slice.height)
      if (!first) pdf.addPage()
      first = false
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', g.margin.left * k, g.margin.top * k, contentW * k, h * k)
      y = end
    }
    pdf.save(fileName(html))
    return true
  } catch (e) {
    console.error(e)
    throw e
  } finally {
    frame.remove()
  }
}

export function blobText(b) {
  if (typeof b === 'string') return Promise.resolve(b)
  if (b && typeof b.text === 'function') return b.text()
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(b) })
}
