"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, Copy, X } from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { householdApi, type Household, type HouseholdInvitation } from "@/lib/household/api"
import householdStyles from "./redesign/household-screen-view.module.css"

type InviteHousemateDialogProps = {
  household: Household
  open: boolean
  onOpenChange: (open: boolean) => void
  theme?: "dark" | "light"
}

function expirationLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Expiration time unavailable"

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export function InviteHousemateDialog({
  household,
  open,
  onOpenChange,
  theme = "light",
}: InviteHousemateDialogProps) {
  const [invitation, setInvitation] = useState<HouseholdInvitation | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setInvitation(null)
    setError(null)
    setCopied(false)
  }, [household.id])

  useEffect(() => {
    if (!open) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false)
        return
      }
      if (event.key !== "Tab") return

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
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
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [onOpenChange, open])

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const generateInvitation = async () => {
    if (isGenerating) return
    setIsGenerating(true)
    setError(null)
    try {
      setInvitation(await householdApi.createInvitation(household.id))
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to create an invite right now. Please try again.",
      )
    } finally {
      setIsGenerating(false)
    }
  }

  const copyInvitation = async () => {
    if (!invitation) return
    setError(null)
    try {
      await navigator.clipboard.writeText(invitation.inviteCode)
      setCopied(true)
    } catch {
      setError("Copy is unavailable. Select the invite code to copy it.")
    }
  }

  if (!open) return null

  return createPortal(
    <div className={householdStyles.dialogBackdrop} onClick={() => onOpenChange(false)}>
      <section
        aria-labelledby="invite-housemate-title"
        aria-describedby="invite-housemate-description"
        aria-modal="true"
        className={`${householdStyles.dialogSheet} ${householdStyles.inviteDialogSheet} ${theme === "dark" ? householdStyles.darkTheme : householdStyles.lightTheme}`}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        {
          <>
            <span aria-hidden="true" className={householdStyles.sheetHandle} />
            <button
              aria-label="Close invitation dialog"
              className={householdStyles.sheetClose}
              onClick={() => onOpenChange(false)}
              ref={closeButtonRef}
              type="button"
            >
              <X aria-hidden="true" size={20} />
            </button>
            <p className={householdStyles.sheetEyebrow}>Household invitation</p>
            <h2 className={householdStyles.sheetTitle} id="invite-housemate-title">
              Invite a housemate.
            </h2>
            <p className={householdStyles.inviteDescription} id="invite-housemate-description">
              Generate a secure, one-time code for someone joining <strong>{household.name}</strong>
              .
            </p>
          </>
        }

        {
          <div className={householdStyles.inviteDialogContent}>
            {invitation ? (
              <>
                <p className={householdStyles.sheetEyebrow}>Invitation code</p>
                <div className={householdStyles.inviteCodePanel}>
                  <code>{invitation.inviteCode}</code>
                  <button
                    aria-label={copied ? "Invitation code copied" : "Copy invitation code"}
                    onClick={() => void copyInvitation()}
                    type="button"
                  >
                    {copied ? (
                      <Check aria-hidden="true" size={16} />
                    ) : (
                      <Copy aria-hidden="true" size={16} />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className={householdStyles.inviteExpiry}>
                  This code can be used once. Expires {expirationLabel(invitation.expiresAt)}.
                </p>
                {error && (
                  <p className={householdStyles.dialogError} role="alert">
                    {error}
                  </p>
                )}
                <button
                  className={`${householdStyles.primaryButton} ${householdStyles.invitePrimaryButton} ${householdStyles.inviteDoneButton}`}
                  onClick={() => onOpenChange(false)}
                  type="button"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                {error && (
                  <p className={householdStyles.inviteErrorNotice} role="alert">
                    <strong>Invite couldn’t be created</strong>
                    No code was generated. {error}
                  </p>
                )}
                <button
                  className={`${householdStyles.primaryButton} ${householdStyles.invitePrimaryButton}`}
                  disabled={isGenerating}
                  onClick={() => void generateInvitation()}
                  type="button"
                >
                  {isGenerating ? "Generating…" : error ? "Try again" : "Generate code"}
                </button>
              </>
            )}
          </div>
        }
      </section>
    </div>,
    document.body,
  )
}
