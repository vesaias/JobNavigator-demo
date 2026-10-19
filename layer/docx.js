// An editable Word résumé built in the browser from the résumé's JSON, so copies and edits
// download too. Port of the backend's _build_docx (routes_resumes.py): same section order,
// sizes, margins, right-aligned dates, bullet lists and contact links.
import {
  AlignmentType, Document, ExternalHyperlink, Footer, HeadingLevel, Packer, Paragraph, TabStopType, TextRun,
} from 'docx'

const TWIP = 1440   // per inch
const SCHEMES = ['http', 'https', 'mailto', 'tel']

export function docxHref(url) {
  const u = String(url || '').trim()
  if (!u) return null
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(u)
  if (m) return SCHEMES.includes(m[1].toLowerCase()) ? u : null
  if (u.split('/')[0].includes('@')) return `mailto:${u}`
  if (/^\+?[\d\s().-]{7,}$/.test(u)) return `tel:${u.replace(/[^\d+]/g, '')}`
  return `https://${u}`
}

// `**bold**` markup, as the templates' `bold` filter reads it.
const runs = (value, bold = false, size) => String(value ?? '').split(/\*\*(.+?)\*\*/)
  .map((part, i) => (part ? new TextRun({ text: part, bold: bold || i % 2 === 1, size }) : null)).filter(Boolean)

export function buildDocxDocument(data, fmt, footerText = '') {
  data = data || {}
  const a4 = String(fmt || '').toLowerCase() === 'a4'
  const width = a4 ? 11906 : 8.5 * TWIP
  const height = a4 ? 16838 : 11 * TWIP
  const margin = 0.7 * TWIP
  const bodyWidth = width - 2 * margin
  const header = data.header && typeof data.header === 'object' ? data.header : {}
  const candidate = String(header.name || '').trim()
  const items = (key) => (Array.isArray(data[key]) ? data[key] : []).filter((i) => i && typeof i === 'object')
  const out = []
  const para = (children, opts = {}) => out.push(new Paragraph({ children, ...opts }))
  const heading = (t) => out.push(new Paragraph({ text: t, heading: HeadingLevel.HEADING_2 }))
  const row = (left, right = '') => para([...runs(left, true), ...(right ? [new TextRun({ text: `\t${right}` })] : [])],
    { tabStops: [{ type: TabStopType.RIGHT, position: bodyWidth }] })
  const link = (label, url) => {
    const href = docxHref(url)
    return href ? new ExternalHyperlink({ link: href, children: [new TextRun({ text: label, style: 'Hyperlink' })] }) : runs(label)
  }
  const details = (item) => {
    if (item.description) para(runs(item.description))
    for (const b of item.bullets || []) para(runs(b), { bullet: { level: 0 } })
  }

  para([new TextRun({ text: candidate, bold: true, size: 40 })])
  if (header.title) para(runs(header.title))
  const contacts = (header.contact_items || []).filter((c) => c && typeof c === 'object' && (c.text || c.url))
  if (contacts.length) {
    const children = []
    contacts.forEach((c, i) => {
      if (i) children.push(new TextRun(' | '))
      const r = c.url ? link(String(c.text || c.url), c.url) : runs(c.text)
      children.push(...(Array.isArray(r) ? r : [r]))
    })
    para(children)
  }
  if (data.summary) para(runs(data.summary))
  if (items('experience').length) {
    heading('Experience')
    for (const j of items('experience')) {
      row(`${j.title || ''}${j.company ? ' at ' + j.company : ''}`, j.date || j.dates || '')
      if (j.location) para([new TextRun(String(j.location))])
      details(j)
    }
  }
  const skills = data.skills
  const pairs = !skills ? [] : Array.isArray(skills)
    ? skills.filter((s) => s && typeof s === 'object').map((s) => [s.category, s.items])
    : Object.entries(skills)
  if (pairs.length) {
    heading('Skills')
    for (const [label, value] of pairs) {
      para([...(label ? runs(`${label}: `, true) : []), ...runs(Array.isArray(value) ? value.join(', ') : value)])
    }
  }
  if (items('education').length) {
    heading('Education')
    for (const e of items('education')) {
      row(e.school || '', e.location || '')
      if (e.degree) para(runs(e.degree))
    }
  }
  for (const [key, title] of [['projects', 'Projects'], ['publications', 'Publications']]) {
    if (!items(key).length) continue
    heading(title)
    for (const it of items(key)) {
      row(it.name || it.title || '')
      if (it.url) { const l = link(String(it.url), it.url); para(Array.isArray(l) ? l : [l]) }
      details(it)
    }
  }

  return new Document({
    creator: candidate, lastModifiedBy: candidate, title: candidate ? `${candidate} résumé` : 'Résumé', description: '',
    styles: {
      default: { document: { run: { size: 21 } } },
      paragraphStyles: [{ id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, color: '000000' }, paragraph: { spacing: { before: 240, after: 80 } } }],
    },
    sections: [{
      properties: { page: { size: { width, height }, margin: { top: margin, bottom: margin, left: margin, right: margin } } },
      footers: footerText ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: footerText, size: 16, color: '999999' })] })] }) } : undefined,
      children: out,
    }],
  })
}

export const buildDocx = (data, fmt, footerText) => Packer.toBlob(buildDocxDocument(data, fmt, footerText))
