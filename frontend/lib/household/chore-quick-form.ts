import type {
  AssignmentStrategy,
  Chore,
  ChorePriority,
  ChoreRequest,
  IntervalUnit,
  ScheduleKind,
} from "./chores"
import {
  findCategoryByName,
  guessCategoryName,
  suggestedStepsFor,
  type ChoreSuggestion,
} from "./chore-suggestions"
import {
  INTERVAL_UNIT,
  MAX_COUNT,
  MAX_INTERVAL,
  MONTHS,
  WEEKDAYS,
  buildRecurrenceRule,
  defaultRecurrence,
  describeRecurrence,
  parseRecurrenceRule,
  type Frequency,
  type Recurrence,
  type Weekday,
} from "./recurrence"

/**
 * The "Quick create" chore form's model: plain-English choices for how often and who, mapped to
 * and from the backend's ChoreRequest. Kept free of React so every mapping is unit tested.
 */

/** The "How often" sheet's options. CUSTOM is the advanced recurrence editor (or a kept rule). */
export type OftenChoice =
  "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "AFTER_COMPLETION" | "AS_NEEDED" | "ONCE" | "CUSTOM"

/**
 * The "Who" sheet's options. SOMEONE is "Specific people": one person, or several who do it
 * together every time. WEEKS is "Week by week": one person has it for a week or more, then the next.
 */
export type WhoChoice = "ME" | "TURNS" | "WEEKS" | "BALANCED" | "SOMEONE" | "RANDOM"

/** Week by week lengths: the "Custom" stepper goes from 1 to this many weeks. */
export const MAX_ROTATION_WEEKS = 8
export const DEFAULT_ROTATION_WEEKS = 2

export type EndMode = "NEVER" | "DATE" | "COUNT"

/** The advanced recurrence editor's values ("Custom…"). */
export type CustomSchedule = {
  recurrence: Recurrence
  seasonal: boolean
  endMode: EndMode
  count: number
  endsOn: string
}

/** Fields a suggestion may fill, unless the user changed them. */
export type QuickField = "often" | "who" | "category" | "priority" | "difficulty" | "minutes"

export type QuickValues = {
  title: string
  description: string
  categoryId: string | null
  /** "guess" follows the name; "set" was chosen (by the user, a suggestion or the saved chore). */
  categorySource: "guess" | "set"
  often: OftenChoice
  /** The day "Every week" and "Every 2 weeks" fall on. */
  anchorWeekday: Weekday
  /** The day of the month "Every month" falls on. */
  anchorMonthDay: number
  /** Start date; the date for "Just once"; the first due date for "After it's done". */
  startsOn: string
  /** "HH:mm", or "" for none. */
  dueTime: string
  afterCount: number
  afterUnit: IntervalUnit
  backstopEnabled: boolean
  backstopDays: number
  custom: CustomSchedule
  /** A saved rule the editor cannot represent, sent back unchanged while often is CUSTOM. */
  keptRule: string | null
  keptEndsOn: string | null
  who: WhoChoice
  /** Rotation order for TURNS and WEEKS; the pool for BALANCED and RANDOM. */
  participants: string[]
  /**
   * The pool is "everyone": every member now and anyone who joins later. Choosing people in
   * "Change" makes it a fixed list.
   */
  everyone: boolean
  /** Week by week: how many weeks each person has it. */
  rotationWeeks: number
  /** The ticked people for SOMEONE ("Specific people"); they all do it together. */
  specificPeople: string[]
  /** People per occurrence for TURNS, BALANCED and RANDOM; only calendar kinds use more than one. */
  peopleNeeded: number
  priority: ChorePriority
  difficulty: number
  estimatedMinutes: number | null
  requiresVerification: boolean
  /** The optional checklist (E12), in order. */
  steps: StepDraft[]
  /**
   * The user changed the steps (or they came from a saved chore): a name that matches a built-in
   * suggestion no longer fills them in.
   */
  stepsEdited: boolean
  touched: QuickField[]
}

/** One step in the form. {@link key} is for React; {@link id} is the saved step's id, if any. */
export type StepDraft = { key: string; id: string | null; text: string; suggested: boolean }

export const MAX_STEPS = 15
export const MAX_STEP_LENGTH = 80

let stepKeySeed = 0
function stepKey() {
  stepKeySeed += 1
  return `step-${stepKeySeed}`
}

function draftsFrom(texts: readonly string[], suggested: boolean): StepDraft[] {
  return texts.map((text) => ({ key: stepKey(), id: null, text, suggested }))
}

/**
 * On create, a name that matches a built-in suggestion with steps fills them in (marked
 * "Suggested") until the user changes the steps; any other name clears suggested ones.
 */
function withSuggestedSteps(values: QuickValues, texts: readonly string[]): QuickValues {
  if (values.stepsEdited) return values
  const same =
    values.steps.length === texts.length &&
    values.steps.every((step, index) => step.text === texts[index])
  return same ? values : { ...values, steps: draftsFrom(texts, true) }
}

/** Adds a step at the end; blank text or a full list changes nothing. */
export function addStep(values: QuickValues, text: string): QuickValues {
  const trimmed = text.trim().slice(0, MAX_STEP_LENGTH)
  if (!trimmed || values.steps.length >= MAX_STEPS) return values
  return {
    ...values,
    steps: [...values.steps, { key: stepKey(), id: null, text: trimmed, suggested: false }],
    stepsEdited: true,
  }
}

export function removeStep(values: QuickValues, key: string): QuickValues {
  return { ...values, steps: values.steps.filter((step) => step.key !== key), stepsEdited: true }
}

/** Renames a step; a saved step keeps its id, so its ticks stay. */
export function renameStep(values: QuickValues, key: string, text: string): QuickValues {
  return {
    ...values,
    steps: values.steps.map((step) =>
      step.key === key ? { ...step, text: text.slice(0, MAX_STEP_LENGTH), suggested: false } : step,
    ),
    stepsEdited: true,
  }
}

