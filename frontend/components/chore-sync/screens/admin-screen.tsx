"use client"

import { useCallback, useEffect, useState } from "react"
import { MoreHorizontal } from "lucide-react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { categoryIcon, choreApi, type Chore, type ChoreManagementOptions } from "@/lib/household/chores"
import { householdApi, type HouseholdMemberDTO } from "@/lib/household/api"
import { useHouseholds } from "@/lib/household/household-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { BottomNav } from "../bottom-nav"
import { ChevronLeftIcon } from "../icons"
import { MemberCard, memberColor } from "../member-card"

type Tab = "members" | "chores"

export function AdminScreen({ initialTab = "members" }: { initialTab?: Tab }) {
  const { state, navigate, editChore } = useChoreSync()
  const { households } = useHouseholds()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [chores, setChores] = useState<Chore[]>([])
  const [choreState, setChoreState] = useState<"loading" | "loaded" | "error">("loading")
  const [choreError, setChoreError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [archiveChore, setArchiveChore] = useState<Chore | null>(null)
  const [managementOptions, setManagementOptions] = useState<ChoreManagementOptions | null>(null)
  const [members, setMembers] = useState<HouseholdMemberDTO[]>([])
  const [memberState, setMemberState] = useState<"loading" | "loaded" | "error">("loading")
  const [memberError, setMemberError] = useState<string | null>(null)
  const household = households[0]

  const loadMembers = useCallback(async () => {
    if (!household) {
      setMemberError("Your household could not be found.")
      setMemberState("error")
      return
    }
    setMemberState("loading")
    setMemberError(null)
    try {
      setMembers(await householdApi.members(household.id))
      setMemberState("loaded")
    } catch (cause) {
      setMemberError(cause instanceof ApiError ? cause.message : "Unable to load household members. Please try again.")
      setMemberState("error")
    }
  }, [household])

  const loadChores = useCallback(async () => {
    if (!household) return
    setChoreState("loading")
    setChoreError(null)
    try {
      const [nextChores, nextOptions] = await Promise.all([
        choreApi.list(household.id),
        choreApi.options(household.id),
      ])
      setChores(nextChores)
      setManagementOptions(nextOptions)
      setChoreState("loaded")
    } catch (cause) {
      setChoreError(cause instanceof ApiError ? cause.message : "Unable to load chores. Please try again.")
      setChoreState("error")
    }
  }, [household])

  useEffect(() => {
    if (tab === "chores") void loadChores()
  }, [loadChores, tab])

  useEffect(() => {
    if (tab === "members") void loadMembers()
  }, [loadMembers, tab])

  const runLifecycleAction = async (chore: Chore, action: "pause" | "activate" | "archive") => {
    if (!household) return
    setActionError(null)
    try {
      if (action === "pause") await choreApi.pause(household.id, chore.id)
      if (action === "activate") await choreApi.activate(household.id, chore.id)
      if (action === "archive") await choreApi.archive(household.id, chore.id)
      setOpenMenuId(null)
      setArchiveChore(null)
      await loadChores()
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "Unable to update this chore. Please try again.")
    }
  }

  const describeRecurrence = (rule: string | undefined) => {
    if (!rule) return "No schedule"
    if (rule === "FREQ=ONCE") return "One time"
    const fields = Object.fromEntries(rule.split(";").map((field) => {
      const [key, value] = field.split("=")
      return [key, value]
    }))
    const dayNames: Record<string, string> = { MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" }
    if (fields.FREQ === "DAILY") return "Daily"
    const days = fields.BYDAY?.split(",").map((day) => dayNames[day]).filter(Boolean).join(", ")
    const interval = Number(fields.INTERVAL) || 1
    if (interval > 1) return days ? `Every ${interval} weeks · ${days}` : `Every ${interval} weeks`
    return days ? `Every ${days}` : "Weekly"
  }

  const formatTime = (time: string | null | undefined) => {
    if (!time) return null
    const [rawHour, minutes] = time.split(":")
    const hour = Number(rawHour)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return time
    return `${hour % 12 || 12}:${minutes} ${hour < 12 ? "AM" : "PM"}`
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => navigate("household")}
            aria-label="Back"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ChevronLeftIcon className="w-5 h-5 text-slate-500" />
          </button>
          <div>
            <h1 className="text-xl font-black text-slate-900 font-display">Household Management</h1>
            <p className="text-slate-400 text-xs">{household?.name ?? "Your household"}</p>
          </div>
        </div>

        <div className="flex gap-2 mt-4 bg-slate-100 p-1 rounded-xl">
          {(["members", "chores"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-2 rounded-lg text-sm font-bold capitalize transition-all",
                tab === t ? "bg-white text-teal-600 shadow-sm" : "text-slate-500",
              )}
            >
              {t === "members" ? "👥 Members" : "📋 Chores"}
            </button>
          ))}
        </div>
      </header>

      <div className="px-4 pt-4">
        {tab === "members" && (
          <div className="flex flex-col gap-3">
            {memberState === "loading" && <div aria-label="Loading household members" className="space-y-3">{[0, 1].map((item) => <div className="h-28 animate-pulse rounded-2xl bg-white" key={item} />)}</div>}
            {memberState === "error" && (
              <div className="rounded-2xl border border-slate-100 bg-white p-5 text-center shadow-sm">
                <p role="alert" className="text-sm text-slate-600">{memberError}</p>
                <Button className="mt-3 rounded-xl" onClick={() => void loadMembers()} type="button" variant="outline">Try again</Button>
              </div>
            )}
            {memberState === "loaded" && members.length === 0 && <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400">No household members found.</div>}
            {memberState === "loaded" && members.map((member, index) => (
              <MemberCard
                key={member.userId}
                colorClass={memberColor(index)}
                isCurrentUser={member.userId === state.currentUser.id}
                member={member}
              />
            ))}
          </div>
        )}

        {tab === "chores" && (
          <div className="flex flex-col gap-3">
          <Button
            aria-label="Create a chore"
            onClick={() => navigate("create-chore")}
            className="h-12 w-full rounded-xl bg-teal-600 text-[15px] font-bold text-white shadow-lg shadow-teal-100 hover:bg-teal-700"
            type="button"
          >
            <span>+</span> Create Chore
          </Button>
          {actionError && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</p>}
          {choreState === "loading" && (
            <div aria-label="Loading chores" className="space-y-3">
              {[0, 1, 2].map((item) => <div className="h-28 animate-pulse rounded-2xl bg-white shadow-sm" key={item} />)}
            </div>
          )}
          {choreState === "error" && (
            <div className="rounded-2xl border border-slate-100 bg-white p-5 text-center shadow-sm">
              <p role="alert" className="text-sm text-slate-600">{choreError}</p>
              <Button className="mt-3 rounded-xl" onClick={() => void loadChores()} type="button" variant="outline">Try again</Button>
            </div>
          )}
          {choreState === "loaded" && chores.length === 0 && (
            <div className="rounded-2xl border border-slate-100 bg-white px-5 py-8 text-center shadow-sm">
              <div aria-hidden="true" className="mb-2 text-3xl">🧹</div>
              <p className="font-display font-bold text-slate-900">No chores yet</p>
              <p className="mt-1 text-sm text-slate-400">Create your first chore and keep the household moving.</p>
              <Button className="mt-4 rounded-xl bg-teal-600 text-white hover:bg-teal-700" onClick={() => navigate("create-chore")} type="button">Create Chore</Button>
            </div>
          )}
          {choreState === "loaded" && chores.map((chore) => {
            const category = chore.categoryId ? managementOptions?.categories.find((item) => item.id === chore.categoryId) : undefined
            const categoryLabel = category?.name
            const peopleNeeded = chore.schedule?.peopleNeeded ?? 1
            const participantCount = chore.schedule?.participantUserIds.length ?? 0
            const assignment = chore.schedule?.assignmentStrategy === "FIXED"
              ? peopleNeeded === 1
                ? `Fixed · ${managementOptions?.activeMembers.find((member) => member.userId === chore.schedule?.fixedAssigneeUserId)?.displayName ?? "Member"}`
                : `Fixed · ${peopleNeeded} people`
              : chore.schedule?.assignmentStrategy === "ROUND_ROBIN"
                ? `Rotate ${peopleNeeded}/${participantCount} people fairly`
                : chore.schedule?.assignmentStrategy === "RANDOM"
                  ? `Random · ${peopleNeeded}/${participantCount} people`
                  : null
            return (
              <article className="relative rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" key={chore.id}>
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-2xl">
                    {categoryIcon(category?.iconKey)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 break-words font-display text-sm font-bold text-slate-900">{chore.title}</h3>
                      <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-bold", chore.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{chore.active ? "Active" : "Paused"}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{categoryLabel ?? "Uncategorized"}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      {describeRecurrence(chore.schedule?.recurrenceRule)}
                      {formatTime(chore.schedule?.dueTime) ? ` · ${formatTime(chore.schedule?.dueTime)}` : ""}
                    </p>
                    {(assignment || chore.estimatedMinutes || chore.difficulty) && (
                      <p className="mt-1 text-xs text-slate-400">
                        {[assignment, `Effort ${chore.difficulty}/5`, chore.estimatedMinutes ? `~${chore.estimatedMinutes} min` : null].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <button aria-expanded={openMenuId === chore.id} aria-label={`Actions for ${chore.title}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" onClick={() => setOpenMenuId(openMenuId === chore.id ? null : chore.id)} type="button">
                    <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
                  </button>
                </div>
                {openMenuId === chore.id && (
                  <div className="absolute right-4 top-12 z-10 w-36 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg">
                    <button className="w-full px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => editChore(chore.id)} type="button">Edit</button>
                    <button className="w-full px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => void runLifecycleAction(chore, chore.active ? "pause" : "activate")} type="button">{chore.active ? "Pause" : "Activate"}</button>
                    <button className="w-full px-3 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50" onClick={() => { setArchiveChore(chore); setOpenMenuId(null) }} type="button">Archive</button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
        )}
      </div>

      <BottomNav active="household" navigate={navigate} />
      {archiveChore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section aria-labelledby="archive-chore-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" role="dialog">
            <h2 className="font-display text-lg font-black text-slate-900" id="archive-chore-title">Archive chore?</h2>
            <p className="mt-2 text-sm text-slate-500">“{archiveChore.title}” will leave the active list. Its history will be preserved.</p>
            <div className="mt-5 flex gap-2">
              <Button className="flex-1 rounded-xl" onClick={() => setArchiveChore(null)} type="button" variant="outline">Cancel</Button>
              <Button className="flex-1 rounded-xl bg-rose-600 text-white hover:bg-rose-700" onClick={() => void runLifecycleAction(archiveChore, "archive")} type="button">Archive</Button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
