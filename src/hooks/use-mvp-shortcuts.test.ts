import { expect, test, vi } from 'vitest'

import { dispatchMvpShortcut } from './use-mvp-shortcuts'

vi.mock('@/utils/get-system', () => ({ default: () => 'macos' }))

const keyEvent = (patch = {}) => ({
  key: ' ',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  preventDefault: vi.fn(),
  ...patch,
})

const context = {
  isMac: true,
  blocked: false,
  editing: false,
  inControl: false,
}

test('toggles once per press and consumes held Space without toggling again', () => {
  const toggle = vi.fn()
  const shortcuts = [{ key: ' ', onPress: toggle }]
  dispatchMvpShortcut(keyEvent(), shortcuts, context)
  const held = keyEvent({ repeat: true })
  dispatchMvpShortcut(held, shortcuts, context)
  expect(toggle).toHaveBeenCalledOnce()
  expect(held.preventDefault).toHaveBeenCalledOnce()
  dispatchMvpShortcut(keyEvent(), shortcuts, context)
  expect(toggle).toHaveBeenCalledTimes(2)
})

test.each([
  { isComposing: true },
  { defaultPrevented: true },
  { altKey: true },
  { shiftKey: true },
])('leaves composition and unrelated key combinations alone: %j', (patch) => {
  const toggle = vi.fn()
  const event = keyEvent(patch)
  dispatchMvpShortcut(event, [{ key: ' ', onPress: toggle }], context)
  expect(toggle).not.toHaveBeenCalled()
  expect(event.preventDefault).not.toHaveBeenCalled()
})

test('does not run page actions when a modal owns the keyboard', () => {
  const action = vi.fn()
  for (const shortcut of [
    { key: ' ', onPress: action },
    { key: 'ArrowRight', allowInControl: true, onPress: action },
    { key: 'r', command: true, onPress: action },
  ]) {
    const event = keyEvent({ key: shortcut.key, metaKey: !!shortcut.command })
    dispatchMvpShortcut(event, [shortcut], { ...context, blocked: true })
    expect(event.preventDefault).not.toHaveBeenCalled()
  }
  expect(action).not.toHaveBeenCalled()
})

test('preserves text editing while keeping Command shortcuts and Escape available', () => {
  const action = vi.fn()
  const editing = { ...context, editing: true }
  for (const key of [' ', 'ArrowRight']) {
    const event = keyEvent({ key })
    dispatchMvpShortcut(event, [{ key, onPress: action }], editing)
    expect(event.preventDefault).not.toHaveBeenCalled()
  }
  expect(action).not.toHaveBeenCalled()
  dispatchMvpShortcut(
    keyEvent({ key: ',', metaKey: true }),
    [{ key: ',', command: true, onPress: action }],
    editing,
  )
  expect(action).toHaveBeenCalledOnce()
  dispatchMvpShortcut(
    keyEvent({ key: 'Escape' }),
    [{ key: 'Escape', allowInControl: true, onPress: action }],
    { ...editing, inControl: true },
  )
  expect(action).toHaveBeenCalledTimes(2)
})

test('preserves native button Space while allowing node arrow navigation', () => {
  const action = vi.fn()
  const focused = { ...context, inControl: true }
  const space = keyEvent()
  dispatchMvpShortcut(space, [{ key: ' ', onPress: action }], focused)
  expect(action).not.toHaveBeenCalled()
  expect(space.preventDefault).not.toHaveBeenCalled()
  dispatchMvpShortcut(
    keyEvent({ key: 'ArrowDown' }),
    [{ key: 'ArrowDown', allowInControl: true, onPress: action }],
    focused,
  )
  expect(action).toHaveBeenCalledOnce()
})

test.each([
  { isMac: true, metaKey: true, ctrlKey: false },
  { isMac: false, metaKey: false, ctrlKey: true },
])('uses the platform modifier for settings and tests: %j', (platform) => {
  const action = vi.fn()
  for (const key of [',', 'r']) {
    const event = keyEvent({ key, ...platform })
    dispatchMvpShortcut(event, [{ key, command: true, onPress: action }], {
      ...context,
      isMac: platform.isMac,
    })
    expect(event.preventDefault).toHaveBeenCalledOnce()
  }
  expect(action).toHaveBeenCalledTimes(2)
  dispatchMvpShortcut(
    keyEvent({
      key: 'r',
      metaKey: platform.ctrlKey,
      ctrlKey: platform.metaKey,
    }),
    [{ key: 'r', command: true, onPress: action }],
    { ...context, isMac: platform.isMac },
  )
  expect(action).toHaveBeenCalledTimes(2)
})
