export const AUTH_STORAGE_KEY = 'kadr.auth.v1'
export const REMEMBER_DURATION_MS = 40 * 24 * 60 * 60 * 1000

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Options = { local?: StorageLike; session?: StorageLike; now?: () => number }

function memoryStorage(): StorageLike {
  const data = new Map<string, string>()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } }
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): StorageLike {
  try { return window[kind] } catch { return memoryStorage() }
}

/** Refreshing a token never moves the original remember-me deadline. */
export function createAuthStorage(options: Options = {}) {
  const local = options.local ?? browserStorage('localStorage')
  const session = options.session ?? browserStorage('sessionStorage')
  const now = options.now ?? Date.now
  const expiryKey = `${AUTH_STORAGE_KEY}.expires`
  const modeKey = `${AUTH_STORAGE_KEY}.mode`
  let expiresAt: number | null = null
  let remember = false
  let expired = false

  function isTemporary() {
    return session.getItem(modeKey) === 'temporary' || session.getItem(AUTH_STORAGE_KEY) !== null
  }

  function readExpiry() {
    const raw = local.getItem(expiryKey)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  function removeCredentials() {
    local.removeItem(AUTH_STORAGE_KEY)
    session.removeItem(AUTH_STORAGE_KEY)
  }

  function syncExpiry() {
    // sessionStorage belongs to this tab; another tab cannot promote its login.
    if (isTemporary()) {
      remember = false
      expiresAt = null
      expired = false
      return false
    }
    const stored = readExpiry()
    if (stored !== null) {
      if (expiresAt !== stored) expired = false
      expiresAt = stored
      remember = true
    }
    if (remember && expiresAt !== null && now() >= expiresAt) {
      expired = true
      removeCredentials()
    }
    return expired
  }

  function clearAuthStorage() {
    const temporary = isTemporary()
    session.removeItem(AUTH_STORAGE_KEY)
    if (temporary) {
      // Stay logged out in this tab even if another tab has a remembered login.
      session.setItem(modeKey, 'temporary')
    } else {
      local.removeItem(AUTH_STORAGE_KEY)
      local.removeItem(expiryKey)
      session.removeItem(modeKey)
    }
    expiresAt = null
    remember = false
    expired = false
  }

  function prepareSignIn(shouldRemember: boolean) {
    const previouslyRemembered = !isTemporary() && (remember || session.getItem(modeKey) === 'remembered')
    if (shouldRemember || previouslyRemembered) {
      local.removeItem(AUTH_STORAGE_KEY)
      local.removeItem(expiryKey)
    }
    session.removeItem(AUTH_STORAGE_KEY)
    session.setItem(modeKey, shouldRemember ? 'remembered' : 'temporary')
    expiresAt = null
    expired = false
    remember = shouldRemember
  }

  const storage = {
    getItem(key: string) {
      if (key !== AUTH_STORAGE_KEY) return session.getItem(key)
      if (isTemporary()) return session.getItem(key)
      if (syncExpiry()) return null
      // Credentials without a valid deadline must never become permanent.
      if (readExpiry() === null) { local.removeItem(key); return null }
      return local.getItem(key)
    },
    setItem(key: string, value: string) {
      if (key !== AUTH_STORAGE_KEY) { session.setItem(key, value); return }
      if (syncExpiry()) return
      if (remember) {
        if (expiresAt === null) {
          expiresAt = now() + REMEMBER_DURATION_MS
          local.setItem(expiryKey, String(expiresAt))
        }
        local.setItem(key, value)
        session.removeItem(key)
      } else {
        session.setItem(modeKey, 'temporary')
        session.setItem(key, value)
      }
    },
    removeItem(key: string) {
      if (key === AUTH_STORAGE_KEY) clearAuthStorage()
      else { session.removeItem(key); local.removeItem(key) }
    },
  }

  return {
    storage, prepareSignIn, clearAuthStorage,
    getRememberExpiry: () => { syncExpiry(); return remember ? expiresAt : null },
    isAuthExpired: () => syncExpiry(),
  }
}

const auth = createAuthStorage()
export const authStorage = auth.storage
export const prepareSignIn = auth.prepareSignIn
export const clearAuthStorage = auth.clearAuthStorage
export const getRememberExpiry = auth.getRememberExpiry
export const isAuthExpired = auth.isAuthExpired

/** One-minute ceiling also catches a system clock change; focus catches sleeping tabs. */
export function watchAuthExpiry(onExpired: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  function check() {
    if (done) return
    clearTimeout(timer)
    if (isAuthExpired()) { done = true; onExpired(); return }
    const expiry = getRememberExpiry()
    const delay = expiry === null ? 60_000 : Math.max(1, Math.min(60_000, expiry - Date.now()))
    timer = setTimeout(check, delay)
  }
  check()
  window.addEventListener('focus', check)
  window.addEventListener('storage', check)
  document.addEventListener('visibilitychange', check)
  return () => {
    done = true
    clearTimeout(timer)
    window.removeEventListener('focus', check)
    window.removeEventListener('storage', check)
    document.removeEventListener('visibilitychange', check)
  }
}
