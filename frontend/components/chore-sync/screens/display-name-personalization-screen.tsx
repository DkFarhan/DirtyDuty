"use client"

import { useEffect, useState } from "react"
import { UserRound } from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { profileApi } from "@/lib/profile/api"

export function DisplayNamePersonalizationScreen() {
  const { user, completeDisplayNamePersonalization } = useAuth()
  const { navigate } = useChoreSync()
  const [displayName, setDisplayName] = useState(user?.displayName ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setDisplayName(user?.displayName ?? "")
    setError("")
  }, [user?.userId, user?.displayName])

  const continueWithName = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    const trimmedName = displayName.trim()
    if (!trimmedName || trimmedName.length > 100) {
      setError("Display name must be between 1 and 100 characters.")
      return
    }

    setBusy(true)
    setError("")
    try {
      const profile = await profileApi.update({ displayName: trimmedName })
      completeDisplayNamePersonalization(profile.displayName)
      navigate("welcome")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to save your display name. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  const keepExistingName = async () => {
    if (busy || !user) return

    setBusy(true)
    setError("")
    try {
      await profileApi.completeDisplayNamePersonalization()
      completeDisplayNamePersonalization(user.displayName)
      navigate("welcome")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to save your preference. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col bg-white px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] dark:bg-slate-950">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <div className="mb-6 flex h-14 w-14 items-center justify-center self-center rounded-2xl bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
          <UserRound aria-hidden="true" className="h-7 w-7" strokeWidth={1.8} />
        </div>
        <h1 className="text-center font-display text-2xl font-black leading-tight text-slate-900 dark:text-white">
          What should your roommates call you?
        </h1>
        <p className="mt-3 text-center text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Choose the name your housemates will see when sharing chores and managing your household.
        </p>

        <form className="mt-8" onSubmit={(event) => void continueWithName(event)}>
          <label
            className="flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300"
            htmlFor="personalized-display-name"
          >
            Display name
            <input
              autoComplete="name"
              className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              disabled={busy}
              id="personalized-display-name"
              maxLength={100}
              onChange={(event) => {
                setDisplayName(event.target.value)
                setError("")
              }}
              required
              value={displayName}
            />
          </label>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            You can change this later in your profile.
          </p>
          {error && (
            <p className="mt-4 text-sm text-rose-600 dark:text-rose-400" role="alert">
              {error}
            </p>
          )}
          <button
            className="mt-7 min-h-12 w-full rounded-xl bg-teal-600 px-4 text-[15px] font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy || !displayName.trim() || displayName.trim().length > 100}
            type="submit"
          >
            {busy ? "Saving…" : "Continue"}
          </button>
        </form>
        <button
          className="mt-3 min-h-11 w-full rounded-xl px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-900"
          disabled={busy}
          onClick={() => void keepExistingName()}
          type="button"
        >
          {busy ? "Saving…" : "Use my existing name"}
        </button>
      </div>
    </main>
  )
}
