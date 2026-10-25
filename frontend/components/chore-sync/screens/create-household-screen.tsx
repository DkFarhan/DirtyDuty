"use client"

import { useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import { ProductLogo } from "@/components/brand/product-logo"
import { ChevronLeftIcon } from "../icons"

const inputClass =
  "w-full rounded-xl border border-slate-200 px-4 py-3.5 text-[15px] text-slate-900 placeholder-slate-400 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"

export function CreateHouseholdScreen() {
  const { navigate } = useChoreSync()
  const { create, queueCreatedHouseholdInvite } = useHouseholds()
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (submitting || !name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await create({
        name: name.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      queueCreatedHouseholdInvite(created)
      navigate("dashboard")
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create household. Please try again.",
      )
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] dark:bg-slate-950">
      <button
        onClick={() => navigate("welcome")}
        className="mb-8 -ml-1 flex min-h-10 w-fit items-center gap-1 text-slate-500 dark:text-slate-400"
      >
        <ChevronLeftIcon className="w-5 h-5" />
        <span className="text-sm font-medium">Back</span>
      </button>

      <div className="mb-8">
        <ProductLogo className="mb-4 h-auto w-36 max-w-full" />
        <h1 className="mb-1 font-display text-3xl font-black text-slate-900 dark:text-white">
          Create Household
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Give your home a name and invite your housemates
        </p>
      </div>

      <div className="flex flex-col gap-5 mb-8">
        <div>
          <label
            htmlFor="household-name"
            className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300"
          >
            Household Name <span className="text-teal-600">*</span>
          </label>
          <input
            id="household-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Apartment 305"
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="household-desc"
            className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300"
          >
            Description <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="household-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="A short description of your household..."
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </div>
      </div>

      <div className="mb-8 rounded-2xl bg-teal-50 p-4 dark:bg-teal-950/50">
        <p className="text-sm font-medium text-teal-700 dark:text-teal-300">
          {
            "💡 After creating your household, you'll get a unique invite code to share with housemates."
          }
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-rose-600">
          {error}
        </p>
      )}
      <button
        onClick={() => void handleCreate()}
        disabled={submitting || !name.trim()}
        className="w-full rounded-xl bg-teal-600 py-4 text-[15px] font-bold text-white shadow-lg shadow-teal-200 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:shadow-none"
      >
        {submitting ? "Creating..." : "Create Household"}
      </button>
    </div>
  )
}
