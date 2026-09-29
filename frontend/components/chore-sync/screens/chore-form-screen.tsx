"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import { categoryIcon, choreApi, type AssignmentStrategy, type Chore, type ChoreManagementOptions, type ChorePriority, type ChoreRequest } from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import { cn } from "@/lib/utils"

const weekdays = [
  { key: "MO", short: "M" },
  { key: "TU", short: "T" },
  { key: "WE", short: "W" },
  { key: "TH", short: "T" },
  { key: "FR", short: "F" },
  { key: "SA", short: "S" },
  { key: "SU", short: "S" },
]
const efforts = ["Quick", "Light", "Moderate", "Heavy", "Big job"]
const priorities: { value: ChorePriority; label: string; style: string }[] = [
  { value: "LOW", label: "Low", style: "emerald" },
  { value: "NORMAL", label: "Normal", style: "teal" },
  { value: "HIGH", label: "High", style: "amber" },
  { value: "URGENT", label: "Urgent", style: "rose" },
]
type Frequency = "ONCE" | "DAILY" | "WEEKLY" | "CUSTOM"
type FormValues = {
  categoryId: string
  title: string
  description: string
  requiresVerification: boolean
  strategy: AssignmentStrategy
  peopleNeeded: number
  fixedAssignee: string
  participants: string[]
  frequency: Frequency
  interval: number
  weekdays: string[]
  startsOn: string
  endsOn: string
  hasEnd: boolean
  dueTime: string
  priority: ChorePriority
  difficulty: number
  estimatedMinutes: string
}

function localDate() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function parseRule(rule: string): Pick<FormValues, "frequency" | "interval" | "weekdays"> {
  const fields = Object.fromEntries(rule.split(";").map((field) => {
    const [key, value] = field.split("=")
    return [key, value]
  }))
  const frequency = fields.FREQ
  const frequencyType: Frequency =
    frequency === "DAILY" ? "DAILY" :
      frequency === "WEEKLY" && Number(fields.INTERVAL) > 1 ? "CUSTOM" :
        frequency === "WEEKLY" ? "WEEKLY" : "ONCE"
  return {
    frequency: frequencyType,
    interval: Math.max(2, Number(fields.INTERVAL) || 2),
    weekdays: fields.BYDAY?.split(",").filter((day) => weekdays.some((weekday) => weekday.key === day)) ?? [],
  }
}

function valuesFromChore(chore: Chore): FormValues {
  const schedule = chore.schedule
  const recurrence = schedule ? parseRule(schedule.recurrenceRule) : { frequency: "WEEKLY" as const, interval: 2, weekdays: ["MO"] }
  return {
    categoryId: chore.categoryId ?? "",
    title: chore.title,
    description: chore.description ?? "",
    requiresVerification: chore.requiresVerification,
    strategy: schedule?.assignmentStrategy ?? "FIXED",
    peopleNeeded: schedule?.peopleNeeded ?? 1,
    fixedAssignee: schedule?.fixedAssigneeUserId ?? "",
    participants: schedule?.participantUserIds ?? [],
    frequency: recurrence.frequency,
    interval: recurrence.interval,
    weekdays: recurrence.weekdays,
    startsOn: schedule?.startsOn ?? localDate(),
    endsOn: schedule?.endsOn ?? "",
    hasEnd: Boolean(schedule?.endsOn),
    dueTime: schedule?.dueTime?.slice(0, 5) ?? "",
    priority: chore.defaultPriority,
    difficulty: chore.difficulty,
    estimatedMinutes: chore.estimatedMinutes?.toString() ?? "",
  }
}

function initialValues(memberId: string): FormValues {
  return {
    categoryId: "",
    title: "",
    description: "",
    requiresVerification: false,
    strategy: "FIXED",
    peopleNeeded: 1,
    fixedAssignee: memberId,
    participants: [],
    frequency: "WEEKLY",
    interval: 2,
    weekdays: ["MO"],
    startsOn: localDate(),
    endsOn: "",
    hasEnd: false,
    dueTime: "18:00",
    priority: "NORMAL",
    difficulty: 3,
    estimatedMinutes: "",
  }
}

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[15px] text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
const groupClass = "rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"

