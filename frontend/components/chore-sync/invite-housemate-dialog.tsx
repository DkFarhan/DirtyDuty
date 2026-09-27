"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, Copy, House, X } from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { householdApi, type Household, type HouseholdInvitation } from "@/lib/household/api"
import { Button } from "@/components/ui/button"

type InviteHousemateDialogProps = {
  household: Household
  open: boolean
  onOpenChange: (open: boolean) => void
}

function expirationLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Expiration time unavailable"

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export function InviteHousemateDialog({ household, open, onOpenChange }: InviteHousemateDialogProps) {
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

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"
      onClick={() => onOpenChange(false)}
    >
      <section
        aria-labelledby="invite-housemate-title"
        aria-describedby="invite-housemate-description"
        aria-modal="true"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-100 bg-white p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <House aria-hidden="true" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="invite-housemate-title" className="font-display text-xl font-black text-slate-900">
                Invite a housemate
              </h2>
              <p id="invite-housemate-description" className="mt-1 text-sm leading-relaxed text-slate-500">
                Generate a secure one-time invite code for someone you want to add to{" "}
                <span className="break-words font-semibold text-slate-700">{household.name}</span>.
              </p>
            </div>
          </div>
          <button
            aria-label="Close invitation dialog"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            onClick={() => onOpenChange(false)}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        {invitation ? (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Invite code</p>
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-teal-100 bg-teal-50/70 p-2">
                <code className="min-w-0 flex-1 select-all break-all px-2 py-1 font-mono text-sm font-semibold leading-relaxed text-teal-900 sm:text-base">
                  {invitation.inviteCode}
                </code>
                <Button
                  className="h-10 shrink-0 rounded-lg border-slate-200 bg-white px-3 text-slate-700 hover:bg-slate-50"
                  onClick={() => void copyInvitation()}
                  type="button"
                  variant="outline"
                >
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <p className="text-sm text-slate-500">This invite can be used once.</p>
            <p className="text-sm text-slate-500">
              Expires <span className="font-medium text-slate-700">{expirationLabel(invitation.expiresAt)}</span>
            </p>
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
            <Button
              className="h-11 w-full rounded-xl bg-teal-600 font-bold text-white hover:bg-teal-700"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-500">
              Each code is secure, expires automatically, and can only be redeemed once.
            </p>
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
            <Button
              className="h-11 w-full rounded-xl bg-teal-600 font-bold text-white hover:bg-teal-700"
              disabled={isGenerating}
              onClick={() => void generateInvitation()}
              type="button"
            >
              {isGenerating ? "Generating invite..." : "Generate invite"}
            </Button>
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
