import { describe, expect, it } from 'vitest'
import { AUTH_STORAGE_KEY, createAuthStorage, REMEMBER_DURATION_MS } from './sessionStorage'

function memory() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}

function setup() {
  const local = memory()
  const session = memory()
  let time = 1_000_000
  const options = { local, session, now: () => time }
  return { local, session, options, auth: createAuthStorage(options), advance: (ms: number) => { time += ms } }
}

describe('remember-me authentication storage', () => {
  it('keeps unchecked credentials only for the browser session', () => {
    const test = setup()
    test.auth.prepareSignIn(false)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'temporary-token')
    expect(test.local.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(test.auth.storage.getItem(AUTH_STORAGE_KEY)).toBe('temporary-token')
    const newBrowserSession = createAuthStorage({ ...test.options, session: memory() })
    expect(newBrowserSession.storage.getItem(AUTH_STORAGE_KEY)).toBeNull()
  })

  it('restores remembered login after reopening the browser', () => {
    const test = setup()
    test.auth.prepareSignIn(true)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'remembered-token')
    const reopened = createAuthStorage({ ...test.options, session: memory() })
    expect(reopened.storage.getItem(AUTH_STORAGE_KEY)).toBe('remembered-token')
    expect(reopened.getRememberExpiry()).toBe(1_000_000 + REMEMBER_DURATION_MS)
  })

  it('expires at exactly 40 days and refresh cannot extend or resurrect it', () => {
    const test = setup()
    test.auth.prepareSignIn(true)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'first-token')
    const deadline = test.auth.getRememberExpiry()
    test.advance(REMEMBER_DURATION_MS - 1)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'refreshed-token')
    expect(test.auth.getRememberExpiry()).toBe(deadline)
    expect(test.auth.storage.getItem(AUTH_STORAGE_KEY)).toBe('refreshed-token')
    test.advance(1)
    expect(test.auth.isAuthExpired()).toBe(true)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'late-refresh')
    expect(test.auth.storage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(test.local.getItem(AUTH_STORAGE_KEY)).toBeNull()
  })

  it('rejects an expired login when the application is reopened', () => {
    const test = setup()
    test.auth.prepareSignIn(true)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'token')
    test.advance(REMEMBER_DURATION_MS)
    expect(createAuthStorage(test.options).storage.getItem(AUTH_STORAGE_KEY)).toBeNull()
  })

  it('clears remembered credentials when switching to an unchecked login', () => {
    const test = setup()
    test.auth.prepareSignIn(true)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'persistent')
    test.auth.prepareSignIn(false)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'temporary')
    expect(test.local.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(test.auth.getRememberExpiry()).toBeNull()
    expect(test.session.getItem(AUTH_STORAGE_KEY)).toBe('temporary')
  })

  it('removes all credentials and deadline on logout', () => {
    const test = setup()
    test.auth.prepareSignIn(true)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'token')
    test.auth.clearAuthStorage()
    expect(test.auth.storage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(test.auth.getRememberExpiry()).toBeNull()
  })

  it('does not restore persistent credentials with missing or malformed deadline', () => {
    const test = setup()
    test.local.setItem(AUTH_STORAGE_KEY, 'orphan-token')
    expect(test.auth.storage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    test.local.setItem(AUTH_STORAGE_KEY, 'malformed-token')
    test.local.setItem(`${AUTH_STORAGE_KEY}.expires`, 'broken')
    expect(createAuthStorage(test.options).storage.getItem(AUTH_STORAGE_KEY)).toBeNull()
  })

  it('never promotes a temporary login when another tab remembers its login', () => {
    const test = setup()
    test.auth.prepareSignIn(false)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'tab-a-temporary')
    const otherTab = createAuthStorage({ ...test.options, session: memory() })
    otherTab.prepareSignIn(true)
    otherTab.storage.setItem(AUTH_STORAGE_KEY, 'tab-b-remembered')

    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'tab-a-refreshed')

    expect(test.auth.storage.getItem(AUTH_STORAGE_KEY)).toBe('tab-a-refreshed')
    expect(test.auth.getRememberExpiry()).toBeNull()
    expect(test.local.getItem(AUTH_STORAGE_KEY)).toBe('tab-b-remembered')
    expect(createAuthStorage({ ...test.options, session: memory() }).storage.getItem(AUTH_STORAGE_KEY)).toBe('tab-b-remembered')
  })

  it('preserves the temporary choice after reloading a tab', () => {
    const test = setup()
    test.auth.prepareSignIn(false)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'temporary')
    const otherTab = createAuthStorage({ ...test.options, session: memory() })
    otherTab.prepareSignIn(true)
    otherTab.storage.setItem(AUTH_STORAGE_KEY, 'remembered')
    const reloadedTab = createAuthStorage(test.options)
    reloadedTab.storage.setItem(AUTH_STORAGE_KEY, 'temporary-refreshed')
    expect(reloadedTab.getRememberExpiry()).toBeNull()
    expect(test.local.getItem(AUTH_STORAGE_KEY)).toBe('remembered')
  })

  it('keeps a temporary tab logged out without deleting another tab remembered login', () => {
    const test = setup()
    test.auth.prepareSignIn(false)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'temporary')
    const otherTab = createAuthStorage({ ...test.options, session: memory() })
    otherTab.prepareSignIn(true)
    otherTab.storage.setItem(AUTH_STORAGE_KEY, 'remembered')

    test.auth.clearAuthStorage()

    expect(test.auth.storage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(createAuthStorage(test.options).storage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(otherTab.storage.getItem(AUTH_STORAGE_KEY)).toBe('remembered')
  })

  it('does not apply another tab deadline to a temporary login', () => {
    const test = setup()
    const otherTab = createAuthStorage({ ...test.options, session: memory() })
    otherTab.prepareSignIn(true)
    otherTab.storage.setItem(AUTH_STORAGE_KEY, 'remembered')
    test.advance(REMEMBER_DURATION_MS - 1000)
    test.auth.prepareSignIn(false)
    test.auth.storage.setItem(AUTH_STORAGE_KEY, 'new-temporary')
    test.advance(1000)
    expect(test.auth.isAuthExpired()).toBe(false)
    expect(test.auth.storage.getItem(AUTH_STORAGE_KEY)).toBe('new-temporary')
    expect(otherTab.storage.getItem(AUTH_STORAGE_KEY)).toBeNull()
  })
})
