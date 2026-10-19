import { describe, it, expect } from 'vitest'
import { clearBrowserState } from '../demo/store.js'

describe('Reset demo', () => {
  it("clears the app's saved choices and cookies, and leaves other sites' keys alone", () => {
    localStorage.setItem('jobnavigator_appearance', 'dark')
    localStorage.setItem('v2_feed_filters', '{}')
    localStorage.setItem('jn:welcome', '1')
    localStorage.setItem('company_sort', 'name')
    sessionStorage.setItem('jn:switched', '1')
    localStorage.setItem('other_site_key', 'keep')
    document.cookie = 'jn_account=x; path=/'
    clearBrowserState()
    expect(localStorage.getItem('jobnavigator_appearance')).toBeNull()
    expect(localStorage.getItem('v2_feed_filters')).toBeNull()
    expect(localStorage.getItem('jn:welcome')).toBeNull()
    expect(localStorage.getItem('company_sort')).toBeNull()
    expect(sessionStorage.getItem('jn:switched')).toBeNull()
    expect(localStorage.getItem('other_site_key')).toBe('keep')
    expect(document.cookie).not.toContain('jn_account')
  })
})
