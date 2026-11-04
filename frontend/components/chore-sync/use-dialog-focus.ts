"use client"

import { useEffect, useRef, type RefObject } from "react"

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  open: boolean,
  onEscape: () => void,
  getFallbackFocus?: () => HTMLElement | null,
) {
  const onEscapeRef = useRef(onEscape)
  const fallbackFocusRef = useRef(getFallbackFocus)
  onEscapeRef.current = onEscape
  fallbackFocusRef.current = getFallbackFocus

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const initialFallbackFocus = fallbackFocusRef.current?.()
    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.closest("[hidden], [aria-hidden='true']"),
      )
    const focusInitial = () => {
      const target = dialog.querySelector<HTMLElement>("[autofocus]") ?? getFocusable()[0] ?? dialog
      target.focus()
    }

    focusInitial()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onEscapeRef.current()
        return
      }
      if (event.key !== "Tab") return

      const focusable = getFocusable()
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      const focusTarget =
        previouslyFocused?.isConnected && previouslyFocused !== document.body
          ? previouslyFocused
          : (fallbackFocusRef.current?.() ?? initialFallbackFocus)
      focusTarget?.focus()
    }
  }, [dialogRef, open])
}
