// GET /applications/:id/prep — the interview prep handover. Same assembly as the backend's
// prep_bundle(): no AI involved, just role + résumé + posting + the "What I need from you" ask.
import { route } from '../server.js'
import { notFound } from './util.js'

// Port of backend/analyzer/cv_scorer.py _flatten_resume().
export function flattenResume(d) {
  if (!d) return ''
  const parts = []
  const h = d.header || {}
  if (h.name) parts.push(String(h.name))
  const contact = ['email', 'phone', 'linkedin', 'github', 'website', 'location'].map((k) => h[k]).filter(Boolean)
  if (contact.length) parts.push(contact.join(' | '))
  if (d.summary) parts.push('## Summary', String(d.summary))
  if ((d.experience || []).length) {
    parts.push('## Experience')
    for (const e of d.experience) {
      if (typeof e !== 'object' || !e) { parts.push(String(e)); continue }
      const line = `${e.title || ''} at ${e.company || ''} (${e.date || e.dates || ''})`.replace(/^[\s()]+|[\s()]+$/g, '')
      if (line) parts.push(e.location ? `${line} — ${e.location}` : line)
      if (e.description) parts.push(e.description)
      for (const b of e.bullets || []) parts.push(`- ${b}`)
    }
  }
  const sk = d.skills
  if (sk && (Array.isArray(sk) ? sk.length : Object.keys(sk).length)) {
    parts.push('## Skills')
    if (Array.isArray(sk)) parts.push(sk.join(', '))
    else for (const [cat, items] of Object.entries(sk)) parts.push(`${cat}: ${Array.isArray(items) ? items.join(', ') : items}`)
  }
  if ((d.education || []).length) {
    parts.push('## Education')
    for (const e of d.education) {
      if (typeof e !== 'object' || !e) { parts.push(String(e)); continue }
      const tail = [e.location, e.years || e.year].filter(Boolean).join(' ')
      parts.push(`${e.degree || ''} — ${e.school || ''}, ${tail}`.replace(/^[\s—,]+|[\s—,]+$/g, ''))
    }
  }
  if ((d.projects || []).length) {
    parts.push('## Projects')
    for (const p of d.projects) {
      if (typeof p !== 'object' || !p) { parts.push(String(p)); continue }
      const line = `${p.name || ''}: ${p.description || ''}`.replace(/^[\s:]+|[\s:]+$/g, '')
      if (line) parts.push(line)
      for (const b of p.bullets || []) parts.push(`- ${b}`)
    }
  }
  return parts.filter(Boolean).join('\n')
}

// Saved descriptions are HTML; the handover wants plain text.
export function htmlToText(s) {
  if (!/<[a-z][^>]*>/i.test(s || '')) return String(s || '')
  const doc = new DOMParser().parseFromString(String(s), 'text/html')
  doc.querySelectorAll('script,style').forEach((n) => n.remove())
  doc.querySelectorAll('li').forEach((n) => n.prepend('- '))
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'))
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,ul,ol,tr').forEach((n) => n.append('\n'))
  return (doc.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const money = (lo, hi) => {
  const k = (v) => `$${Math.round(v / 1000)}K`
  if (lo && hi && lo !== hi) return `${k(lo)}–${k(hi)}`
  return lo || hi ? k(lo || hi) : null
}
const when = (iso) => {
  if (!iso) return 'unscheduled'
  const t = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${t.toLocaleDateString('en-GB', { weekday: 'short' })} ${p(t.getDate())} ${t.toLocaleDateString('en-GB', { month: 'short' })} ${t.getFullYear()}, ${p(t.getHours())}:${p(t.getMinutes())}`
}

export function prepText(store, a) {
  const settings = store.get('settings') || {}
  const inc = new Set(String(settings.prep_include || 'resume,posting,notes').split(',').map((x) => x.trim()).filter(Boolean))
  const job = store.find('jobs', a.job_id)
  const title = job?.title || a.title || 'Unknown Role'
  const company = job?.company || a.company || 'Unknown Company'
  const L = [`# ${title} at ${company}`, '', '## The role', `- Company: ${company}`, `- Title: ${title}`]
  if (job) {
    if (job.location) L.push(`- Location: ${job.location}${job.remote ? ' (remote)' : ''}`)
    const sal = money(job.salary_min, job.salary_max)
    if (sal) L.push(`- Listed salary: ${sal}`)
    if (job.url) L.push(`- Posting: ${job.url}`)
  }
  L.push(`- Stage: ${(a.status || 'applied').replace(/^./, (c) => c.toUpperCase())}`)
  if ((a.interviews || []).length) {
    L.push('- Interviews booked:')
    for (const iv of a.interviews) {
      let row = `  - ${iv.what} — ${when(iv.when_at)}${iv.where_text ? ' · ' + iv.where_text : ''} (${iv.status || 'scheduled'})`
      if (iv.prep) row += `\n    prep note: ${iv.prep}`
      L.push(row)
    }
  }
  if (a.notes && inc.has('notes')) L.push(`- My notes on this application: ${a.notes.split(/\s+/).join(' ').trim()}`)

  const resumes = store.get('resumes') || []
  const tailored = resumes.filter((r) => !r.is_base && String(r.job_id) === String(a.job_id))
    .sort((x, y) => String(y.updated_at || '').localeCompare(String(x.updated_at || '')))[0]
  const cvName = tailored?.name || a.cv_version_used || job?.best_cv || null
  const src = tailored || resumes.find((r) => r.name === cvName)
  if (inc.has('resume')) {
    L.push('', `## My résumé${cvName ? ' — ' + cvName : ''}`)
    const body = (src ? flattenResume(src.json_data) : '').trim() || '[résumé content unavailable]'
    L.push(body.split('\n').map((ln) => (ln.startsWith('##') ? '#' + ln : ln)).join('\n'))
  }
  if (inc.has('posting')) L.push('', '## The posting', htmlToText(job?.description || '').trim() || '[no posting text was captured]')
  L.push('', '## What I need from you', String(settings.prep_ask || '').trim() || 'Prepare me for this interview.')
  return L.join('\n')
}

export function register() {
  route('GET', '/applications/:id/prep', ({ store, params }) => {
    const a = store.find('applications', params.id)
    return a ? { data: { text: prepText(store, a) } } : notFound('Application')
  })
}
