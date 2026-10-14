import { useEffect } from 'react'

import getSystem from '@/utils/get-system'

interface MvpShortcut {
  key: string
  command?: boolean
  allowInControl?: boolean
  onPress: () => void
}

type ShortcutEvent = Pick<
  KeyboardEvent,
  | 'key'
  | 'metaKey'
  | 'ctrlKey'
  | 'altKey'
  | 'shiftKey'
  | 'repeat'
  | 'isComposing'
  | 'defaultPrevented'
  | 'preventDefault'
>

export const dispatchMvpShortcut = (
  event: ShortcutEvent,
  shortcuts: readonly MvpShortcut[],
  context: {
    isMac: boolean
    blocked: boolean
    editing: boolean
    inControl: boolean
  },
) => {
  if (event.defaultPrevented || event.isComposing || context.blocked) return
  const shortcut = shortcuts.find(
    (item) =>
      event.key.toLowerCase() === item.key.toLowerCase() &&
      event.metaKey === (Boolean(item.command) && context.isMac) &&
      event.ctrlKey === (Boolean(item.command) && !context.isMac) &&
      !event.altKey &&
      !event.shiftKey,
  )
  if (
    !shortcut ||
    (context.editing && !shortcut.command && shortcut.key !== 'Escape') ||
    (context.inControl && !shortcut.command && !shortcut.allowInControl)
  ) {
    return
  }
  event.preventDefault()
  if (!event.repeat) shortcut.onPress()
}

export const useMvpShortcuts = (shortcuts: readonly MvpShortcut[]) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const editing = target?.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="radio"], [role="checkbox"], [role="switch"]',
      )
      const modalOpen = Array.from(
        document.querySelectorAll(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        ),
      ).some((element) => element.getClientRects().length > 0)
      dispatchMvpShortcut(event, shortcuts, {
        isMac: getSystem() === 'macos',
        blocked: modalOpen || document.hidden,
        editing: Boolean(editing),
        inControl: Boolean(target?.closest('button, a[href], [role="button"]')),
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcuts])
}

export const mvpCommandKey = getSystem() === 'macos' ? '⌘' : 'Ctrl+'
