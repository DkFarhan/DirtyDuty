"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import {
  categoryIcon,
  choreApi,
  type AssignmentStrategy,
  type Chore,
  type ChoreManagementOptions,
  type ChorePriority,
  type ChoreRequest,
} from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import {
  INTERVAL_UNIT,
  MAX_COUNT,
  MAX_INTERVAL,
  MONTHS,
  ORDINALS,
  WEEKDAYS,
  buildRecurrenceRule,
  defaultRecurrence,
  describeRecurrence,
  describeRecurrenceRule,
  parseRecurrenceRule,
  type Frequency,
  type MonthlyMode,
  type Recurrence,
} from "@/lib/household/recurrence"
import { householdChoreResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { cn } from "@/lib/utils"
import { CategoryDialog } from "../category-dialog"
import { useDialogFocus } from "../use-dialog-focus"
import {
  HouseholdLiveDesignHeader,
  HouseholdLiveDesignSectionHeading,
  type PreviewTheme,
} from "../redesign/household-secondary-design-preview"
import designStyles from "../redesign/household-secondary-design-preview.module.css"

const NEW_CATEGORY = "__new-category__"
const efforts = ["Quick", "Light", "Moderate", "Heavy", "Big job"]
const priorities: { value: ChorePriority; label: string; style: string }[] = [
  { value: "LOW", label: "Low", style: "emerald" },
  { value: "NORMAL", label: "Normal", style: "teal" },
  { value: "HIGH", label: "High", style: "amber" },
  { value: "URGENT", label: "Urgent", style: "rose" },
]
type EndMode = "NEVER" | "DATE" | "COUNT"
type FormValues = {
  categoryId: string
  title: string
  description: string
  requiresVerification: boolean
  strategy: AssignmentStrategy
  peopleNeeded: number
  fixedAssignee: string
  participants: string[]
  recurrence: Recurrence
  /** A stored rule this form cannot represent; kept verbatim unless the user picks a new one. */
  customRule: string | null
  seasonal: boolean
  endMode: EndMode
  count: number
  startsOn: string
  endsOn: string
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

function valuesFromChore(chore: Chore): FormValues {
  const schedule = chore.schedule
  const startsOn = schedule?.startsOn ?? localDate()
  const parsed = schedule ? parseRecurrenceRule(schedule.recurrenceRule, startsOn) : null
  // Non-weekly rules carry no weekdays; seed Monday as on create, so switching to Weekly has one.
  const recurrence = parsed
    ? parsed.weekdays.length > 0
      ? parsed
      : { ...parsed, weekdays: ["MO" as const] }
    : { ...defaultRecurrence(startsOn), weekdays: ["MO" as const] }
  return {
    categoryId: chore.categoryId ?? "",
    title: chore.title,
    description: chore.description ?? "",
    requiresVerification: chore.requiresVerification,
    strategy: schedule?.assignmentStrategy ?? "FIXED",
    peopleNeeded: schedule?.peopleNeeded ?? 1,
    fixedAssignee: schedule?.fixedAssigneeUserId ?? "",
    participants: schedule?.participantUserIds ?? [],
    recurrence,
    customRule: schedule && !parsed ? schedule.recurrenceRule : null,
    seasonal: recurrence.activeMonths.length > 0,
    endMode: recurrence.count !== null ? "COUNT" : schedule?.endsOn ? "DATE" : "NEVER",
    count: recurrence.count ?? 10,
    startsOn,
    endsOn: schedule?.endsOn ?? "",
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
    recurrence: { ...defaultRecurrence(localDate()), weekdays: ["MO"] },
    customRule: null,
    seasonal: false,
    endMode: "NEVER",
    count: 10,
    startsOn: localDate(),
    endsOn: "",
    dueTime: "18:00",
    priority: "NORMAL",
    difficulty: 3,
    estimatedMinutes: "",
  }
}

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[15px] text-slate-900 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
const groupClass = "rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
export function ChoreFormScreen({ theme = "light" }: { theme?: PreviewTheme }) {
  const { state, screen, navigate, editingChoreId } = useChoreSync()
  const { activeHousehold: household } = useHouseholds()
  const isEditing = screen === "edit-chore"
  const [values, setValues] = useState(() => initialValues(state.currentUser.id))
  const [options, setOptions] = useState<ChoreManagementOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const canManageCategories =
    household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN"
  const discardDialogRef = useRef<HTMLElement | null>(null)
  const [savedValues, setSavedValues] = useState("")
  const householdId = household?.id
  const { invalidate: invalidateChores } = useDataSync(
    householdId ? householdChoreResource(householdId) : "household:none:chores-and-assignments",
  )
  const serializedValues = useMemo(() => JSON.stringify(values), [values])
  const dirty = savedValues !== "" && serializedValues !== savedValues
  useDialogFocus(
    discardDialogRef,
    confirmDiscard,
    () => setConfirmDiscard(false),
    () => document.querySelector<HTMLElement>("[data-chore-form-back]"),
  )

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
          isEditing && editingChoreId
            ? choreApi.get(householdId, editingChoreId)
            : Promise.resolve(null),
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
          setLoadError(
            cause instanceof ApiError
              ? cause.message
              : "Unable to load chore options. Please try again.",
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [editingChoreId, householdId, isEditing])

  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setError(null)
    setValues((current) => ({ ...current, [key]: value }))
  }
  const updateRecurrence = (patch: Partial<Recurrence>) => {
    setError(null)
    // Any explicit change replaces a custom rule the form could not represent.
    setValues((current) => ({
      ...current,
      customRule: null,
      recurrence: { ...current.recurrence, ...patch },
    }))
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
    const recurrence = values.recurrence
    const repeating = values.customRule === null && recurrence.frequency !== "ONCE"
    if (repeating && recurrence.frequency === "WEEKLY" && recurrence.weekdays.length === 0) {
      setError("Choose at least one day to repeat.")
      return null
    }
    const eligibleCount =
      values.strategy === "FIXED" ? options.activeMembers.length : values.participants.length
    if (
      !Number.isInteger(values.peopleNeeded) ||
      values.peopleNeeded < 1 ||
      values.peopleNeeded > eligibleCount
    ) {
      setError("People needed must be between 1 and the number of eligible members.")
      return null
    }
    const selectedIds =
      values.strategy === "FIXED" && values.peopleNeeded === 1
        ? [values.fixedAssignee]
        : values.participants
    if (
      selectedIds.some(
        (userId) => !options.activeMembers.some((member) => member.userId === userId),
      )
    ) {
      setError("Some selected members are no longer eligible. Update the selection.")
      return null
    }
    if (values.strategy === "FIXED" && values.peopleNeeded === 1 && !values.fixedAssignee) {
      setError("Choose a household member to assign this chore to.")
      return null
    }
    if (
      values.strategy === "FIXED" &&
      values.peopleNeeded > 1 &&
      values.participants.length !== values.peopleNeeded
    ) {
      setError(`Choose exactly ${values.peopleNeeded} members for this chore.`)
      return null
    }
    if (
      (values.strategy === "ROUND_ROBIN" || values.strategy === "RANDOM") &&
      values.participants.length < values.peopleNeeded
    ) {
      setError(`Choose at least ${values.peopleNeeded} eligible members.`)
      return null
    }
    const minutes = values.estimatedMinutes.trim() === "" ? null : Number(values.estimatedMinutes)
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
      setError("Estimated time must be a whole number between 1 and 1440 minutes.")
      return null
    }
    const endsWithDate =
      values.customRule !== null ? Boolean(values.endsOn) : repeating && values.endMode === "DATE"
    if (endsWithDate && values.endsOn && values.endsOn < values.startsOn) {
      setError("The end date cannot be before the start date.")
      return null
    }
    if (endsWithDate && !values.endsOn) {
      setError("Choose an end date, or select Never.")
      return null
    }
    if (repeating) {
      const frequency = recurrence.frequency as Exclude<Frequency, "ONCE">
      const maxInterval = MAX_INTERVAL[frequency]
      if (
        !Number.isInteger(recurrence.interval) ||
        recurrence.interval < 1 ||
        recurrence.interval > maxInterval
      ) {
        setError(
          `Repeat every must be between 1 and ${maxInterval} ${INTERVAL_UNIT[frequency][1]}.`,
        )
        return null
      }
      if (
        frequency === "YEARLY" &&
        recurrence.yearDay > (MONTHS[recurrence.yearMonth - 1]?.days ?? 31)
      ) {
        setError(`Choose a day that exists in ${MONTHS[recurrence.yearMonth - 1]?.label}.`)
        return null
      }
      if (values.seasonal && frequency !== "YEARLY" && recurrence.activeMonths.length === 0) {
        setError("Choose at least one active month.")
        return null
      }
      if (
        values.endMode === "COUNT" &&
        (!Number.isInteger(values.count) || values.count < 1 || values.count > MAX_COUNT)
      ) {
        setError(`The number of times must be between 1 and ${MAX_COUNT}.`)
        return null
      }
    }

    const recurrenceRule =
      values.customRule ??
      buildRecurrenceRule({
        ...recurrence,
        activeMonths:
          repeating && values.seasonal && recurrence.frequency !== "YEARLY"
            ? recurrence.activeMonths
            : [],
        count: repeating && values.endMode === "COUNT" ? values.count : null,
      })

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
        endsOn: endsWithDate ? values.endsOn || null : null,
        dueTime: values.dueTime || null,
        assignmentStrategy: values.strategy,
        peopleNeeded: values.peopleNeeded,
        fixedAssigneeUserId:
          values.strategy === "FIXED" && values.peopleNeeded === 1 ? values.fixedAssignee : null,
        participantUserIds:
          values.strategy === "FIXED" && values.peopleNeeded === 1 ? [] : values.participants,
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
      invalidateChores()
      navigate("admin", "chores")
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Unable to save this chore. Please try again.",
      )
    } finally {
      setSaving(false)
    }
  }

  const formRecurrence = values.recurrence
  const isRepeating = values.customRule === null && formRecurrence.frequency !== "ONCE"
  const repeatingFrequency = (
    formRecurrence.frequency === "ONCE" ? "WEEKLY" : formRecurrence.frequency
  ) as Exclude<Frequency, "ONCE">
  const repeatSummary =
    values.customRule !== null
      ? describeRecurrenceRule(values.customRule, values.startsOn, values.endsOn || null)
      : describeRecurrence(
          {
            ...formRecurrence,
            activeMonths: values.seasonal ? formRecurrence.activeMonths : [],
            count: isRepeating && values.endMode === "COUNT" ? values.count : null,
          },
          isRepeating && values.endMode === "DATE" ? values.endsOn || null : null,
        )

  const memberLabel = (userId: string) =>
    options?.activeMembers.find((member) => member.userId === userId)?.displayName ?? userId
  const eligibleCount =
    values.strategy === "FIXED" ? (options?.activeMembers.length ?? 0) : values.participants.length
  const selectedIds =
    values.strategy === "FIXED" && values.peopleNeeded === 1 && values.fixedAssignee
      ? [values.fixedAssignee]
      : values.participants
  const selectedMembersChanged = selectedIds.some(
    (userId) => !options?.activeMembers.some((member) => member.userId === userId),
  )
  const poolMessage = selectedMembersChanged
    ? "Some selected members are no longer eligible. Update the selection."
    : values.peopleNeeded > eligibleCount
      ? "People needed must be between 1 and the number of eligible members."
      : values.strategy === "FIXED" &&
          values.peopleNeeded > 1 &&
          values.participants.length !== values.peopleNeeded
        ? `Choose exactly ${values.peopleNeeded} members for this chore.`
        : values.strategy !== "FIXED" && values.participants.length < values.peopleNeeded
          ? `Choose at least ${values.peopleNeeded} eligible members.`
          : null

  return (
    <div
      className={`flex min-h-screen flex-col ${`${designStyles.liveRoot} ${designStyles.choreForm} ${designStyles[theme]}`}`}
    >
      {
        <HouseholdLiveDesignHeader
          eyebrow={isEditing ? "Household · Edit routine" : "Household · New routine"}
          heroDescription={
            isEditing
              ? "Update the details together. Changes will apply to future turns."
              : "Choose the details now. You can adjust them as your home changes."
          }
          heroEyebrow={isEditing ? "Keep the rhythm in sync" : "A small thing, shared"}
          heroTitle={
            isEditing ? "Shape the routine to fit your home." : "Build a routine that feels fair."
          }
          household={household?.name ?? "Your household"}
          onBack={leave}
          title={isEditing ? "Edit a chore" : "Create a chore"}
        />
      }

      {loading ? (
        <div aria-label="Loading chore form" className="space-y-4 px-4 py-5">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-36 animate-pulse rounded-2xl bg-white shadow-sm" />
          ))}
        </div>
      ) : loadError ? (
        <div className="px-4 py-6">
          <p
            role="alert"
            className="rounded-2xl border border-rose-100 bg-white p-4 text-sm text-rose-600"
          >
            {loadError}
          </p>
          <Button
            className="mt-4 w-full rounded-xl"
            onClick={() => navigate("admin", "chores")}
            type="button"
            variant="outline"
          >
            Back to chores
          </Button>
        </div>
      ) : !options ? null : (
        <>
          <main className={`flex-1 space-y-4 px-4 pb-28 pt-4 ${designStyles.liveContent}`}>
            <section className={cn(groupClass, designStyles.liveCard)}>
              {
                <HouseholdLiveDesignSectionHeading
                  eyebrow="01 · The details"
                  title="Name the routine"
                />
              }
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Category
                  </span>
                  <span className="relative block">
                    <select
                      className={cn(fieldClass, "appearance-none pr-10")}
                      id="chore-category"
                      onChange={(event) => {
                        // "+ New category" opens the dialog; the controlled value stays put.
                        if (event.target.value === NEW_CATEGORY) setCategoryDialogOpen(true)
                        else update("categoryId", event.target.value)
                      }}
                      value={values.categoryId}
                    >
                      <option value="">
                        {options.categories.length === 0
                          ? "No categories yet"
                          : "Choose a category"}
                      </option>
                      {options.categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {categoryIcon(category.iconKey)} {category.name}
                        </option>
                      ))}
                      {canManageCategories && <option value={NEW_CATEGORY}>+ New category</option>}
                    </select>
                    <ChevronDown
                      aria-hidden="true"
                      className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400"
                    />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Chore name
                  </span>
                  <input
                    className={fieldClass}
                    maxLength={160}
                    onChange={(event) => update("title", event.target.value)}
                    placeholder="e.g. Clean Kitchen"
                    value={values.title}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Description <span className="font-normal text-slate-400">(optional)</span>
                  </span>
                  <textarea
                    className={cn(fieldClass, "min-h-20 resize-y")}
                    onChange={(event) => update("description", event.target.value)}
                    placeholder="Add a few helpful details"
                    value={values.description}
                  />
                </label>
              </div>
            </section>

            <section className={cn(groupClass, designStyles.liveCard)}>
              {
                <HouseholdLiveDesignSectionHeading
                  eyebrow="02 · A fair turn"
                  title="Who takes this on?"
                />
              }
              <label className="mb-4 block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                  People Needed
                </span>
                <input
                  aria-label="People Needed"
                  className={fieldClass}
                  max={
                    values.strategy === "FIXED"
                      ? options.activeMembers.length
                      : Math.max(1, values.participants.length)
                  }
                  min={1}
                  onChange={(event) => update("peopleNeeded", Number(event.target.value))}
                  type="number"
                  value={values.peopleNeeded}
                />
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
                {(
                  [
                    ["FIXED", "Fixed"],
                    ["ROUND_ROBIN", "Rotate"],
                    ["RANDOM", "Random"],
                  ] as const
                ).map(([strategy, label]) => (
                  <button
                    aria-pressed={values.strategy === strategy}
                    className={cn(
                      "rounded-lg px-1 py-2.5 text-xs font-bold transition sm:text-sm",
                      values.strategy === strategy
                        ? "bg-white text-teal-700 shadow-sm"
                        : "text-slate-500",
                    )}
                    key={strategy}
                    onClick={() => update("strategy", strategy)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              {values.strategy === "FIXED" ? (
                values.peopleNeeded === 1 ? (
                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                      Assign to
                    </span>
                    <select
                      className={fieldClass}
                      onChange={(event) => update("fixedAssignee", event.target.value)}
                      value={values.fixedAssignee}
                    >
                      <option value="">Choose a member</option>
                      {options.activeMembers.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-semibold text-slate-700">
                      Select exactly {values.peopleNeeded} members
                    </p>
                    {options.activeMembers.map((member) => {
                      const checked = values.participants.includes(member.userId)
                      return (
                        <button
                          aria-pressed={checked}
                          className={cn(
                            "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left transition",
                            checked
                              ? "border-teal-200 bg-teal-50"
                              : "border-slate-100 hover:bg-slate-50",
                          )}
                          key={member.userId}
                          onClick={() => toggleMember(member.userId)}
                          type="button"
                        >
                          <span
                            className={cn(
                              "flex h-5 w-5 items-center justify-center rounded-md border",
                              checked
                                ? "border-teal-600 bg-teal-600 text-white"
                                : "border-slate-300",
                            )}
                          >
                            {checked && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                          </span>
                          <span className="text-sm font-medium text-slate-800">
                            {member.displayName}
                          </span>
                        </button>
                      )
                    })}
                    <p className="text-xs text-slate-500">
                      {values.participants.length} of {values.peopleNeeded} selected
                    </p>
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
                        className={cn(
                          "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left transition",
                          checked
                            ? "border-teal-200 bg-teal-50"
                            : "border-slate-100 hover:bg-slate-50",
                        )}
                        key={member.userId}
                        onClick={() => toggleMember(member.userId)}
                        type="button"
                      >
                        <span
                          className={cn(
                            "flex h-5 w-5 items-center justify-center rounded-md border",
                            checked ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300",
                          )}
                        >
                          {checked && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                        </span>
                        <span className="text-sm font-medium text-slate-800">
                          {member.displayName}
                        </span>
                      </button>
                    )
                  })}
                  <p className="text-xs text-slate-500">
                    {values.strategy === "ROUND_ROBIN"
                      ? `Rotate ${values.peopleNeeded}/${values.participants.length} people fairly.`
                      : `${values.peopleNeeded} of ${values.participants.length} eligible people are assigned each time.`}
                  </p>
                  {poolMessage && error !== poolMessage && (
                    <p role="alert" className="text-xs font-medium text-rose-600">
                      {poolMessage}
                    </p>
                  )}
                </div>
              )}
              {values.strategy === "FIXED" && poolMessage && error !== poolMessage && (
                <p role="alert" className="mt-2 text-xs font-medium text-rose-600">
                  {poolMessage}
                </p>
              )}
              {values.strategy === "FIXED" && values.fixedAssignee && (
                <p className="mt-2 text-xs text-slate-400">
                  Fixed assignment · {memberLabel(values.fixedAssignee)}
                </p>
              )}
            </section>

            <section className={cn(groupClass, designStyles.liveCard)}>
              {
                <HouseholdLiveDesignSectionHeading
                  eyebrow="03 · The rhythm"
                  title="When should it happen?"
                />
              }
              <div className="space-y-4">
                {values.customRule !== null && (
                  <div
                    className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-300/30"
                    role="note"
                  >
                    <p className="text-sm font-semibold text-amber-900">Custom schedule</p>
                    <p className="mt-1 text-sm text-amber-900">
                      This chore uses a schedule this form cannot edit. It stays as it is unless you
                      choose a new one below.
                    </p>
                  </div>
                )}
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-slate-700">Repeats</legend>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {(
                      [
                        ["ONCE", "One time"],
                        ["DAILY", "Daily"],
                        ["WEEKLY", "Weekly"],
                        ["MONTHLY", "Monthly"],
                        ["YEARLY", "Yearly"],
                      ] as const
                    ).map(([frequency, label]) => {
                      const selected =
                        values.customRule === null && formRecurrence.frequency === frequency
                      return (
                        <button
                          aria-pressed={selected}
                          className={cn(
                            "min-h-11 rounded-xl px-2 py-2.5 text-sm font-semibold transition",
                            selected
                              ? "bg-teal-600 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                          )}
                          key={frequency}
                          onClick={() => updateRecurrence({ frequency })}
                          type="button"
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
                {isRepeating && (
                  <div>
                    <label
                      className="mb-1.5 block text-sm font-semibold text-slate-700"
                      htmlFor="chore-repeat-interval"
                    >
                      Repeat every
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        aria-describedby="chore-repeat-interval-unit"
                        className={cn(fieldClass, "w-24")}
                        id="chore-repeat-interval"
                        inputMode="numeric"
                        max={MAX_INTERVAL[repeatingFrequency]}
                        min={1}
                        onChange={(event) =>
                          updateRecurrence({ interval: Number(event.target.value) })
                        }
                        type="number"
                        value={formRecurrence.interval}
                      />
                      <span className="text-sm text-slate-600" id="chore-repeat-interval-unit">
                        {INTERVAL_UNIT[repeatingFrequency][formRecurrence.interval === 1 ? 0 : 1]}
                      </span>
                    </div>
                  </div>
                )}
                {isRepeating && formRecurrence.frequency === "WEEKLY" && (
                  <fieldset>
                    <legend className="mb-2 text-sm font-semibold text-slate-700">Repeat on</legend>
                    <div className="grid grid-cols-7 gap-1">
                      {WEEKDAYS.map(({ key, label, short }) => {
                        const selected = formRecurrence.weekdays.includes(key)
                        return (
                          <button
                            aria-label={label}
                            aria-pressed={selected}
                            className={cn(
                              // The ::before extends the tap target to 44px without growing the chip.
                              "relative aspect-square rounded-full text-sm font-bold transition before:absolute before:-inset-1 before:content-['']",
                              selected
                                ? "bg-teal-600 text-white"
                                : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                            )}
                            key={key}
                            onClick={() =>
                              updateRecurrence({
                                weekdays: selected
                                  ? formRecurrence.weekdays.filter((day) => day !== key)
                                  : [...formRecurrence.weekdays, key],
                              })
                            }
                            type="button"
                          >
                            {short.charAt(0)}
                          </button>
                        )
                      })}
                    </div>
                  </fieldset>
                )}
                {isRepeating && formRecurrence.frequency === "MONTHLY" && (
                  <fieldset className="space-y-3">
                    <legend className="mb-2 text-sm font-semibold text-slate-700">
                      Monthly on
                    </legend>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          ["DAY", "Date"],
                          ["WEEKDAY", "Weekday"],
                          ["LAST_DAY", "Last day"],
                        ] as [MonthlyMode, string][]
                      ).map(([mode, label]) => (
                        <button
                          aria-pressed={formRecurrence.monthlyMode === mode}
                          className={cn(
                            "min-h-11 rounded-xl px-2 py-2.5 text-sm font-semibold transition",
                            formRecurrence.monthlyMode === mode
                              ? "bg-teal-600 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                          )}
                          key={mode}
                          onClick={() => updateRecurrence({ monthlyMode: mode })}
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {formRecurrence.monthlyMode === "DAY" && (
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                          Day of the month
                        </span>
                        <select
                          className={fieldClass}
                          onChange={(event) =>
                            updateRecurrence({ monthDay: Number(event.target.value) })
                          }
                          value={formRecurrence.monthDay}
                        >
                          {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                            <option key={day} value={day}>
                              {day}
                            </option>
                          ))}
                        </select>
                        {formRecurrence.monthDay >= 29 && (
                          <span className="mt-1.5 block text-xs text-slate-500">
                            In shorter months this falls on the last day.
                          </span>
                        )}
                      </label>
                    )}
                    {formRecurrence.monthlyMode === "WEEKDAY" && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                            Which one
                          </span>
                          <select
                            className={fieldClass}
                            onChange={(event) =>
                              updateRecurrence({ ordinal: Number(event.target.value) })
                            }
                            value={formRecurrence.ordinal}
                          >
                            {ORDINALS.map((ordinal) => (
                              <option key={ordinal.value} value={ordinal.value}>
                                {ordinal.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                            Weekday
                          </span>
                          <select
                            className={fieldClass}
                            onChange={(event) =>
                              updateRecurrence({
                                ordinalWeekday: event.target.value as Recurrence["ordinalWeekday"],
                              })
                            }
                            value={formRecurrence.ordinalWeekday}
                          >
                            {WEEKDAYS.map((day) => (
                              <option key={day.key} value={day.key}>
                                {day.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                  </fieldset>
                )}
                {isRepeating && formRecurrence.frequency === "YEARLY" && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                        Month
                      </span>
                      <select
                        className={fieldClass}
                        onChange={(event) => {
                          const yearMonth = Number(event.target.value)
                          updateRecurrence({
                            yearMonth,
                            yearDay: Math.min(formRecurrence.yearDay, MONTHS[yearMonth - 1].days),
                          })
                        }}
                        value={formRecurrence.yearMonth}
                      >
                        {MONTHS.map((month) => (
                          <option key={month.value} value={month.value}>
                            {month.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-semibold text-slate-700">Day</span>
                      <select
                        className={fieldClass}
                        onChange={(event) =>
                          updateRecurrence({ yearDay: Number(event.target.value) })
                        }
                        value={formRecurrence.yearDay}
                      >
                        {Array.from(
                          { length: MONTHS[formRecurrence.yearMonth - 1]?.days ?? 31 },
                          (_, index) => index + 1,
                        ).map((day) => (
                          <option key={day} value={day}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    {isRepeating || values.customRule !== null ? "Starts" : "Due date"}
                  </span>
                  <input
                    className={fieldClass}
                    onChange={(event) => update("startsOn", event.target.value)}
                    type="date"
                    value={values.startsOn}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Due time <span className="font-normal text-slate-400">(optional)</span>
                  </span>
                  <input
                    className={fieldClass}
                    onChange={(event) => update("dueTime", event.target.value)}
                    type="time"
                    value={values.dueTime}
                  />
                </label>
                {isRepeating && (
                  <fieldset className="space-y-3">
                    <legend className="mb-2 text-sm font-semibold text-slate-700">Ends</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          ["NEVER", "Never"],
                          ["DATE", "On date"],
                          ["COUNT", "After"],
                        ] as [EndMode, string][]
                      ).map(([mode, label]) => (
                        <button
                          aria-pressed={values.endMode === mode}
                          className={cn(
                            "min-h-11 rounded-xl px-2 py-2.5 text-sm font-semibold transition",
                            values.endMode === mode
                              ? "bg-teal-600 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                          )}
                          key={mode}
                          onClick={() => update("endMode", mode)}
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {values.endMode === "DATE" && (
                      <input
                        aria-label="End date"
                        className={fieldClass}
                        onChange={(event) => update("endsOn", event.target.value)}
                        type="date"
                        value={values.endsOn}
                      />
                    )}
                    {values.endMode === "COUNT" && (
                      <div className="flex items-center gap-3">
                        <input
                          aria-label="Number of times"
                          className={cn(fieldClass, "w-24")}
                          inputMode="numeric"
                          max={MAX_COUNT}
                          min={1}
                          onChange={(event) => update("count", Number(event.target.value))}
                          type="number"
                          value={values.count}
                        />
                        <span className="text-sm text-slate-600">
                          {values.count === 1 ? "time" : "times"}
                        </span>
                      </div>
                    )}
                  </fieldset>
                )}
                {isRepeating && formRecurrence.frequency !== "YEARLY" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className="text-sm font-semibold text-slate-700"
                        id="chore-active-months"
                      >
                        Active months
                      </span>
                      <button
                        aria-describedby="chore-active-months"
                        aria-pressed={values.seasonal}
                        className={cn(
                          "relative rounded-full px-3 py-1.5 text-xs font-bold before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']",
                          values.seasonal
                            ? "bg-teal-100 text-teal-800"
                            : "bg-slate-100 text-slate-600",
                        )}
                        onClick={() => update("seasonal", !values.seasonal)}
                        type="button"
                      >
                        {values.seasonal ? "Selected months" : "All year"}
                      </button>
                    </div>
                    {values.seasonal && (
                      <div
                        aria-labelledby="chore-active-months"
                        className="grid grid-cols-6 gap-1.5"
                        role="group"
                      >
                        {MONTHS.map((month) => {
                          const selected = formRecurrence.activeMonths.includes(month.value)
                          return (
                            <button
                              aria-label={month.label}
                              aria-pressed={selected}
                              className={cn(
                                "min-h-11 rounded-lg text-xs font-bold transition",
                                selected
                                  ? "bg-teal-600 text-white"
                                  : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                              )}
                              key={month.value}
                              onClick={() =>
                                updateRecurrence({
                                  activeMonths: selected
                                    ? formRecurrence.activeMonths.filter(
                                        (value) => value !== month.value,
                                      )
                                    : [...formRecurrence.activeMonths, month.value],
                                })
                              }
                              type="button"
                            >
                              {month.short}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
                <p
                  aria-live="polite"
                  className="rounded-xl bg-teal-50 px-3.5 py-3 text-sm font-semibold text-teal-900"
                  data-testid="repeat-summary"
                >
                  {repeatSummary}
                </p>
              </div>
            </section>

            <section className={cn(groupClass, designStyles.liveCard)}>
              {
                <HouseholdLiveDesignSectionHeading
                  eyebrow="04 · The effort"
                  title="Set a helpful baseline"
                />
              }
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-700">Priority</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {priorities.map((priority) => (
                    <button
                      aria-pressed={values.priority === priority.value}
                      className={cn(
                        "rounded-lg px-1 py-2 text-xs font-bold transition",
                        values.priority === priority.value
                          ? "bg-teal-600 text-white"
                          : "bg-slate-100 text-slate-600",
                      )}
                      key={priority.value}
                      onClick={() => update("priority", priority.value)}
                      type="button"
                    >
                      {priority.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-slate-700">Effort</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {efforts.map((effort, index) => (
                    <button
                      aria-label={`Effort ${index + 1}: ${effort}`}
                      aria-pressed={values.difficulty === index + 1}
                      className={cn(
                        "rounded-lg py-2 text-center transition",
                        values.difficulty === index + 1
                          ? "bg-teal-50 text-teal-800 ring-1 ring-teal-400"
                          : "bg-slate-50 text-slate-500",
                      )}
                      key={effort}
                      onClick={() => update("difficulty", index + 1)}
                      type="button"
                    >
                      <span className="block text-sm font-black">{index + 1}</span>
                      <span className="block truncate text-[9px] leading-tight">{effort}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Estimated time <span className="font-normal text-slate-400">(optional)</span>
                </span>
                <span className="relative block">
                  <input
                    className={cn(fieldClass, "pr-16")}
                    inputMode="numeric"
                    max={1440}
                    min={1}
                    onChange={(event) => update("estimatedMinutes", event.target.value)}
                    placeholder="20"
                    type="number"
                    value={values.estimatedMinutes}
                  />
                  <span className="pointer-events-none absolute right-3 top-3.5 text-sm text-slate-400">
                    min
                  </span>
                </span>
              </label>
            </section>
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
              >
                {error}
              </p>
            )}
          </main>
          <div
            className={`fixed bottom-0 z-40 w-full border-t border-slate-100 bg-white/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur ${`left-0 max-w-none ${designStyles.liveFormFooter}`}`}
          >
            <Button
              className="h-12 w-full rounded-xl bg-teal-600 font-bold text-white hover:bg-teal-700"
              disabled={saving}
              onClick={() => void save()}
              type="button"
            >
              {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Chore"}
            </Button>
          </div>
        </>
      )}

      {categoryDialogOpen && householdId && (
        <CategoryDialog
          getFallbackFocus={() => document.getElementById("chore-category")}
          householdId={householdId}
          onCancel={() => setCategoryDialogOpen(false)}
          onSaved={(category) => {
            setOptions((current) =>
              current ? { ...current, categories: [...current.categories, category] } : current,
            )
            update("categoryId", category.id)
            setCategoryDialogOpen(false)
            // Home, My Chores and the admin list read categories; let them refresh.
            invalidateChores()
          }}
        />
      )}

      {confirmDiscard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          role="presentation"
        >
          <section
            aria-labelledby="discard-changes-title"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            role="dialog"
            ref={discardDialogRef}
            tabIndex={-1}
          >
            <h2
              className="font-display text-lg font-black text-slate-900"
              id="discard-changes-title"
            >
              Discard changes?
            </h2>
            <p className="mt-2 text-sm text-slate-500">Your unsaved changes will be lost.</p>
            <div className="mt-5 flex gap-2">
              <Button
                className="flex-1 rounded-xl"
                onClick={() => setConfirmDiscard(false)}
                type="button"
                variant="outline"
              >
                Keep editing
              </Button>
              <Button
                className="flex-1 rounded-xl bg-teal-600 text-white hover:bg-teal-700"
                onClick={() => navigate("admin", "chores")}
                type="button"
              >
                Discard
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