/** Moves a step up (-1) or down (+1), or to another step's place when dragged. */
export function moveStep(values: QuickValues, key: string, to: number): QuickValues {
  const from = values.steps.findIndex((step) => step.key === key)
  if (from < 0 || to < 0 || to >= values.steps.length || to === from) return values
  const steps = [...values.steps]
  const [moved] = steps.splice(from, 1)
  steps.splice(to, 0, moved)
  return { ...values, steps, stepsEdited: true }
}

/** Removes every suggested step at once ("Suggested · Remove all"). */
export function clearSuggestedSteps(values: QuickValues): QuickValues {
  return { ...values, steps: values.steps.filter((step) => !step.suggested), stepsEdited: true }
}

export function stepsLabel(count: number) {
  return count === 1 ? "1 step" : `${count} steps`
}

export type Member = { userId: string; displayName: string }

export const EFFORTS = ["Quick", "Light", "Moderate", "Heavy", "Big job"] as const
export const PRIORITIES: { value: ChorePriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
]
export const MAX_AFTER: Record<IntervalUnit, number> = { DAY: 365, WEEK: 52 }
export const MAX_BACKSTOP_DAYS = 30
export const MAX_MINUTES = 1440
export const MAX_TITLE_LENGTH = 160
const DEFAULT_DUE_TIME = "18:00"

/** Today's date (YYYY-MM-DD) in the household's timezone, falling back to the device's. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(now)
  } catch {
    const offset = now.getTimezoneOffset() * 60_000
    return new Date(now.getTime() - offset).toISOString().slice(0, 10)
  }
}

/** The wall-clock time ("HH:mm") in the household's timezone, falling back to the device's. */
export function clockIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(now)
  } catch {
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  }
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * The first date a new chore can start without being overdue: today if its due time is still
 * ahead in the household timezone, else tomorrow. Weekly and monthly choices keep today's weekday
 * and day of the month, so starting tomorrow means their next matching date.
 */
export function firstStartsOn(context: QuickContext, dueTime: string): string {
  const today = context.today ?? todayIn(context.timezone)
  if (!dueTime) return today
  // A fixed "today" (tests, previews) counts from the start of that day unless a time is given.
  const clock = context.now ?? (context.today ? "00:00" : clockIn(context.timezone))
  return clock < dueTime ? today : addDays(today, 1)
}

function weekdayOf(isoDate: string): Weekday {
  return defaultRecurrence(isoDate).weekdays[0]
}

function dayOfMonth(isoDate: string) {
  return Number(isoDate.slice(8, 10)) || 1
}

function customFrom(startsOn: string, recurrence?: Recurrence): CustomSchedule {
  const base = recurrence ?? defaultRecurrence(startsOn)
  return {
    recurrence: base.frequency === "ONCE" ? { ...base, frequency: "WEEKLY" } : base,
    seasonal: base.activeMonths.length > 0,
    endMode: base.count !== null ? "COUNT" : "NEVER",
    count: base.count ?? 10,
    endsOn: "",
  }
}

export type QuickContext = {
  viewerId: string
  members: Member[]
  timezone: string
  /** Defaults to today in the household timezone. */
  today?: string
  /** "HH:mm" now in the household timezone; defaults to the clock (or 00:00 with a fixed today). */
  now?: string
}

function everyone(context: QuickContext) {
  return context.members.map((member) => member.userId)
}

/** A new chore: weekly on today's weekday; turns between everyone, or just the viewer. */
export function initialQuickValues(context: QuickContext): QuickValues {
  const today = context.today ?? todayIn(context.timezone)
  const shared = context.members.length > 1
  return {
    title: "",
    description: "",
    categoryId: null,
    categorySource: "guess",
    often: "WEEKLY",
    anchorWeekday: weekdayOf(today),
    anchorMonthDay: dayOfMonth(today),
    // A chore made after 6 PM starts on its next date instead of being overdue straight away.
    startsOn: firstStartsOn({ ...context, today }, DEFAULT_DUE_TIME),
    dueTime: DEFAULT_DUE_TIME,
    afterCount: 3,
    afterUnit: "DAY",
    backstopEnabled: true,
    backstopDays: 2,
    custom: customFrom(today),
    keptRule: null,
    keptEndsOn: null,
    who: shared ? "TURNS" : "ME",
    participants: everyone(context),
    everyone: true,
    rotationWeeks: DEFAULT_ROTATION_WEEKS,
    specificPeople: [],
    peopleNeeded: 1,
    priority: "NORMAL",
    difficulty: 3,
    estimatedMinutes: null,
    requiresVerification: false,
    steps: [],
    stepsEdited: false,
    touched: [],
  }
}

/** Splits a parsed calendar rule into a simple choice when one says exactly the same thing. */
function simpleChoice(recurrence: Recurrence, endsOn: string | null): OftenChoice | null {
  if (recurrence.frequency === "ONCE") return "ONCE"
  if (recurrence.activeMonths.length > 0 || recurrence.count !== null || endsOn) return null
  if (recurrence.frequency === "DAILY" && recurrence.interval === 1) return "DAILY"
  if (recurrence.frequency === "WEEKLY" && recurrence.weekdays.length === 1) {
    if (recurrence.interval === 1) return "WEEKLY"
    if (recurrence.interval === 2) return "BIWEEKLY"
  }
  if (
    recurrence.frequency === "MONTHLY" &&
    recurrence.interval === 1 &&
    recurrence.monthlyMode === "DAY"
  ) {
    return "MONTHLY"
  }
  return null
}

export type LoadedQuickValues = {
  values: QuickValues
  /** People in the saved rotation or assignment who are no longer active members. */
  removedMembers: number
  /** The saved people per occurrence when too few people are left; the form lowered it. */
  shortfall: { needed: number; left: number } | null
}