export function ChoreFormScreen() {
  const { state, screen, navigate, editingChoreId } = useChoreSync()
  const { households } = useHouseholds()
  const household = households[0]
  const isEditing = screen === "edit-chore"
  const [values, setValues] = useState(() => initialValues(state.currentUser.id))
  const [options, setOptions] = useState<ChoreManagementOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [savedValues, setSavedValues] = useState("")
  const householdId = household?.id
  const serializedValues = useMemo(() => JSON.stringify(values), [values])
  const dirty = savedValues !== "" && serializedValues !== savedValues

  useEffect(() => {
    if (!householdId) {
      setLoadError("Your household could not be found. Return to Household and try again.")
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)
    const load = async () => {
      try {
        const [nextOptions, chore] = await Promise.all([
          choreApi.options(householdId),
          isEditing && editingChoreId ? choreApi.get(householdId, editingChoreId) : Promise.resolve(null),
        ])
        if (cancelled) return
        setOptions(nextOptions)
        if (chore) {
          const nextValues = valuesFromChore(chore)
          setValues(nextValues)
          setSavedValues(JSON.stringify(nextValues))
        } else {
          const nextValues = initialValues(nextOptions.activeMembers[0]?.userId ?? "")
          setValues(nextValues)
          setSavedValues(JSON.stringify(nextValues))
        }
      } catch (cause) {
        if (!cancelled) {
          setLoadError(cause instanceof ApiError ? cause.message : "Unable to load chore options. Please try again.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [editingChoreId, householdId, isEditing])

  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setError(null)
    setValues((current) => ({ ...current, [key]: value }))
  }

  const leave = useCallback(() => {
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    navigate("admin", "chores")
  }, [dirty, navigate])

  const toggleMember = (userId: string) => {
    setError(null)
    setValues((current) => ({
      ...current,
      participants: current.participants.includes(userId)
        ? current.participants.filter((id) => id !== userId)
        : [...current.participants, userId],
    }))
  }

  const buildRequest = (): ChoreRequest | null => {
    if (!household || !options) return null
    const title = values.title.trim()
    if (!title) {
      setError("Enter a chore name.")
      return null
    }
    if (!values.startsOn) {
      setError("Choose a start date.")
      return null
    }
    if (!values.dueTime) {
      setError("Choose a due time.")
      return null
    }
    if ((values.frequency === "WEEKLY" || values.frequency === "CUSTOM") && values.weekdays.length === 0) {
      setError("Choose at least one day to repeat.")
      return null
    }
    const eligibleCount = values.strategy === "FIXED" ? options.activeMembers.length : values.participants.length
    if (!Number.isInteger(values.peopleNeeded) || values.peopleNeeded < 1 || values.peopleNeeded > eligibleCount) {
      setError("People needed must be between 1 and the number of eligible members.")
      return null
    }
    const selectedIds = values.strategy === "FIXED" && values.peopleNeeded === 1
      ? [values.fixedAssignee]
      : values.participants
    if (selectedIds.some((userId) => !options.activeMembers.some((member) => member.userId === userId))) {
      setError("Some selected members are no longer eligible. Update the selection.")
      return null
    }
    if (values.strategy === "FIXED" && values.peopleNeeded === 1 && !values.fixedAssignee) {
      setError("Choose a household member to assign this chore to.")
      return null
    }
    if (values.strategy === "FIXED" && values.peopleNeeded > 1 && values.participants.length !== values.peopleNeeded) {
      setError(`Choose exactly ${values.peopleNeeded} members for this chore.`)
      return null
    }
    if ((values.strategy === "ROUND_ROBIN" || values.strategy === "RANDOM") && values.participants.length < values.peopleNeeded) {
      setError(`Choose at least ${values.peopleNeeded} eligible members.`)
      return null
    }
    const minutes = values.estimatedMinutes.trim() === "" ? null : Number(values.estimatedMinutes)
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
      setError("Estimated time must be a whole number between 1 and 1440 minutes.")
      return null
    }
    if (values.hasEnd && values.endsOn && values.endsOn < values.startsOn) {
      setError("The end date cannot be before the start date.")
      return null
    }
    if (values.hasEnd && !values.endsOn) {
      setError("Choose an end date, or select Never.")
      return null
    }
    if (values.frequency === "CUSTOM" && (!Number.isInteger(values.interval) || values.interval < 2 || values.interval > 52)) {
      setError("Custom recurrence must be between 2 and 52 weeks.")
      return null
    }

    const days = values.weekdays.join(",")
    const recurrenceRule =
      values.frequency === "ONCE" ? "FREQ=ONCE" :
        values.frequency === "DAILY" ? "FREQ=DAILY" :
          values.frequency === "WEEKLY" ? `FREQ=WEEKLY;BYDAY=${days}` :
            `FREQ=WEEKLY;INTERVAL=${values.interval};BYDAY=${days}`

    return {
      title,
      description: values.description.trim() || null,
      categoryId: values.categoryId || null,
      defaultPriority: values.priority,
      difficulty: values.difficulty,
      estimatedMinutes: minutes,
      requiresVerification: values.requiresVerification,
      schedule: {
        recurrenceRule,
        timezone: household.timezone,
        startsOn: values.startsOn,
        endsOn: values.frequency === "ONCE" || !values.hasEnd ? null : values.endsOn || null,
        dueTime: values.dueTime || null,
        assignmentStrategy: values.strategy,
        peopleNeeded: values.peopleNeeded,
        fixedAssigneeUserId: values.strategy === "FIXED" && values.peopleNeeded === 1 ? values.fixedAssignee : null,
        participantUserIds: values.strategy === "FIXED" && values.peopleNeeded === 1 ? [] : values.participants,
      },
    }
  }

  const save = async () => {
    if (!householdId || saving) return
    setError(null)
    const request = buildRequest()
    if (!request) return
    setSaving(true)
    try {
      if (isEditing && editingChoreId) await choreApi.update(householdId, editingChoreId, request)
      else await choreApi.create(householdId, request)
      navigate("admin", "chores")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to save this chore. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const memberLabel = (userId: string) => options?.activeMembers.find((member) => member.userId === userId)?.displayName ?? userId
  const eligibleCount = values.strategy === "FIXED" ? options?.activeMembers.length ?? 0 : values.participants.length
  const selectedIds = values.strategy === "FIXED" && values.peopleNeeded === 1 && values.fixedAssignee
    ? [values.fixedAssignee]
    : values.participants
  const selectedMembersChanged = selectedIds.some((userId) => !options?.activeMembers.some((member) => member.userId === userId))
  const poolMessage = selectedMembersChanged
    ? "Some selected members are no longer eligible. Update the selection."
    : values.peopleNeeded > eligibleCount
      ? "People needed must be between 1 and the number of eligible members."
      : values.strategy === "FIXED" && values.peopleNeeded > 1 && values.participants.length !== values.peopleNeeded
        ? `Choose exactly ${values.peopleNeeded} members for this chore.`
        : values.strategy !== "FIXED" && values.participants.length < values.peopleNeeded
          ? `Choose at least ${values.peopleNeeded} eligible members.`
          : null

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="bg-white px-4 pb-4 pt-10">
        <div className="flex items-center gap-2">
          <button
            aria-label="Back to chores"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100"
            onClick={leave}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="h-5 w-5" />
          </button>
          <div>
            <h1 className="font-display text-xl font-black text-slate-900">{isEditing ? "Edit Chore" : "Create Chore"}</h1>
            <p className="text-xs text-slate-400">{household?.name}</p>
          </div>
        </div>
      </header>

      {loading ? (
        <div aria-label="Loading chore form" className="space-y-4 px-4 py-5">
          {[0, 1, 2].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl bg-white shadow-sm" />)}
        </div>
      ) : loadError ? (
        <div className="px-4 py-6">
          <p role="alert" className="rounded-2xl border border-rose-100 bg-white p-4 text-sm text-rose-600">{loadError}</p>
          <Button className="mt-4 w-full rounded-xl" onClick={() => navigate("admin", "chores")} type="button" variant="outline">Back to chores</Button>
        </div>
      ) : !options ? null : (
        <>
          <main className="flex-1 space-y-4 px-4 pb-28 pt-4">
            <section className={groupClass}>
              <h2 className="mb-4 text-xs font-black uppercase tracking-wider text-slate-500">Chore Details</h2>
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Category</span>
                  <span className="relative block">
                    <select className={cn(fieldClass, "appearance-none pr-10")} onChange={(event) => update("categoryId", event.target.value)} value={values.categoryId}>
                      <option value="">Choose a category</option>
                      {options.categories.map((category) => <option key={category.id} value={category.id}>{categoryIcon(category.iconKey)} {category.name}</option>)}
                    </select>
                    <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
                  </span>
                </label>
                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-700">Category icon</p>
                  <div aria-label="Category icons" className="flex flex-wrap gap-2">
                    {options.categories.map((category) => (
                      <button
                        aria-label={`Choose ${category.name} icon`}
                        aria-pressed={values.categoryId === category.id}
                        className={cn("flex h-10 w-10 items-center justify-center rounded-xl text-xl transition", values.categoryId === category.id ? "bg-teal-50 ring-2 ring-teal-500" : "bg-slate-100 hover:bg-slate-200")}
                        key={category.id}
                        onClick={() => update("categoryId", category.id)}
                        type="button"
                      >{categoryIcon(category.iconKey)}</button>
                    ))}
                    {options.categories.length === 0 && <p className="text-xs text-slate-400">Household categories aren’t set up yet.</p>}
                  </div>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Chore name</span>
                  <input className={fieldClass} maxLength={160} onChange={(event) => update("title", event.target.value)} placeholder="e.g. Clean Kitchen" value={values.title} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Description <span className="font-normal text-slate-400">(optional)</span></span>
                  <textarea className={cn(fieldClass, "min-h-20 resize-y")} onChange={(event) => update("description", event.target.value)} placeholder="Add a few helpful details" value={values.description} />
                </label>
              </div>
            </section>

            <section className={groupClass}>
              <h2 className="mb-4 text-xs font-black uppercase tracking-wider text-slate-500">Assignment</h2>
              <label className="mb-4 block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">People Needed</span>
                <input
                  aria-label="People Needed"
                  className={fieldClass}
                  max={values.strategy === "FIXED" ? options.activeMembers.length : Math.max(1, values.participants.length)}
                  min={1}
                  onChange={(event) => update("peopleNeeded", Number(event.target.value))}
                  type="number"
                  value={values.peopleNeeded}
                />
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
                {([
                  ["FIXED", "Fixed"],
                  ["ROUND_ROBIN", "Rotate"],
                  ["RANDOM", "Random"],
                ] as const).map(([strategy, label]) => (
                  <button
                    aria-pressed={values.strategy === strategy}
                    className={cn("rounded-lg px-1 py-2.5 text-xs font-bold transition sm:text-sm", values.strategy === strategy ? "bg-white text-teal-700 shadow-sm" : "text-slate-500")}
                    key={strategy}
                    onClick={() => update("strategy", strategy)}
                    type="button"
                  >{label}</button>
                ))}
              </div>
              {values.strategy === "FIXED" ? (
                values.peopleNeeded === 1 ? (
                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">Assign to</span>
                    <select className={fieldClass} onChange={(event) => update("fixedAssignee", event.target.value)} value={values.fixedAssignee}>
                      <option value="">Choose a member</option>
                      {options.activeMembers.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
                    </select>
                  </label>
                ) : (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-semibold text-slate-700">Select exactly {values.peopleNeeded} members</p>
                    {options.activeMembers.map((member) => {
                      const checked = values.participants.includes(member.userId)
                      return (
                        <button aria-pressed={checked} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-slate-100 px-3 text-left transition hover:bg-slate-50" key={member.userId} onClick={() => toggleMember(member.userId)} type="button">
                          <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border", checked ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300")}>{checked && <Check aria-hidden="true" className="h-3.5 w-3.5" />}</span>
                          <span className="text-sm font-medium text-slate-800">{member.displayName}</span>
                        </button>
                      )
                    })}
                    <p className="text-xs text-slate-500">{values.participants.length} of {values.peopleNeeded} selected</p>
                  </div>
                )
              ) : (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-semibold text-slate-700">Eligible members</p>
                  {options.activeMembers.map((member) => {
                    const checked = values.participants.includes(member.userId)
                    return (
                      <button
                        aria-pressed={checked}
                        className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-slate-100 px-3 text-left transition hover:bg-slate-50"
                        key={member.userId}
                        onClick={() => toggleMember(member.userId)}
                        type="button"
                      >
                        <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border", checked ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300")}>{checked && <Check aria-hidden="true" className="h-3.5 w-3.5" />}</span>
                        <span className="text-sm font-medium text-slate-800">{member.displayName}</span>
                      </button>
                    )
                  })}
                  <p className="text-xs text-slate-500">
                    {values.strategy === "ROUND_ROBIN"
                      ? `Rotate ${values.peopleNeeded}/${values.participants.length} people fairly.`
                      : `${values.peopleNeeded} of ${values.participants.length} eligible people are assigned each time.`}
                  </p>
                  {poolMessage && error !== poolMessage && <p role="alert" className="text-xs font-medium text-rose-600">{poolMessage}</p>}
                </div>
              )}
              {values.strategy === "FIXED" && poolMessage && error !== poolMessage && <p role="alert" className="mt-2 text-xs font-medium text-rose-600">{poolMessage}</p>}
              {values.strategy === "FIXED" && values.fixedAssignee && <p className="mt-2 text-xs text-slate-400">Fixed assignment · {memberLabel(values.fixedAssignee)}</p>}
            </section>

            <section className={groupClass}>
              <h2 className="mb-4 text-xs font-black uppercase tracking-wider text-slate-500">Schedule</h2>
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-700">Frequency</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ["ONCE", "One time"],
                      ["DAILY", "Daily"],
                      ["WEEKLY", "Weekly"],
                      ["CUSTOM", "Custom"],
                    ] as const).map(([frequency, label]) => (
                      <button className={cn("rounded-xl py-2.5 text-sm font-semibold transition", values.frequency === frequency ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")} key={frequency} onClick={() => update("frequency", frequency)} type="button">{label}</button>
                    ))}
                  </div>
                </div>
                {values.frequency === "ONCE" && (
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">Due date</span>
                    <input className={fieldClass} onChange={(event) => update("startsOn", event.target.value)} type="date" value={values.startsOn} />
                  </label>
                )}
                {values.frequency !== "ONCE" && (
                  <>
                    {(values.frequency === "WEEKLY" || values.frequency === "CUSTOM") && (
                      <div>
                        <p className="mb-2 text-sm font-semibold text-slate-700">{values.frequency === "CUSTOM" ? "Repeat on" : "Repeat on"}</p>
                        <div className="grid grid-cols-7 gap-1">
                          {weekdays.map(({ key, short }) => {
                            const selected = values.weekdays.includes(key)
                            return <button aria-label={`Repeat on ${key}`} aria-pressed={selected} className={cn("aspect-square rounded-full text-sm font-bold transition", selected ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200")} key={key} onClick={() => update("weekdays", selected ? values.weekdays.filter((day) => day !== key) : [...values.weekdays, key])} type="button">{short}</button>
                          })}
                        </div>
                      </div>
                    )}
                    {values.frequency === "CUSTOM" && (
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Repeat every (weeks)</span>
                        <input className={fieldClass} max={52} min={2} onChange={(event) => update("interval", Number(event.target.value))} type="number" value={values.interval} />
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-semibold text-slate-700">Starts</span>
                      <input className={fieldClass} onChange={(event) => update("startsOn", event.target.value)} type="date" value={values.startsOn} />
                    </label>
                  </>
                )}
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Due time <span className="font-normal text-slate-400">(optional)</span></span>
                  <input className={fieldClass} onChange={(event) => update("dueTime", event.target.value)} type="time" value={values.dueTime} />
                </label>
                {values.frequency !== "ONCE" && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-700">End date</span>
                      <button aria-pressed={values.hasEnd} className={cn("rounded-full px-3 py-1.5 text-xs font-bold", values.hasEnd ? "bg-teal-100 text-teal-800" : "bg-slate-100 text-slate-600")} onClick={() => update("hasEnd", !values.hasEnd)} type="button">{values.hasEnd ? "On date" : "Never"}</button>
                    </div>
                    {values.hasEnd && <input aria-label="End date" className={fieldClass} onChange={(event) => update("endsOn", event.target.value)} type="date" value={values.endsOn} />}
                  </>
                )}
              </div>
            </section>

            <section className={groupClass}>
              <h2 className="mb-4 text-xs font-black uppercase tracking-wider text-slate-500">Effort & Priority</h2>
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-700">Priority</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {priorities.map((priority) => (
                    <button className={cn("rounded-lg px-1 py-2 text-xs font-bold transition", values.priority === priority.value ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600")} key={priority.value} onClick={() => update("priority", priority.value)} type="button">{priority.label}</button>
                  ))}
                </div>
              </div>
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-slate-700">Effort</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {efforts.map((effort, index) => (
                    <button aria-label={`Effort ${index + 1}: ${effort}`} aria-pressed={values.difficulty === index + 1} className={cn("rounded-lg py-2 text-center transition", values.difficulty === index + 1 ? "bg-teal-50 text-teal-800 ring-1 ring-teal-400" : "bg-slate-50 text-slate-500")} key={effort} onClick={() => update("difficulty", index + 1)} type="button">
                      <span className="block text-sm font-black">{index + 1}</span><span className="block truncate text-[9px] leading-tight">{effort}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Estimated time <span className="font-normal text-slate-400">(optional)</span></span>
                <span className="relative block">
                  <input className={cn(fieldClass, "pr-16")} inputMode="numeric" max={1440} min={1} onChange={(event) => update("estimatedMinutes", event.target.value)} placeholder="20" type="number" value={values.estimatedMinutes} />
                  <span className="pointer-events-none absolute right-3 top-3.5 text-sm text-slate-400">min</span>
                </span>
              </label>
            </section>
            {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}
          </main>
          <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-sm -translate-x-1/2 border-t border-slate-100 bg-white/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur">
            <Button className="h-12 w-full rounded-xl bg-teal-600 font-bold text-white hover:bg-teal-700" disabled={saving} onClick={() => void save()} type="button">
              {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Chore"}
            </Button>
          </div>
        </>
      )}

      {confirmDiscard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="presentation">
          <section aria-labelledby="discard-changes-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" role="dialog">
            <h2 className="font-display text-lg font-black text-slate-900" id="discard-changes-title">Discard changes?</h2>
            <p className="mt-2 text-sm text-slate-500">Your unsaved changes will be lost.</p>
            <div className="mt-5 flex gap-2">
              <Button className="flex-1 rounded-xl" onClick={() => setConfirmDiscard(false)} type="button" variant="outline">Keep editing</Button>
              <Button className="flex-1 rounded-xl bg-teal-600 text-white hover:bg-teal-700" onClick={() => navigate("admin", "chores")} type="button">Discard</Button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
