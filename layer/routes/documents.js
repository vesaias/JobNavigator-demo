// /resumes/:id/pdf|docx and /cover-letters/:id/pdf. The "PDF" is the rendered template HTML: the editors
// preview it in an iframe and Download turns it into a PDF file in the browser (see pdf.js).
import { route } from '../server.js'
import { notFound } from './util.js'
import { renderResumeHtml, renderCoverLetterHtml } from '../pdf.js'

const html = (s) => new Blob([s], { type: 'text/html' })
// Same rules as the backend's _resume_download_name and _resume_footer_text.
const headerName = (r) => String(r.json_data?.header?.name || '').trim()
export function downloadName(r, job) {
  const base = String((r.name || '').split(' → ')[0] || 'Resume').replace(/ /g, '')
  const n = (headerName(r) || 'Resume').replace(/ /g, '')
  return `${n}_${base}_Resume${job?.short_id ? '_' + job.short_id : ''}`.replace(/["\\\u0000-\u001f\u007f]/g, '')
}
export function footerText(r, job) {
  if (r.json_data?.footer_enabled !== true || r.is_base || !r.job_id || !job) return ''
  const parts = [headerName(r), String(job.title || '').trim(), String(job.company || '').trim()]
  return parts.every(Boolean) ? parts.join(' - ') : ''
}

export function register() {
  route('GET', '/resumes/:id/pdf', ({ store, params, query }) => {
    const r = store.find('resumes', params.id)
    if (!r) return notFound('Resume')
    return { data: html(renderResumeHtml(query.template || r.template, r.json_data || {}, { pageFormat: query.format || r.page_format })) }
  })

  route('GET', '/cover-letters/:id/pdf', ({ store, params }) => {
    const c = store.find('cover_letters', params.id)
    if (!c) return notFound('Cover letter')
    return { data: html(renderCoverLetterHtml(c.template, c.json_data || {}, { pageFormat: c.page_format })) }
  })

  // Word, built in the browser from the résumé as it is now (copies and edits included).
  route('GET', '/resumes/:id/docx', async ({ store, params, query }) => {
    const r = store.find('resumes', params.id)
    if (!r) return notFound('Resume')
    const { buildDocx } = await import('../docx.js')
    const job = r.job_id ? store.find('jobs', r.job_id) : null
    const blob = await buildDocx(r.json_data || {}, query.format || r.page_format || 'letter', footerText(r, job))
    return { data: blob, headers: { 'content-disposition': `attachment; filename="${downloadName(r, job)}.docx"` } }
  })
}
