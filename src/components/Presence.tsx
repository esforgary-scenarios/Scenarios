import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Keep closing UI mounted for its short exit transition. */
export function Presence({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(Boolean(children))
  const lastContent = useRef(children)
  useLayoutEffect(() => {
    if (children) {
      lastContent.current = children
      setMounted(true)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), 180)
    return () => window.clearTimeout(timer)
  }, [children])

  if (!children && !mounted) return null
  return <div className="presence" data-state={children ? 'open' : 'closing'} inert={!children} aria-hidden={!children || undefined}>
    {children || lastContent.current}
  </div>
}