/** A saved chore as form values. Members who left are dropped from its people. */
export function valuesFromChore(chore: Chore, context: QuickContext): LoadedQuickValues {
  const today = context.today ?? todayIn(context.timezone)
  const schedule = chore.schedule
  const kind: ScheduleKind = schedule?.kind ?? "CALENDAR"
  const startsOn = schedule?.startsOn ?? today
  const endsOn = schedule?.endsOn ?? null
  const base = initialQuickValues({ ...context, today })
  const active = new Set(everyone(context))

  let often: OftenChoice = "WEEKLY"
  let custom = customFrom(startsOn)
  let keptRule: string | null = null
  let keptEndsOn: string | null = null
  let anchorWeekday = weekdayOf(startsOn)
  let anchorMonthDay = dayOfMonth(startsOn)
  if (kind === "AFTER_COMPLETION" || kind === "AS_NEEDED") {
    often = kind
  } else if (schedule?.recurrenceRule) {
    const parsed = parseRecurrenceRule(schedule.recurrenceRule, startsOn)
    if (!parsed) {
      often = "CUSTOM"
      keptRule = schedule.recurrenceRule
      keptEndsOn = endsOn
    } else {
      const simple = simpleChoice(parsed, endsOn)
      if (simple) {
        often = simple
        if (simple === "WEEKLY" || simple === "BIWEEKLY") anchorWeekday = parsed.weekdays[0]
        if (simple === "MONTHLY") anchorMonthDay = parsed.monthDay
        custom = customFrom(startsOn, simple === "ONCE" ? undefined : parsed)
      } else {
        often = "CUSTOM"
        custom = {
          recurrence:
            parsed.weekdays.length > 0 ? parsed : { ...parsed, weekdays: [anchorWeekday] },
          seasonal: parsed.activeMonths.length > 0,
          endMode: parsed.count !== null ? "COUNT" : endsOn ? "DATE" : "NEVER",
          count: parsed.count ?? 10,
          endsOn: endsOn ?? "",
        }
      }
    }
  }

  const strategy = schedule?.assignmentStrategy ?? "FIXED"
  const savedNeeded = Math.max(1, schedule?.peopleNeeded ?? 1)
  const savedFixed = schedule?.fixedAssigneeUserId ?? ""
  // The backend also fills fixedAssigneeUserId for a fixed group (with its first person), so the
  // participant list wins; fixedAssigneeUserId alone is an older single-person chore.
  const savedParticipants = schedule?.participantUserIds ?? []
  const savedPeople =
    strategy === "FIXED" && savedParticipants.length === 0 && savedFixed
      ? [savedFixed]
      : savedParticipants
  const people = savedPeople.filter((userId) => active.has(userId))
  const removedMembers = savedPeople.length - people.length
  let who: WhoChoice
  let peopleNeeded = 1
  let shortfall: LoadedQuickValues["shortfall"] = null
  if (strategy === "FIXED") {
    const solo = people.length === 1 && people[0] === context.viewerId
    who = solo && savedNeeded === 1 ? "ME" : "SOMEONE"
    if (savedNeeded > 1 && people.length < savedNeeded && people.length > 0) {
      shortfall = { needed: savedNeeded, left: people.length }
    }
  } else {
    who =
      strategy === "RANDOM"
        ? "RANDOM"
        : strategy === "BALANCED"
          ? "BALANCED"
          : schedule?.rotationWeeks
            ? "WEEKS"
            : "TURNS"
    peopleNeeded = savedNeeded
    if (savedNeeded > 1 && people.length < savedNeeded) {
      shortfall = { needed: savedNeeded, left: people.length }
      peopleNeeded = Math.max(1, people.length)
    }
  }

  return {
    removedMembers,
    shortfall,
    values: {
      ...base,
      title: chore.title,
      description: chore.description ?? "",
      categoryId: chore.categoryId,
      categorySource: "set",
      often,
      anchorWeekday,
      anchorMonthDay,
      startsOn,
      dueTime: schedule?.dueTime?.slice(0, 5) ?? "",
      afterCount: schedule?.intervalCount ?? 3,
      afterUnit: schedule?.intervalUnit ?? "DAY",
      backstopEnabled: kind !== "AS_NEEDED" || schedule?.backstopDays != null,
      backstopDays: schedule?.backstopDays ?? 2,
      custom,
      keptRule,
      keptEndsOn,
      who,
      participants: usesPool(who) ? people : base.participants,
      // A saved chore is "everyone" only when it was saved that way; an old list stays a list.
      everyone: usesPool(who) ? (schedule?.everyone ?? false) : base.everyone,
      rotationWeeks: schedule?.rotationWeeks ?? DEFAULT_ROTATION_WEEKS,
      specificPeople: who === "SOMEONE" ? people : [],
      peopleNeeded,
      priority: chore.defaultPriority,
      difficulty: chore.difficulty,
      estimatedMinutes: chore.estimatedMinutes,
      requiresVerification: chore.requiresVerification,
      // A saved chore's steps are the user's: a name change never replaces them.
      steps: (chore.steps ?? []).map((step) => ({
        key: stepKey(),
        id: step.id,
        text: step.text,
        suggested: false,
      })),
      stepsEdited: true,
      touched: ["often", "who", "category", "priority", "difficulty", "minutes"],
    },
  }
}

/**
 * Duplicate chore: a saved chore's setup as a new chore titled "<Title> (copy)". A start date that
 * has passed moves to the first date a new chore can start.
 */
