import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { labelOf, onDemoRequest, track } from '../demo/analytics.js'

let calls
beforeEach(() => { calls = []; window.umami = { track: (...a) => calls.push(a) } })
afterEach(() => { delete window.umami; document.body.innerHTML = '' })

describe('demo analytics', () => {
  it('labels a control by its own name, never by what was typed', () => {
    document.body.innerHTML = '<input aria-label="Search titles" value="my secret"><button>↓ Download</button>'
    expect(labelOf(document.querySelector('input'))).toBe('Search titles')
    expect(labelOf(document.querySelector('button'))).toBe('↓ Download')
  })
  it('reports writes and downloads, skips ordinary reads', () => {
    onDemoRequest('GET', '/jobs', 200)
    onDemoRequest('POST', '/analyze/:id', 202)
    onDemoRequest('GET', '/resumes/:id/docx', 200)
    onDemoRequest('PATCH', '/settings', 403)
    expect(calls.map((c) => c[0])).toEqual(['action', 'action', 'blocked'])
    expect(calls[0][1]).toMatchObject({ method: 'POST', route: '/analyze/:id', status: 202 })
  })
  it('never throws when Umami is missing', () => {
    delete window.umami
    expect(() => track('click', {})).not.toThrow()
  })
})
