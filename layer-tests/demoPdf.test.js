import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import fixture from '../demo/fixture.json'
import { RESUME_TEMPLATES, COVER_LETTER_TEMPLATES } from '../demo/templates.js'
import { renderResumeHtml, renderCoverLetterHtml, pageGeometry, cutAt } from '../demo/pdf.js'
import { clearRoutes, handle } from '../demo/server.js'
import { loadStore } from '../demo/store.js'
import { register } from '../demo/routes/documents.js'

const resume = fixture.resumes[0].json_data
const letter = {
  header: { name: 'Daniel Smith', contact_items: [{ text: 'daniel@example.com', url: 'mailto:daniel@example.com' }, { text: 'Austin, TX', url: '' }] },
  date: 'October 19, 2026', recipient: { manager: 'Hiring Manager', company: 'Acme', address: '1 Main St' },
  greeting: 'Dear Hiring Manager,', body_paragraphs: ['I **led** growth at Foo & Bar.', 'Second paragraph.'],
  closing: 'Sincerely,', signature: 'Daniel Smith',
}

describe('demo templates', () => {
  it('bundles the tracked templates without Garamond', () => {
    expect(Object.keys(RESUME_TEMPLATES).sort()).toEqual(['garamond_alt', 'helvetica', 'inter', 'modern', 'montserrat', 'palatino', 'raleway', 'traditional'])
    expect(Object.keys(COVER_LETTER_TEMPLATES)).not.toContain('garamond')
    expect(Object.keys(COVER_LETTER_TEMPLATES).length).toBeGreaterThan(0)
  })

  it.each(Object.keys(RESUME_TEMPLATES))('renders the fixture résumé with %s', (id) => {
    const html = renderResumeHtml(id, resume, { pageFormat: 'letter' })
    expect(html).toContain(resume.header.name)
    expect(html).toContain(resume.experience[0].title)
    if (process.env.DEMO_PARITY_OUT) {
      mkdirSync(process.env.DEMO_PARITY_OUT, { recursive: true })
      writeFileSync(`${process.env.DEMO_PARITY_OUT}/resume_${id}.html`, html)
    }
  })

  it.each(Object.keys(COVER_LETTER_TEMPLATES))('renders a letter with %s', (id) => {
    const html = renderCoverLetterHtml(id, letter, { pageFormat: 'a4' })
    expect(html).toContain('Dear Hiring Manager,')
    expect(html).toContain('<b>led</b> growth at Foo &amp; Bar.')
    if (process.env.DEMO_PARITY_OUT) {
      mkdirSync(process.env.DEMO_PARITY_OUT, { recursive: true })
      writeFileSync(`${process.env.DEMO_PARITY_OUT}/letter_${id}.html`, html)
      writeFileSync(`${process.env.DEMO_PARITY_OUT}/letter.json`, JSON.stringify(letter))
    }
  })

  it('drops script-capable project links and private keys', () => {
    const html = renderResumeHtml('inter', { ...resume, _score: 'SECRETKEY', projects: [{ name: 'P', url: 'java\tscript:alert(1)' }] }, {})
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('SECRETKEY')
  })
})

describe('pdf download geometry', () => {
  it('reads size and margins from @page', () => {
    const g = pageGeometry('<style>@page { size: A4; margin: 0.5in 0.55in; }</style>')
    expect(g.format).toBe('a4')
    expect(g.margin.top).toBeCloseTo(48)
    expect(g.margin.left).toBeCloseTo(52.8)
    expect(pageGeometry('<style>@page { size: letter; margin: 0.7in; }</style>').width).toBeCloseTo(816)
  })
  it('cuts pages between lines, never through one', () => {
    expect(cutAt([[0, 20], [90, 110]], 100)).toBe(90)
    expect(cutAt([[0, 20], [40, 60]], 100)).toBe(100)
  })
})

describe('document routes', () => {
  it('serves the rendered résumé and 404s an unknown id', async () => {
    loadStore(fixture, 'test'); clearRoutes(); register()
    const ok = await handle('GET', `/api/resumes/${fixture.resumes[0].id}/pdf?template=helvetica&format=a4`)
    expect(ok.status).toBe(200)
    expect(ok.data.type).toBe('text/html')
    expect((await handle('GET', '/api/resumes/nope/pdf')).status).toBe(404)
  })
})