export function copyValues(chore: Chore, context: QuickContext): LoadedQuickValues {
  const loaded = valuesFromChore(chore, context)
  const values = loaded.values
  const firstStart = firstStartsOn(context, values.dueTime)
  const suffix = " (copy)"
  return {
    ...loaded,
    values: {
      ...values,
      title: `${values.title.slice(0, MAX_TITLE_LENGTH - suffix.length)}${suffix}`,
      // The copy is a new chore, so its steps are new steps.
      steps: values.steps.map((step) => ({ ...step, key: stepKey(), id: null })),
      startsOn:
        values.often !== "AS_NEEDED" && values.startsOn < firstStart ? firstStart : values.startsOn,
    },
  }
}

function touch(values: QuickValues, field: QuickField): QuickField[] {
  return values.touched.includes(field) ? values.touched : [...values.touched, field]
}

/** Only calendar kinds (including "Just once") can have more than one person each time. */
export function allowsGroups(often: OftenChoice) {
  return !isOpenCopy(often)
}

/**
 * Take turns, Week by week, Balanced and Mix it up pick from a pool of people ("Change" for who's
 * included).
 */
export function usesPool(who: WhoChoice) {
  return who === "TURNS" || who === "WEEKS" || who === "BALANCED" || who === "RANDOM"
}

/** Week by week is for chores that repeat on a schedule: not one-time, After it's done or When needed. */
export function allowsWeekByWeek(often: OftenChoice) {
  return often !== "ONCE" && !isOpenCopy(often)
}

/**
 * "Mix it up" and "Balanced" don't fit "When it's needed" (it keeps its turns), and the open-copy
 * kinds are done by one person: a rotation drops to one at a time and Specific people keeps only
 * the first ticked person.
 */
function compatibleWho(values: QuickValues): QuickValues {
  let next = values
  if (next.often === "AS_NEEDED" && (next.who === "RANDOM" || next.who === "BALANCED")) {
    next = { ...next, who: "TURNS" }
  }
  // Week by week falls back to Take turns, and is always one person at a time.
  if (next.who === "WEEKS" && !allowsWeekByWeek(next.often)) next = { ...next, who: "TURNS" }
  if (next.who === "WEEKS" && next.peopleNeeded !== 1) next = { ...next, peopleNeeded: 1 }
  if (!allowsGroups(next.often)) {
    if (next.peopleNeeded !== 1) next = { ...next, peopleNeeded: 1 }
    if (next.specificPeople.length > 1) {
      next = { ...next, specificPeople: next.specificPeople.slice(0, 1) }
    }
  }
  return next
}

/** How many people a rotation or random pick can be "each time": 1 to everyone but one. */
export function eachTimeRange(values: QuickValues, members: Member[]): number {
  if (!allowsGroups(values.often) || values.who === "WEEKS") return 1
  const count = activePeople(values, members).length
  // A saved chore may already use everyone each time; keep showing that value.
  return Math.max(1, count - 1, Math.min(values.peopleNeeded, count))
}

/** A new rotation or pool; "Each time" is lowered so it always leaves someone out. */
export function withParticipants(
  values: QuickValues,
  participants: string[],
  members: Member[],
): QuickValues {
  const active = new Set(members.map((member) => member.userId))
  const count = participants.filter((userId) => active.has(userId)).length
  const peopleNeeded =
    values.peopleNeeded > 1 ? Math.max(1, Math.min(values.peopleNeeded, count - 1)) : 1
  // Choosing people makes a fixed list: someone who joins later isn't added.
  return withField(values, "who", { participants, peopleNeeded, everyone: false })
}

/** Number of people who do it each time, as the request will send it. */
export function peopleEachTime(values: QuickValues, members: Member[]): number {
  if (values.who === "ME") return 1
  if (values.who === "SOMEONE") return Math.max(1, activeSpecific(values, members).length)
  if (values.who === "WEEKS") return 1
  return allowsGroups(values.often) ? Math.max(1, values.peopleNeeded) : 1
}

/** A new name; the category follows it while it is still a guess. */
export function withTitle<T extends { id: string; name: string }>(
  values: QuickValues,
  title: string,
  categories: readonly T[],
): QuickValues {
  const named = withSuggestedSteps({ ...values, title }, suggestedStepsFor(title))
  if (values.categorySource !== "guess") return named
  return {
    ...named,
    categoryId: findCategoryByName(categories, guessCategoryName(title))?.id ?? null,
  }
}

/** The user picked a "How often" option. */
export function withOften(
  values: QuickValues,
  often: OftenChoice,
  patch: Partial<QuickValues> = {},
): QuickValues {
  return compatibleWho({
    ...values,
    ...patch,
    often,
    keptRule: often === "CUSTOM" ? (patch.keptRule ?? values.keptRule) : null,
    keptEndsOn: often === "CUSTOM" ? (patch.keptEndsOn ?? values.keptEndsOn) : null,
    touched: touch(values, "often"),
  })
}

/** Any other user change; marks the field so a later suggestion leaves it alone. */
export function withField(
  values: QuickValues,
  field: QuickField,
  patch: Partial<QuickValues>,
): QuickValues {
  return compatibleWho({ ...values, ...patch, touched: touch(values, field) })
}

/**
 * Fills the form from a suggestion. The title always changes; every other field changes only if
 * the user hasn't set it.
 */
