"use client"

import { useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import type { Chore, Priority } from "@/lib/chore-sync/types"
import { cn } from "@/lib/utils"
import { BottomNav } from "../bottom-nav"
import { ChevronLeftIcon } from "../icons"

const ICONS = ["🧹", "🗑️", "🛁", "🧺", "🍽️", "🌀", "🫧", "♻️", "🪴", "🛒", "🧽", "🪣"]
const FREQUENCIES = ["One time", "Daily", "Weekly", "Custom"]
const PRIORITIES: Priority[] = ["low", "medium", "high"]

const PRIORITY_STYLES: Record<Priority, { active: string; idle: string }> = {
  low: { active: "bg-emerald-500 text-white", idle: "bg-emerald-50 text-emerald-600 hover:bg-emerald-100" },
  medium: { active: "bg-amber-500 text-white", idle: "bg-amber-50 text-amber-600 hover:bg-amber-100" },
  high: { active: "bg-rose-500 text-white", idle: "bg-rose-50 text-rose-600 hover:bg-rose-100" },
}

const cardClass = "bg-white rounded-2xl p-4 border border-slate-100 shadow-sm"

export function CreateChoreScreen() {
  const { state, navigate, addChore } = useChoreSync()
  const [form, setForm] = useState({
    name: "",
    assigneeId: state.currentUser.id,
    frequency: "Weekly",
    due: "",
    priority: "medium" as Priority,
    icon: "🧹",
  })

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = () => {
    const assignee = state.household.members.find((m) => m.id === form.assigneeId)
    if (!assignee) return
    const newChore: Chore = {
      id: String(Date.now()),
      name: form.name,
      assigneeId: form.assigneeId,
      assigneeName: assignee.name,
      due: form.due || "TBD",
      dueDay: form.due || "TBD",
      status: "pending",
      priority: form.priority,
      icon: form.icon,
      frequency: form.frequency,
    }
    addChore(newChore)
    navigate("admin")
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-5">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate("admin")}
            aria-label="Back"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ChevronLeftIcon className="w-5 h-5 text-slate-500" />
          </button>
          <h1 className="text-xl font-black text-slate-900 font-display">Create Chore</h1>
        </div>
      </header>

      <div className="px-4 pt-4 flex flex-col gap-5">
        <div className={cardClass}>
          <p className="block text-sm font-semibold text-slate-700 mb-3">Icon</p>
          <div className="flex flex-wrap gap-2">
            {ICONS.map((icon) => (
              <button
                key={icon}
                onClick={() => update("icon", icon)}
                className={cn(
                  "w-11 h-11 rounded-xl text-2xl flex items-center justify-center transition-all",
                  form.icon === icon ? "bg-teal-100 ring-2 ring-teal-500" : "bg-slate-100 hover:bg-slate-200",
                )}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        <div className={cardClass}>
          <label htmlFor="chore-name" className="block text-sm font-semibold text-slate-700 mb-2">
            Chore Name
          </label>
          <input
            id="chore-name"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="e.g. Clean bathroom"
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-[15px] transition-all"
          />
        </div>

        <div className={cardClass}>
          <label htmlFor="chore-assignee" className="block text-sm font-semibold text-slate-700 mb-2">
            Assign To
          </label>
          <select
            id="chore-assignee"
            value={form.assigneeId}
            onChange={(e) => update("assigneeId", e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-[15px] transition-all bg-white"
          >
            {state.household.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.id === state.currentUser.id ? " (You)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className={cardClass}>
          <p className="block text-sm font-semibold text-slate-700 mb-3">Frequency</p>
          <div className="grid grid-cols-2 gap-2">
            {FREQUENCIES.map((f) => (
              <button
                key={f}
                onClick={() => update("frequency", f)}
                className={cn(
                  "py-2.5 rounded-xl text-sm font-semibold transition-all",
                  form.frequency === f ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className={cardClass}>
          <label htmlFor="chore-due" className="block text-sm font-semibold text-slate-700 mb-2">
            Due Date
          </label>
          <input
            id="chore-due"
            type="date"
            value={form.due}
            onChange={(e) => update("due", e.target.value)}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-[15px] transition-all"
          />
        </div>

        <div className={cardClass}>
          <p className="block text-sm font-semibold text-slate-700 mb-3">Priority</p>
          <div className="grid grid-cols-3 gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                onClick={() => update("priority", p)}
                className={cn(
                  "py-2.5 rounded-xl text-sm font-bold capitalize transition-all",
                  form.priority === p ? PRIORITY_STYLES[p].active : PRIORITY_STYLES[p].idle,
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={save}
          disabled={!form.name.trim()}
          className={cn(
            "w-full font-bold text-[15px] py-4 rounded-xl transition-all",
            form.name.trim()
              ? "bg-teal-600 text-white shadow-lg shadow-teal-200 hover:bg-teal-700 active:scale-[0.98]"
              : "bg-slate-100 text-slate-400 cursor-not-allowed",
          )}
        >
          Save Chore
        </button>
      </div>

      <BottomNav active="household" navigate={navigate} />
    </div>
  )
}
