import { describe, it, expect, beforeEach } from 'vitest'
import fixture from '../demo/fixture.json'
import { handle } from '../demo/server.js'
import { loadStore, getStore } from '../demo/store.js'
import { registerAll } from '../demo/routes/index.js'
import { clearRuns } from '../demo/routes/monitor.js'
import { htmlToText } from '../demo/routes/prep.js'

beforeEach(() => {
  localStorage.clear()
  clearRuns()
  loadStore(fixture, 'test')
  registerAll()
})

describe('prep handover', () => {
  it('assembles role, résumé, posting and the ask', async () => {
    const r = await handle('GET', '/api/applications/app-1/prep')
    expect(r.status).toBeLessThan(400)
    const t = r.data.text
    expect(t).toMatch(/^# .+ at .+/)
    expect(t).toContain('## The role')
    expect(t).toContain('## My résumé')
    expect(t).toContain('## The posting')
    expect(t).toContain('Shape the member app experience.')
    expect(t).toContain('## What I need from you')
  })
  it('404s an unknown application', async () => {
    expect((await handle('GET', '/api/applications/nope/prep')).status).toBe(404)
  })
  it('turns HTML descriptions into plain text', () => {
    const t = htmlToText('<h3><strong>About</strong></h3><p>One.</p><ul><li>A</li><li>B</li></ul>')
    expect(t).not.toMatch(/</)
    expect(t).toContain('- A')
    expect(t).toContain('One.')
  })
})

describe('cached page fallback', () => {
  it('renders an HTML description instead of showing its tags', async () => {
    const s = getStore()
    const j = s.get('jobs')[0]
    s.put('jobs', j.id, { ...j, description: '<h3><strong>About Us</strong></h3><p>Hello <script>x()</script>world</p>' })
    const r = await handle('GET', `/api/jobs/${j.id}/cached-page`)
    expect(r.data).toContain('<h3><strong>About Us</strong></h3>')
    expect(r.data).not.toContain('&lt;h3')
    expect(r.data).not.toContain('<script')
  })
})