export function applySuggestion<T extends { id: string; name: string }>(
  values: QuickValues,
  suggestion: ChoreSuggestion,
  categories: readonly T[],
  context: QuickContext,
): QuickValues {
  const touched = new Set(values.touched)
  let next: QuickValues = withSuggestedSteps(
    { ...values, title: suggestion.title },
    suggestion.steps ?? [],
  )
  if (!touched.has("often")) {
    const often = suggestion.often
    const dueTime = suggestion.dueTime ?? next.dueTime
    next = {
      ...next,
      dueTime,
      // The suggestion's own time decides whether today is still possible.
      startsOn: firstStartsOn(context, dueTime),
      keptRule: null,
      keptEndsOn: null,
    }
    if (often.type === "AFTER_COMPLETION") {
      next = { ...next, often: often.type, afterCount: often.count, afterUnit: often.unit }
    } else if (often.type === "AS_NEEDED") {
      next = {
        ...next,
        often: often.type,
        backstopEnabled: often.backstopDays !== null,
        backstopDays: often.backstopDays ?? next.backstopDays,
      }
    } else {
      next = {
        ...next,
        often: often.type,
        anchorWeekday:
          (often.type === "WEEKLY" || often.type === "BIWEEKLY") && often.weekday
            ? often.weekday
            : next.anchorWeekday,
      }
    }
  }
  if (!touched.has("who")) {
    const shared = context.members.length > 1
    next = {
      ...next,
      who: suggestion.who === "ME" || !shared ? "ME" : suggestion.who,
      participants: everyone(context),
      everyone: true,
      specificPeople: [],
      peopleNeeded: 1,
    }
  }
  if (!touched.has("category")) {
    const named = findCategoryByName(categories, suggestion.category)
    next = named
      ? { ...next, categoryId: named.id, categorySource: "set" }
      : withTitle({ ...next, categorySource: "guess" }, next.title, categories)
  }
  if (!touched.has("difficulty")) next = { ...next, difficulty: suggestion.difficulty }
  if (!touched.has("minutes")) next = { ...next, estimatedMinutes: suggestion.minutes }
  return compatibleWho(next)
}

export function isOpenCopy(often: OftenChoice) {
  return often === "AFTER_COMPLETION" || often === "AS_NEEDED"
}

/** The recurrence the "Custom…" editor describes, with its season and count applied. */
export function effectiveCustomRecurrence(custom: CustomSchedule): Recurrence {
  const recurrence = custom.recurrence
  return {
    ...recurrence,
    activeMonths:
      custom.seasonal && recurrence.frequency !== "YEARLY" ? recurrence.activeMonths : [],
    count: custom.endMode === "COUNT" ? custom.count : null,
  }
}

/** Checks the "Custom…" editor's values; returns a message, or null when they are valid. */
export function customScheduleError(custom: CustomSchedule, startsOn: string): string | null {
  const recurrence = custom.recurrence
  const frequency = recurrence.frequency as Exclude<Frequency, "ONCE">
  if (!startsOn) return "Choose a start date."
  if (frequency === "WEEKLY" && recurrence.weekdays.length === 0) {
    return "Choose at least one day to repeat."
  }
  const maxInterval = MAX_INTERVAL[frequency]
  if (
    !Number.isInteger(recurrence.interval) ||
    recurrence.interval < 1 ||
    recurrence.interval > maxInterval
  ) {
    return `Repeat every must be between 1 and ${maxInterval} ${INTERVAL_UNIT[frequency][1]}.`
  }
  if (
    frequency === "YEARLY" &&
    recurrence.yearDay > (MONTHS[recurrence.yearMonth - 1]?.days ?? 31)
  ) {
    return `Choose a day that exists in ${MONTHS[recurrence.yearMonth - 1]?.label}.`
  }
  if (custom.seasonal && frequency !== "YEARLY" && recurrence.activeMonths.length === 0) {
    return "Choose at least one active month."
  }
  if (
    custom.endMode === "COUNT" &&
    (!Number.isInteger(custom.count) || custom.count < 1 || custom.count > MAX_COUNT)
  ) {
    return `The number of times must be between 1 and ${MAX_COUNT}.`
  }
  if (custom.endMode === "DATE" && !custom.endsOn) return "Choose an end date, or select Never."
  if (custom.endMode === "DATE" && custom.endsOn < startsOn) {
    return "The end date cannot be before the start date."
  }
  return null
}

/** The calendar rule for a simple choice or the custom editor; null for the open-copy kinds. */
export function recurrenceRuleFor(values: QuickValues): string | null {
  const base = defaultRecurrence(values.startsOn)
  switch (values.often) {
    case "AFTER_COMPLETION":
    case "AS_NEEDED":
      return null
    case "ONCE":
      return "FREQ=ONCE"
    case "DAILY":
      return buildRecurrenceRule({ ...base, frequency: "DAILY", interval: 1 })
    case "WEEKLY":
    case "BIWEEKLY":
      return buildRecurrenceRule({
        ...base,
        frequency: "WEEKLY",
        interval: values.often === "WEEKLY" ? 1 : 2,
        weekdays: [values.anchorWeekday],
      })
    case "MONTHLY":
      return buildRecurrenceRule({
        ...base,
        frequency: "MONTHLY",
        interval: 1,
        monthlyMode: "DAY",
        monthDay: values.anchorMonthDay,
      })
    case "CUSTOM":
      return values.keptRule ?? buildRecurrenceRule(effectiveCustomRecurrence(values.custom))
  }
}

export type QuickError = { field: "title" | "often" | "who" | "more"; message: string }

function activeIds(context: QuickContext) {
  return new Set(everyone(context))
}

