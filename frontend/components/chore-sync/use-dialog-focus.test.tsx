// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { useRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { useDialogFocus } from "./use-dialog-focus"

function FocusTrapHarness({ disabled }: { disabled: boolean }) {
  const dialogRef = useRef<HTMLElement | null>(null)
  useDialogFocus(dialogRef, true, vi.fn())

  return (
    <section aria-label="Test dialog" ref={dialogRef} tabIndex={-1}>
      <button disabled={disabled} type="button">
        First control
      </button>
      <button disabled={disabled} type="button">
        Last control
      </button>
    </section>
  )
}

describe("useDialogFocus", () => {
  it("traps Tab and Shift+Tab inside when controls become enabled after container focus", () => {
    const view = render(<FocusTrapHarness disabled />)
    const dialog = screen.getByRole("region", { name: "Test dialog" })

    expect(document.activeElement).toBe(dialog)
    const disabledTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    })
    document.dispatchEvent(disabledTab)
    expect(disabledTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(dialog)

    view.rerender(<FocusTrapHarness disabled={false} />)
    const firstButton = screen.getByRole("button", { name: "First control" })
    const lastButton = screen.getByRole("button", { name: "Last control" })
    dialog.focus()
    const backwardTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
      shiftKey: true,
    })
    document.dispatchEvent(backwardTab)
    expect(backwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(lastButton)

    dialog.focus()
    const forwardTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    })
    document.dispatchEvent(forwardTab)
    expect(forwardTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(firstButton)
  })
})
