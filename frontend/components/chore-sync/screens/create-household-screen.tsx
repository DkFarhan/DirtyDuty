"use client"

import { useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import { ProductLogo } from "@/components/brand/product-logo"
import { ChevronLeftIcon } from "../icons"

const inputClass =
  "w-full px-4 py-3.5 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-[15px] transition-all"

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
    <div className="flex flex-col min-h-screen bg-white px-6 pt-12 pb-10">
      <button
        onClick={() => navigate("welcome")}
        className="flex items-center gap-1 text-slate-500 mb-8 -ml-1 w-fit"
      >
        <ChevronLeftIcon className="w-5 h-5" />
        <span className="text-sm font-medium">Back</span>
      </button>

      <div className="mb-8">
        <ProductLogo className="mb-4 h-8 w-auto" variant="mark" />
        <h1 className="text-3xl font-black text-slate-900 mb-1 font-display">Create Household</h1>
        <p className="text-slate-500 text-sm">Give your home a name and invite your housemates</p>
      </div>

      <div className="flex flex-col gap-5 mb-8">
        <div>
          <label
            htmlFor="household-name"
            className="block text-sm font-semibold text-slate-700 mb-1.5"
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
            className="block text-sm font-semibold text-slate-700 mb-1.5"
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

      <div className="bg-teal-50 rounded-2xl p-4 mb-8">
        <p className="text-sm text-teal-700 font-medium">
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
        className="w-full bg-teal-600 text-white font-bold text-[15px] py-4 rounded-xl shadow-lg shadow-teal-200 hover:bg-teal-700 active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Creating..." : "Create Household"}
      </button>
    </div>
  )
}