/** Who does it, as the four schedule fields the backend expects. */
function assignmentFor(
  values: QuickValues,
  context: QuickContext,
  openCopy: boolean,
):
  | {
      assignmentStrategy: AssignmentStrategy
      peopleNeeded: number
      fixedAssigneeUserId: string | null
      participantUserIds: string[]
      everyone: boolean | null
      rotationWeeks: number | null
    }
  | QuickError {
  const active = activeIds(context)
  const people = values.participants.filter((userId) => active.has(userId))
  switch (values.who) {
    case "ME":
      return {
        assignmentStrategy: "FIXED",
        peopleNeeded: 1,
        fixedAssigneeUserId: context.viewerId,
        participantUserIds: [],
        everyone: null,
        rotationWeeks: null,
      }
    case "SOMEONE": {
      const chosen = values.specificPeople.filter((userId) => active.has(userId))
      if (chosen.length === 0) return { field: "who", message: "Choose who does it." }
      if (chosen.length > 1 && openCopy) {
        return { field: "who", message: "Choose one person for this kind of chore." }
      }
      // One person keeps the single-assignee mapping; a group is every ticked person each time.
      return chosen.length === 1
        ? {
            assignmentStrategy: "FIXED",
            peopleNeeded: 1,
            fixedAssigneeUserId: chosen[0],
            participantUserIds: [],
            everyone: null,
            rotationWeeks: null,
          }
        : {
            assignmentStrategy: "FIXED",
            peopleNeeded: chosen.length,
            fixedAssigneeUserId: null,
            participantUserIds: chosen,
            everyone: null,
            rotationWeeks: null,
          }
    }
    case "TURNS":
    case "WEEKS":
    case "BALANCED":
    case "RANDOM": {
      const weeks = values.who === "WEEKS"
      if (
        weeks &&
        (!Number.isInteger(values.rotationWeeks) ||
          values.rotationWeeks < 1 ||
          values.rotationWeeks > MAX_ROTATION_WEEKS)
      ) {
        return {
          field: "who",
          message: `Choose between 1 and ${MAX_ROTATION_WEEKS} weeks for each person.`,
        }
      }
      const needed = openCopy || weeks ? 1 : Math.max(1, values.peopleNeeded)
      if (people.length < needed) {
        return {
          field: "who",
          message:
            needed === 1 ? "Choose at least one person." : `Choose at least ${needed} people.`,
        }
      }
      return {
        assignmentStrategy:
          values.who === "TURNS" || weeks
            ? "ROUND_ROBIN"
            : values.who === "BALANCED"
              ? "BALANCED"
              : "RANDOM",
        peopleNeeded: needed,
        fixedAssigneeUserId: null,
        participantUserIds: people,
        everyone: values.everyone ? true : null,
        rotationWeeks: weeks ? values.rotationWeeks : null,
      }
    }
  }
}

/** The first problem with the steps, worded as the server words it, or null. */
export function stepsError(steps: readonly StepDraft[]): string | null {
  if (steps.length > MAX_STEPS) return "A chore can have at most 15 steps."
  if (steps.some((step) => step.text.trim() === "")) return "Enter a step, or remove it."
  if (steps.some((step) => step.text.trim().length > MAX_STEP_LENGTH)) {
    return "Keep each step to 80 characters."
  }
  return null
}

