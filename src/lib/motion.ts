import { flushSync } from 'react-dom'

const selector = '[data-motion-item]'
const timing: KeyframeAnimationOptions = { duration: 220, easing: 'cubic-bezier(.2,.75,.25,1)' }
const running = new Set<Animation>()

function play(element: HTMLElement, frames: Keyframe[], cleanup?: () => void) {
  const animation = element.animate(frames, timing)
  running.add(animation)
  void animation.finished.catch(() => {}).finally(() => {
    running.delete(animation)
    cleanup?.()
  })
}

/** Animate list geometry directly, keeping the real controls clickable throughout. */
export function animateUpdate(update: () => void) {
  if (!HTMLElement.prototype.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update()
    return
  }
  for (const animation of running) animation.cancel()
  const before = new Map(Array.from(document.querySelectorAll<HTMLElement>(selector), element => {
    const rect = element.getBoundingClientRect()
    return [element.dataset.motionItem!, { rect, clone: element.cloneNode(true) as HTMLElement }] as const
  }))

  flushSync(update)

  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const key = element.dataset.motionItem!
    const previous = before.get(key)
    before.delete(key)
    if (!previous) {
      play(element, [{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }])
      continue
    }
    const rect = element.getBoundingClientRect()
    const x = previous.rect.left - rect.left, y = previous.rect.top - rect.top
    if (Math.abs(x) + Math.abs(y) > 1) {
      play(element, [{ translate: `${x}px ${y}px` }, { translate: '0 0' }])
    }
  }

  for (const { rect, clone } of before.values()) {
    if (rect.bottom < 0 || rect.right <= 0 || rect.top > innerHeight || rect.left >= innerWidth) continue
    // Decorative copies only animate removal; no input, focus, or duplicate accessibility content.
    clone.removeAttribute('data-motion-item')
    clone.removeAttribute('id')
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'))
    clone.setAttribute('aria-hidden', 'true')
    clone.inert = true
    Object.assign(clone.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
      transform: 'none', pointerEvents: 'none', zIndex: '40',
    })
    ;(document.querySelector('.workspace') ?? document.body).append(clone)
    play(clone, [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: '6px 0' }], () => clone.remove())
  }
}