/** The request for the backend, or the first problem to show next to its control. */
export function buildQuickRequest(
  values: QuickValues,
  context: QuickContext,
): { request: ChoreRequest } | { error: QuickError } {
  const title = values.title.trim()
  if (!title) return { error: { field: "title", message: "Enter a chore name." } }
  if (title.length > MAX_TITLE_LENGTH) {
    return {
      error: {
        field: "title",
        message: `Chore names can be at most ${MAX_TITLE_LENGTH} characters.`,
      },
    }
  }

  const often = values.often
  const openCopy = isOpenCopy(often)
  const oftenError = (message: string) => ({ error: { field: "often" as const, message } })
  if (!values.startsOn && often !== "AS_NEEDED") {
    return oftenError(often === "ONCE" ? "Choose a date." : "Choose a start date.")
  }
  if (!openCopy && !values.dueTime) return oftenError("Choose a due time.")
  if (often === "AFTER_COMPLETION") {
    const max = MAX_AFTER[values.afterUnit]
    if (!Number.isInteger(values.afterCount) || values.afterCount < 1 || values.afterCount > max) {
      return oftenError(
        `Choose between 1 and ${max} ${values.afterUnit === "WEEK" ? "weeks" : "days"} after it's done.`,
      )
    }
  }
  if (
    often === "AS_NEEDED" &&
    values.backstopEnabled &&
    (!Number.isInteger(values.backstopDays) ||
      values.backstopDays < 1 ||
      values.backstopDays > MAX_BACKSTOP_DAYS)
  ) {
    return oftenError(`Choose "at least every" between 1 and ${MAX_BACKSTOP_DAYS} days.`)
  }
  if (often === "CUSTOM" && values.keptRule === null) {
    const message = customScheduleError(values.custom, values.startsOn)
    if (message) return oftenError(message)
  }

  const assignment = assignmentFor(values, context, openCopy)
  if ("message" in assignment) return { error: assignment }

  const minutes = values.estimatedMinutes
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES)) {
    return {
      error: {
        field: "more",
        message: `Takes about must be between 1 and ${MAX_MINUTES} minutes.`,
      },
    }
  }

  const stepError = stepsError(values.steps)
  if (stepError) return { error: { field: "more", message: stepError } }

  const noDeadline = often === "AS_NEEDED" && !values.backstopEnabled
  const endsOn =
    often !== "CUSTOM"
      ? null
      : values.keptRule !== null
        ? values.keptEndsOn
        : values.custom.endMode === "DATE"
          ? values.custom.endsOn || null
          : null
  return {
    request: {
      title,
      description: values.description.trim() || null,
      categoryId: values.categoryId,
      defaultPriority: values.priority,
      difficulty: values.difficulty,
      estimatedMinutes: minutes,
      requiresVerification: values.requiresVerification,
      steps: values.steps.map((step) => ({ id: step.id, text: step.text.trim() })),
      schedule: {
        recurrenceRule: recurrenceRuleFor(values),
        timezone: context.timezone,
        startsOn: values.startsOn || todayIn(context.timezone),
        endsOn,
        dueTime: noDeadline ? null : values.dueTime || null,
        ...assignment,
        kind: often === "AFTER_COMPLETION" || often === "AS_NEEDED" ? often : "CALENDAR",
        intervalCount: often === "AFTER_COMPLETION" ? values.afterCount : null,
        intervalUnit: often === "AFTER_COMPLETION" ? values.afterUnit : null,
        backstopEnabled: often === "AS_NEEDED" ? values.backstopEnabled : null,
        backstopDays: often === "AS_NEEDED" && values.backstopEnabled ? values.backstopDays : null,
      },
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Labels

/** "8 PM", "8:30 PM". */
export function clockLabel(time: string) {
  const [hour, minute] = time.split(":").map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return time
  const suffix = hour < 12 ? "AM" : "PM"
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return minute === 0
    ? `${twelve} ${suffix}`
    : `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`
}

export function ordinalDay(day: number) {
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`
  return `${day}${{ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th"}`
}

export function weekdayShort(day: Weekday) {
  return WEEKDAYS.find((weekday) => weekday.key === day)?.short ?? day
}

export function weekdayLong(day: Weekday) {
  return WEEKDAYS.find((weekday) => weekday.key === day)?.label ?? day
}

/** "Sat, Nov 14" for a YYYY-MM-DD date. */
export function shortDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number)
  if (!year || !month || !day) return isoDate
  const weekday = weekdayShort(weekdayOf(isoDate))
  return `${weekday}, ${MONTHS[month - 1].short} ${day}`
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

function customDescription(values: QuickValues) {
  if (values.keptRule !== null) return null
  return describeRecurrence(
    effectiveCustomRecurrence(values.custom),
    values.custom.endMode === "DATE" ? values.custom.endsOn || null : null,
  )
}

/** The value shown on the "How often" row. */
export function oftenLabel(values: QuickValues): string {
  switch (values.often) {
    case "DAILY":
      return "Every day"
    case "WEEKLY":
      return `Every week · ${weekdayShort(values.anchorWeekday)}`
    case "BIWEEKLY":
      return `Every 2 weeks · ${weekdayShort(values.anchorWeekday)}`
    case "MONTHLY":
      return `Every month · ${ordinalDay(values.anchorMonthDay)}`
    case "ONCE":
      return values.startsOn ? `Just once · ${shortDate(values.startsOn)}` : "Just once"
    case "AFTER_COMPLETION": {
      const unit = values.afterUnit === "WEEK" ? ["week", "weeks"] : ["day", "days"]
      return `After it's done · ${values.afterCount} ${unit[values.afterCount === 1 ? 0 : 1]}`
    }
    case "AS_NEEDED":
      return values.backstopEnabled
        ? `When needed · ${values.backstopDays} ${values.backstopDays === 1 ? "day" : "days"}`
        : "When needed · No deadline"
    case "CUSTOM": {
      const description = customDescription(values)
      return description ? `Custom · ${description}` : "Custom"
    }
  }
}

function nameOf(userId: string, members: Member[], viewerId: string) {
  if (userId === viewerId) return "you"
  return members.find((member) => member.userId === userId)?.displayName ?? "Someone"
}

function activePeople(values: QuickValues, members: Member[]) {
  return values.participants.filter((userId) => members.some((member) => member.userId === userId))
}

function activeSpecific(values: QuickValues, members: Member[]) {
  return values.specificPeople.filter((userId) =>
    members.some((member) => member.userId === userId),
  )
}

/** True when Specific people has every active member of a shared household ticked. */
export function isEveryoneTogether(values: QuickValues, members: Member[]) {
  const count = activeSpecific(values, members).length
  return values.who === "SOMEONE" && members.length > 1 && count === members.length
}

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
]

/** "two" for 2, "12" for 12: numbers up to ten are spelled out. */
export function numberWord(value: number) {
  return NUMBER_WORDS[value] ?? String(value)
}

/** "Farhan", "Farhan & Rubayet", "Farhan, Rubayet +1". */
export function specificLabel(values: QuickValues, members: Member[], viewerId: string): string {
  const chosen = activeSpecific(values, members)
  if (chosen.length === 0) return "Choose someone"
  if (isEveryoneTogether(values, members)) return "Everyone together"
  const names = chosen.map(
    (userId) => members.find((member) => member.userId === userId)?.displayName ?? "Someone",
  )
  if (names.length === 1) return chosen[0] === viewerId ? "Just me" : names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]}, ${names[1]} +${names.length - 2}`
}

/** The value shown on the "Who" row. */
/** "1 week", "3 weeks". */
export function weeksLabel(weeks: number) {
  return weeks === 1 ? "1 week" : `${weeks} weeks`
}

/** The box under Week by week: what it does, in plain words. */
export function weeksExplanation(weeks: number): { title: string; detail: string } {
  return {
    title:
      weeks === 1
        ? "One person all week, then the next"
        : `One person for ${weeks} weeks, then the next`,
    detail:
      "Good when someone should own it: dishes, the kitchen, the bathroom. Switches on Mondays.",
  }
}

export function whoLabel(values: QuickValues, members: Member[], viewerId: string): string {
  const people = activePeople(values, members)
  const count = people.length
  // "everyone" means the mode (people who join later too), not a list that happens to be full.
  const group = values.everyone ? "everyone" : count === 1 ? "1 person" : `${count} people`
  const each = peopleEachTime(values, members)
  const pool = each > 1 ? `${each} at a time` : group
  switch (values.who) {
    case "ME":
      return "Just me"
    case "SOMEONE":
      return specificLabel(values, members, viewerId)
    case "TURNS":
      return count === 0 ? "Take turns · nobody yet" : `Take turns · ${pool}`
    case "WEEKS":
      return count === 0
        ? "Week by week · nobody yet"
        : `Week by week · ${weeksLabel(values.rotationWeeks)}`
    case "BALANCED":
      return count === 0 ? "Balanced · nobody yet" : `Balanced · ${pool}`
    case "RANDOM":
      return count === 0 ? "Mix it up · nobody yet" : `Mix it up · ${pool}`
  }
}

/**
 * The value shown on the "More options" row: "Optional" until the user sets something there (a
 * suggestion's effort and minutes don't count), or always when editing.
 */
export function moreLabel(values: QuickValues, editing: boolean): string {
  const changed =
    editing ||
    values.priority !== "NORMAL" ||
    values.touched.includes("difficulty") ||
    values.touched.includes("minutes") ||
    values.description.trim() !== "" ||
    values.requiresVerification ||
    values.steps.length > 0
  if (!changed) return "Optional"
  const parts = [
    PRIORITIES.find((priority) => priority.value === values.priority)?.label ?? "Normal",
    EFFORTS[values.difficulty - 1] ?? "Moderate",
  ]
  if (values.estimatedMinutes !== null) parts.push(`${values.estimatedMinutes} min`)
  if (values.steps.length > 0) parts.push(stepsLabel(values.steps.length))
  return parts.join(" · ")
}

export type SummaryPart = { text: string; strong?: boolean }

const strong = (text: string): SummaryPart => ({ text, strong: true })
const plain = (text: string): SummaryPart => ({ text })

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The live summary under the name, as text parts with the key ones bold: "When it's needed, at
 * least 2 days after it was last done. Turns between you, Rubayet and Abubakar." A "When needed"
 * deadline rolls from each completion, so its clock time isn't mentioned.
 */
export function summaryParts(
  values: QuickValues,
  members: Member[],
  viewerId: string,
): SummaryPart[] {
  const time = values.dueTime ? clockLabel(values.dueTime) : null
  const by = time ? [plain(" by "), strong(time)] : []
  let when: SummaryPart[]
  switch (values.often) {
    case "DAILY":
      when = [strong("Every day"), ...by]
      break
    case "WEEKLY":
    case "BIWEEKLY":
      when = [
        strong(values.often === "WEEKLY" ? "Every week" : "Every 2 weeks"),
        plain(" on "),
        strong(weekdayLong(values.anchorWeekday)),
        ...by,
      ]
      break
    case "MONTHLY":
      when = [
        strong("Every month"),
        plain(" on the "),
        strong(ordinalDay(values.anchorMonthDay)),
        ...by,
      ]
      break
    case "ONCE":
      when = [strong("Once"), plain(" on "), strong(shortDate(values.startsOn)), ...by]
      break
    case "AFTER_COMPLETION": {
      const unit = values.afterUnit === "WEEK" ? ["week", "weeks"] : ["day", "days"]
      const every =
        values.afterCount === 1
          ? `Every ${unit[0]} after it's done`
          : `Every ${values.afterCount} ${unit[1]} after it's done`
      when = [strong(every), ...(time ? [plain(", by "), strong(time)] : [])]
      break
    }
    case "AS_NEEDED": {
      if (!values.backstopEnabled) {
        when = [strong("When it's needed"), plain(", with no deadline")]
        break
      }
      const days = values.backstopDays === 1 ? "1 day" : `${values.backstopDays} days`
      when = [
        strong("When it's needed"),
        plain(", at least "),
        strong(days),
        plain(" after it was last done"),
      ]
      break
    }
    case "CUSTOM": {
      const description = customDescription(values)
      when = description ? [strong(description), ...by] : [strong("On a custom schedule")]
      break
    }
  }

  const people = activePeople(values, members)
  const names = people.map((userId) => nameOf(userId, members, viewerId))
  const each = peopleEachTime(values, members)
  const eachTime = each > 1 ? `${capitalize(numberWord(each))} people each time` : null
  let who: SummaryPart[]
  switch (values.who) {
    case "ME":
      who = [strong("You"), plain(" do it.")]
      break
    case "SOMEONE": {
      const chosen = activeSpecific(values, members).map((userId) =>
        nameOf(userId, members, viewerId),
      )
      who =
        chosen.length === 0
          ? [plain("Choose who does it.")]
          : isEveryoneTogether(values, members)
            ? [strong("Everyone"), plain(" does it together.")]
            : chosen.length > 1
              ? [strong(capitalize(joinNames(chosen))), plain(" do it together.")]
              : chosen[0] === "you"
                ? [strong("You"), plain(" do it.")]
                : [strong(chosen[0]), plain(" always does it.")]
      break
    }
    case "TURNS":
      who =
        names.length === 0
          ? [plain("Choose who takes turns.")]
          : names.length === 1
            ? [strong(capitalize(names[0])), plain(names[0] === "you" ? " do it." : " does it.")]
            : eachTime
              ? [strong(eachTime), plain(", taking turns between "), strong(joinNames(names))]
              : [plain("Turns between "), strong(joinNames(names))]
      if (names.length > 1) who.push(plain("."))
      break
    case "WEEKS":
      who =
        names.length === 0
          ? [plain("Choose who takes turns.")]
          : names.length === 1
            ? [strong(capitalize(names[0])), plain(names[0] === "you" ? " do it." : " does it.")]
            : [
                strong("Week by week"),
                plain(": each person has it for "),
                strong(weeksLabel(values.rotationWeeks)),
                plain(", between "),
                strong(joinNames(names)),
                plain("."),
              ]
      break
    case "BALANCED":
      who =
        names.length === 0
          ? [plain("Choose who's included.")]
          : names.length === 1
            ? [strong(capitalize(names[0])), plain(names[0] === "you" ? " do it." : " does it.")]
            : [
                plain(
                  each > 1
                    ? `Goes to the ${numberWord(each)} who have done the least work lately, among `
                    : "Goes to whoever has done the least work lately, among ",
                ),
                strong(joinNames(names)),
                plain("."),
              ]
      break
    case "RANDOM":
      who =
        names.length === 0
          ? [plain("Choose who it's picked from.")]
          : eachTime
            ? [
                strong(eachTime),
                plain(", picked at random from "),
                strong(joinNames(names)),
                plain("."),
              ]
            : [plain("Picked at random from "), strong(joinNames(names)), plain(".")]
      break
  }
  return [...when, plain(". "), ...who]
}
