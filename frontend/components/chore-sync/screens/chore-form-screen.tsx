"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CirclePlus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Tag,
  UsersRound,
} from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import {
  categoryIcon,
  choreApi,
  type AssignmentDTO,
  type Chore,
  type ChoreManagementOptions,
} from "@/lib/household/chores"
import {
  describeSuggestion,
  matchSuggestions,
  POPULAR_SUGGESTIONS,
  type ChoreSuggestion,
} from "@/lib/household/chore-suggestions"
import {
  EFFORTS,
  MAX_MINUTES,
  MAX_TITLE_LENGTH,
  PRIORITIES,
  allowsGroups,
  applySuggestion,
  buildQuickRequest,
  initialQuickValues,
  moreLabel,
  oftenLabel,
  peopleEachTime,
  summaryParts,
  valuesFromChore,
  whoLabel,
  withField,
  withOften,
  withTitle,
  copyValues,
  type QuickContext,
  type QuickError,
  type QuickValues,
} from "@/lib/household/chore-quick-form"
import { deadlineWords, timeAgo } from "@/lib/household/household-jobs"
import { useHouseholds } from "@/lib/household/household-context"
import { householdChoreResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { CategoryDialog } from "../category-dialog"
import { useDialogFocus } from "../use-dialog-focus"
import { CategorySheet } from "../chore-form/category-sheet"
import { Stepper, ToggleRow } from "../chore-form/form-sheet"
import { HowOftenSheet } from "../chore-form/how-often-sheet"
import { WhoSheet } from "../chore-form/who-sheet"
import { SUGGESTION_ICONS } from "../chore-form/suggestion-icons"
import {
  HouseholdLiveDesignHeader,
  type PreviewTheme,
} from "../redesign/household-secondary-design-preview"
import designStyles from "../redesign/household-secondary-design-preview.module.css"
import styles from "../chore-form/chore-form.module.css"

type Sheet = "often" | "who" | "category"

function minutesDown(minutes: number | null) {
  if (minutes === null || minutes <= 5) return null
  return minutes <= 60 ? minutes - 5 : minutes - 15
}

function minutesUp(minutes: number | null) {
  if (minutes === null) return 5
  return Math.min(MAX_MINUTES, minutes < 60 ? minutes + 5 : minutes + 15)
}

/** The open occurrence the edit hero describes: whose turn, when it's due, when it was last done. */
function openOccurrence(
  dashboard: Awaited<ReturnType<typeof choreApi.dashboard>>,
  choreId: string,
) {
  const all = [
    ...(dashboard.householdJobs ?? []),
    ...(dashboard.overdue ?? []),
    ...(dashboard.today ?? []),
    ...(dashboard.thisWeek ?? []),
  ].filter((assignment) => assignment.choreId === choreId && assignment.status === "PENDING")
  const when = (assignment: AssignmentDTO) => assignment.dueAt ?? assignment.scheduledFor
  return all.sort((left, right) => when(left).localeCompare(when(right)))[0] ?? null
}

export function ChoreFormScreen({ theme = "light" }: { theme?: PreviewTheme }) {
  const { state, screen, navigate, editingChoreId, choreDraft, clearChoreDraft } = useChoreSync()
  const { activeHousehold: household } = useHouseholds()
  const isEditing = screen === "edit-chore"
  const viewerId = state.currentUser.id
  const householdId = household?.id
  const timezone = household?.timezone ?? "UTC"
  const canManageCategories =
    household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN"

  const [options, setOptions] = useState<ChoreManagementOptions | null>(null)
  const [chore, setChore] = useState<Chore | null>(null)
  const [occurrence, setOccurrence] = useState<AssignmentDTO | null>(null)
  const [values, setValues] = useState<QuickValues | null>(null)
  const [savedValues, setSavedValues] = useState("")
  const [removedMembers, setRemovedMembers] = useState(0)
  /** A note under Who: too few people left on load, or a kind change that left one person. */
  const [whoNote, setWhoNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<QuickError | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const suggestionsRef = useRef<HTMLUListElement | null>(null)
  const discardDialogRef = useRef<HTMLElement | null>(null)
  const archiveDialogRef = useRef<HTMLElement | null>(null)
  const { invalidate: invalidateChores } = useDataSync(
    householdId ? householdChoreResource(householdId) : "household:none:chores-and-assignments",
  )

  const members = useMemo(() => options?.activeMembers ?? [], [options])
  const categories = useMemo(() => options?.categories ?? [], [options])
  const context: QuickContext = useMemo(
    () => ({ viewerId, members, timezone }),
    [members, timezone, viewerId],
  )
  const dirty = values !== null && savedValues !== "" && JSON.stringify(values) !== savedValues

  useDialogFocus(
    discardDialogRef,
    confirmDiscard,
    () => setConfirmDiscard(false),
    () => document.querySelector<HTMLElement>("[data-chore-form-cancel]"),
  )
  useDialogFocus(
    archiveDialogRef,
    confirmArchive,
    () => {
      if (!archiving) setConfirmArchive(false)
    },
    () => document.querySelector<HTMLElement>("[data-chore-form-archive]"),
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
    const draft = isEditing ? null : choreDraft
    const load = async () => {
      try {
        const editing = isEditing && editingChoreId
        const copyOf = draft?.copyOf ?? null
        const [nextOptions, loaded, dashboard, original] = await Promise.all([
          choreApi.options(householdId),
          editing ? choreApi.get(householdId, editingChoreId) : Promise.resolve(null),
          // Only for the edit hero's turn, due and "last done" details; never blocks the form.
          editing ? choreApi.dashboard(householdId).catch(() => null) : Promise.resolve(null),
          copyOf ? choreApi.get(householdId, copyOf) : Promise.resolve(null),
        ])
        if (cancelled) return
        const loadContext = {
          viewerId,
          members: nextOptions.activeMembers,
          timezone,
        }
        let nextValues: QuickValues
        if (loaded) {
          const result = valuesFromChore(loaded, loadContext)
          nextValues = result.values
          setRemovedMembers(result.removedMembers)
          setWhoNote(
            result.shortfall
              ? `Needs ${result.shortfall.needed} people, only ${result.shortfall.left} left.`
              : null,
          )
          setChore(loaded)
          setOccurrence(dashboard ? openOccurrence(dashboard, loaded.id) : null)
        } else if (original) {
          // Duplicate: the same setup as a new chore; nothing is saved until Create.
          const result = copyValues(original, loadContext)
          nextValues = result.values
          setRemovedMembers(result.removedMembers)
          setWhoNote(null)
        } else {
          nextValues = initialQuickValues(loadContext)
          if (draft) {
            // Started from the Board: its title, and for an event a one-time date and time.
            nextValues = withTitle(nextValues, draft.title, nextOptions.categories)
            if (draft.once) {
              nextValues = withOften(nextValues, "ONCE", {
                startsOn: draft.once.date,
                dueTime: draft.once.time,
              })
            }
          }
        }
        setOptions(nextOptions)
        setValues(nextValues)
        setSavedValues(JSON.stringify(nextValues))
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
    // The draft is read once, when the form opens, so it isn't a dependency.
  }, [editingChoreId, householdId, isEditing, timezone, viewerId])

  // "What needs doing?" gets focus when a new chore's form appears.
  const ready = values !== null
  useEffect(() => {
    if (ready && !isEditing) nameRef.current?.focus()
  }, [isEditing, ready])

  /** Back to where the form was opened from: the Board for a draft, the chore list otherwise. */
  const exit = useCallback(() => {
    const returnTo = !isEditing ? choreDraft?.returnTo : undefined
    clearChoreDraft()
    if (returnTo) navigate(returnTo)
    else navigate("admin", "chores")
  }, [choreDraft, clearChoreDraft, isEditing, navigate])

  const leave = useCallback(() => {
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    exit()
  }, [dirty, exit])

  const update = (next: QuickValues) => {
    setValues(next)
    setFieldError(null)
    setSaveError(null)
  }

  const save = async () => {
    if (!householdId || !values || savingRef.current) return
    const result = buildQuickRequest(values, context)
    if ("error" in result) {
      setFieldError(result.error)
      if (result.error.field === "more") setMoreOpen(true)
      if (result.error.field === "title") nameRef.current?.focus()
      return
    }
    // A second tap while the first request is in flight does nothing.
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      if (isEditing && editingChoreId) {
        await choreApi.update(householdId, editingChoreId, result.request)
      } else {
        await choreApi.create(householdId, result.request)
      }
      invalidateChores()
      exit()
    } catch (cause) {
      setSaveError(
        cause instanceof ApiError ? cause.message : "Unable to save this chore. Please try again.",
      )
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const archive = async () => {
    if (!householdId || !chore || archiving) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await choreApi.archive(householdId, chore.id)
      invalidateChores()
      navigate("admin", "chores")
    } catch (cause) {
      setArchiveError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to archive this chore. Please try again.",
      )
      setArchiving(false)
    }
  }

  const rowFocus = (row: Sheet) => () =>
    document.querySelector<HTMLElement>(`[data-chore-form-row="${row}"]`)

  // ------------------------------------------------------------------ hero
  const savedCategory = categories.find((category) => category.id === chore?.categoryId)
  const turn = occurrence ? (occurrence.turn ?? occurrence.assignees[0] ?? null) : null
  const heroChips: ReactNode[] = []
  if (turn) {
    heroChips.push(
      <span className={`${styles.heroChip} ${styles.heroChipAccent}`} key="turn">
        {turn.userId === viewerId ? "Your turn" : `${turn.displayName}'s turn`}
      </span>,
    )
  }
  if (occurrence?.dueAt) {
    heroChips.push(
      <span className={styles.heroChip} key="due">
        Due {deadlineWords(occurrence.dueAt, timezone)}
      </span>,
    )
  }
  const lastDone = occurrence?.lastDone
  const heroDetails =
    isEditing && (heroChips.length > 0 || lastDone) ? (
      <>
        {heroChips.length > 0 && <div className={styles.heroChips}>{heroChips}</div>}
        {lastDone && (
          <p>
            Last done {timeAgo(lastDone.at)} by{" "}
            {lastDone.byUserId === viewerId ? "you" : lastDone.byDisplayName}
          </p>
        )}
      </>
    ) : undefined

  const header = (
    <HouseholdLiveDesignHeader
      eyebrow={isEditing ? "Household · Edit routine" : "Household · New routine"}
      heroDescription={
        isEditing
          ? heroDetails
            ? undefined
            : "Update the details together. Changes will apply to future turns."
          : "Choose the details now. You can adjust them as your home changes."
      }
      heroDetails={heroDetails}
      heroEyebrow={
        isEditing && chore
          ? (savedCategory?.name ?? "Chore")
          : isEditing
            ? "Keep the rhythm in sync"
            : "A small thing, shared"
      }
      heroIconNode={
        isEditing && savedCategory ? (
          <span className={styles.heroEmoji}>{categoryIcon(savedCategory.iconKey)}</span>
        ) : undefined
      }
      heroTitle={
        isEditing
          ? (chore?.title ?? "Shape the routine to fit your home.")
          : "Build a routine that feels fair."
      }
      household={household?.name ?? "Your household"}
      onBack={leave}
      title={isEditing ? "Edit a chore" : "Create a chore"}
    />
  )

  const rootClass = `flex min-h-screen flex-col ${designStyles.liveRoot} ${designStyles.choreForm} ${designStyles[theme]} ${styles.page}`

  if (loading || loadError || !options || !values) {
    return (
      <div className={rootClass} data-theme={theme}>
        {header}
        {loading ? (
          <div aria-label="Loading chore form" className={designStyles.liveContent}>
            {[0, 1, 2].map((item) => (
              <div className={`${styles.card} h-36 animate-pulse`} key={item} />
            ))}
          </div>
        ) : (
          <div className={designStyles.liveContent}>
            <p className={`${styles.card} ${styles.inputError}`} role="alert">
              {loadError}
            </p>
            <button
              className={styles.secondaryButton}
              onClick={() => navigate("admin", "chores")}
              type="button"
            >
              Back to chores
            </button>
          </div>
        )}
      </div>
    )
  }

  // ------------------------------------------------------------------ name card
  const title = values.title
  const named = title.trim() !== ""
  const matches = !isEditing && suggesting && named ? matchSuggestions(title) : []
  const showSuggestions = matches.length > 0
  const pick = (suggestion: ChoreSuggestion) => {
    update(applySuggestion(values, suggestion, categories, context))
    setSuggesting(false)
    nameRef.current?.focus()
  }
  const titleError = fieldError?.field === "title" ? fieldError.message : null

  const nameCard = (
    <section aria-label="What needs doing" className={styles.card}>
      <label className={styles.fieldLabel} htmlFor="chore-name">
        What needs doing?
      </label>
      <input
        aria-describedby={titleError ? "chore-name-error" : undefined}
        aria-invalid={titleError ? true : undefined}
        autoComplete="off"
        className={styles.nameInput}
        id="chore-name"
        maxLength={MAX_TITLE_LENGTH}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (!(next instanceof Node) || !suggestionsRef.current?.contains(next)) {
            setSuggesting(false)
          }
        }}
        onChange={(event) => {
          update(withTitle(values, event.target.value, categories))
          setSuggesting(true)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") {
            if (showSuggestions) event.preventDefault()
            setSuggesting(false)
          }
        }}
        placeholder="e.g. Take out garbage"
        ref={nameRef}
        value={title}
      />
      {title.length >= MAX_TITLE_LENGTH - 20 && (
        <p className={styles.counter}>
          {title.length}/{MAX_TITLE_LENGTH}
        </p>
      )}
      {titleError && (
        <p className={styles.inputError} id="chore-name-error" role="alert">
          {titleError}
        </p>
      )}
      {!isEditing && !named && (
        <>
          <p className={styles.sectionLabel} id="chore-popular">
            Popular
          </p>
          <ul aria-labelledby="chore-popular" className={styles.chips}>
            {POPULAR_SUGGESTIONS.map((suggestion) => (
              <li key={suggestion.title}>
                <button className={styles.chip} onClick={() => pick(suggestion)} type="button">
                  <span aria-hidden="true">{SUGGESTION_ICONS[suggestion.icon](15)}</span>
                  {suggestion.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {showSuggestions && (
        <>
          <p className={styles.sectionLabel} id="chore-suggestions">
            Suggestions
          </p>
          <ul
            aria-labelledby="chore-suggestions"
            className={styles.suggestions}
            ref={suggestionsRef}
          >
            {matches.map(({ suggestion, before, match, after }) => (
              <li key={suggestion.title}>
                <button
                  aria-label={`Use ${suggestion.title}: ${describeSuggestion(suggestion)}`}
                  className={styles.suggestion}
                  onClick={() => pick(suggestion)}
                  type="button"
                >
                  <span aria-hidden="true" className={styles.tile}>
                    {SUGGESTION_ICONS[suggestion.icon](17)}
                  </span>
                  <span>
                    <span className={styles.suggestionTitle}>
                      {before}
                      <strong>{match}</strong>
                      {after}
                    </span>
                    <span className={styles.suggestionHint}>{describeSuggestion(suggestion)}</span>
                  </span>
                  <CirclePlus aria-hidden="true" size={20} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {named && !showSuggestions && (
        <p aria-live="polite" className={styles.summary} data-testid="chore-summary">
          <Sparkles aria-hidden="true" size={15} />
          <span>
            {summaryParts(values, members, viewerId).map((part, index) =>
              part.strong ? <strong key={index}>{part.text}</strong> : part.text,
            )}
          </span>
        </p>
      )}
    </section>
  )

  // ------------------------------------------------------------------ settings rows
  const category = categories.find((candidate) => candidate.id === values.categoryId)
  const guessing = values.categorySource === "guess"
  const row = ({
    id,
    icon,
    label,
    hint,
    value,
    onClick,
    expanded,
    accent,
  }: {
    id: Sheet | "more"
    icon: ReactNode
    label: string
    hint?: string
    value: string
    onClick: () => void
    expanded?: boolean
    accent?: boolean
  }) => (
    <button
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? "dialog" : undefined}
      aria-label={`${label}: ${value}`}
      className={styles.row}
      data-chore-form-row={id}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className={styles.tile}>
        {icon}
      </span>
      <span className={`${styles.rowLabel} ${accent ? styles.rowLabelAccent : ""}`}>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className={styles.rowValue}>{value}</span>
      {expanded === undefined ? (
        <ChevronRight aria-hidden="true" size={18} />
      ) : expanded ? (
        <ChevronUp aria-hidden="true" size={18} />
      ) : (
        <ChevronDown aria-hidden="true" size={18} />
      )}
    </button>
  )
  const rowError = (field: QuickError["field"]) =>
    fieldError?.field === field ? (
      <p className={styles.error} role="alert">
        {fieldError.message}
      </p>
    ) : null

  const settingsCard = (
    <section aria-label="Chore settings" className={`${styles.card} ${styles.rows}`}>
      <div className={styles.rowWrap}>
        {row({
          id: "often",
          icon: <RefreshCw size={18} />,
          label: "How often",
          value: oftenLabel(values),
          onClick: () => setSheet("often"),
        })}
        {rowError("often")}
      </div>
      <div className={styles.rowWrap}>
        {row({
          id: "who",
          icon: <UsersRound size={18} />,
          label: "Who",
          value: whoLabel(values, members, viewerId),
          onClick: () => setSheet("who"),
        })}
        {rowError("who")}
        {whoNote && !fieldError && <p className={styles.note}>{whoNote}</p>}
        {removedMembers > 0 && !whoNote && !fieldError && (
          <p className={styles.note}>
            {removedMembers === 1
              ? "Someone who left the household was taken off this chore."
              : `${removedMembers} people who left the household were taken off this chore.`}
          </p>
        )}
      </div>
      <div className={styles.rowWrap}>
        {row({
          id: "category",
          icon: category ? categoryIcon(category.iconKey) : <Tag size={18} />,
          label: "Category",
          hint: category && guessing ? "From the name" : undefined,
          value: category ? category.name : guessing ? "From the name" : "None",
          onClick: () => setSheet("category"),
        })}
      </div>
      <div className={styles.rowWrap}>
        {row({
          id: "more",
          icon: <SlidersHorizontal size={18} />,
          label: "More options",
          value: moreLabel(values, isEditing),
          onClick: () => setMoreOpen((open) => !open),
          expanded: moreOpen,
          accent: true,
        })}
      </div>
    </section>
  )

  const effort = EFFORTS[values.difficulty - 1] ?? "Moderate"
  const moreCard = moreOpen && (
    <section aria-label="More options" className={`${styles.card} ${styles.more}`} id="chore-more">
      <div>
        <p className={styles.controlHeader} id="chore-priority">
          Priority
        </p>
        <div aria-labelledby="chore-priority" className={styles.segmented} role="group">
          {PRIORITIES.map((priority) => (
            <button
              aria-pressed={values.priority === priority.value}
              className={styles.segment}
              key={priority.value}
              onClick={() => update(withField(values, "priority", { priority: priority.value }))}
              type="button"
            >
              {priority.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className={styles.controlHeader} id="chore-effort">
          Effort <strong>{effort}</strong>
        </p>
        <div aria-labelledby="chore-effort" className={styles.effort} role="group">
          {EFFORTS.map((label, index) => (
            <button
              aria-label={`Effort ${index + 1}: ${label}`}
              aria-pressed={values.difficulty === index + 1}
              className={styles.effortStep}
              data-filled={index < values.difficulty}
              key={label}
              onClick={() => update(withField(values, "difficulty", { difficulty: index + 1 }))}
              type="button"
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className={styles.controlHeader}>Takes about</p>
        <Stepper
          canDecrease={values.estimatedMinutes !== null}
          canIncrease={values.estimatedMinutes === null || values.estimatedMinutes < MAX_MINUTES}
          display={values.estimatedMinutes === null ? "Not set" : String(values.estimatedMinutes)}
          label="Takes about"
          onDecrease={() =>
            update(
              withField(values, "minutes", {
                estimatedMinutes: minutesDown(values.estimatedMinutes),
              }),
            )
          }
          onIncrease={() =>
            update(
              withField(values, "minutes", {
                estimatedMinutes: minutesUp(values.estimatedMinutes),
              }),
            )
          }
          unit={values.estimatedMinutes === null ? undefined : "min"}
          value={values.estimatedMinutes}
        />
      </div>
      <label>
        <span className={styles.controlHeader}>Notes</span>
        <textarea
          className={styles.notes}
          onChange={(event) => update({ ...values, description: event.target.value })}
          placeholder="Anything helpful, like where the bags are"
          value={values.description}
        />
      </label>
      <ToggleRow
        checked={values.requiresVerification}
        hint="Someone confirms it was done"
        label="Ask for a quick check"
        onChange={(requiresVerification) => update({ ...values, requiresVerification })}
      />
      {rowError("more")}
    </section>
  )

  const createDisabled = !named || saving
  return (
    <div className={rootClass} data-theme={theme}>
      {header}
      <main
        className={`${designStyles.liveContent} ${styles.main} ${isEditing ? styles.mainEditing : ""}`}
      >
        {nameCard}
        {settingsCard}
        {moreCard}
        {isEditing && chore && (
          <button
            className={styles.archive}
            data-chore-form-archive
            onClick={() => {
              setArchiveError(null)
              setConfirmArchive(true)
            }}
            type="button"
          >
            <Archive aria-hidden="true" size={16} />
            Archive chore
          </button>
        )}
      </main>

      <div className={styles.footer}>
        <div className={styles.footerInner}>
          {saveError && (
            <p className={styles.footerError} role="alert">
              {saveError}
            </p>
          )}
          {isEditing && (
            <p className={styles.footerNote}>
              Changes apply to upcoming chores. Completed ones stay as they are.
            </p>
          )}
          <div className={styles.footerButtons}>
            <button
              className={styles.secondaryButton}
              data-chore-form-cancel
              onClick={leave}
              type="button"
            >
              Cancel
            </button>
            <button
              aria-disabled={createDisabled}
              className={styles.primaryButton}
              disabled={createDisabled}
              onClick={() => void save()}
              type="button"
            >
              {saving ? "Saving…" : isEditing ? "Save changes" : "Create chore"}
            </button>
          </div>
        </div>
      </div>

      {sheet === "often" && (
        <HowOftenSheet
          editing={isEditing}
          onChange={(next) => {
            if (
              !allowsGroups(next.often) &&
              peopleEachTime(values, members) > 1 &&
              peopleEachTime(next, members) === 1
            ) {
              setWhoNote(
                "This kind of chore is done by one person at a time, so Who changed to match.",
              )
            }
            update(next)
          }}
          onClose={() => setSheet(null)}
          returnFocusTo={rowFocus("often")}
          theme={theme}
          values={values}
        />
      )}
      {sheet === "who" && (
        <WhoSheet
          members={members}
          onChange={(next) => {
            setWhoNote(null)
            update(next)
          }}
          onClose={() => setSheet(null)}
          removedMembers={removedMembers}
          returnFocusTo={rowFocus("who")}
          theme={theme}
          values={values}
          viewerId={viewerId}
        />
      )}
      {sheet === "category" && (
        <CategorySheet
          canCreate={canManageCategories}
          categories={categories}
          onClose={() => setSheet(null)}
          onCreate={() => {
            setSheet(null)
            setCategoryDialogOpen(true)
          }}
          onSelect={(categoryId) => {
            update(withField(values, "category", { categoryId, categorySource: "set" }))
            setSheet(null)
          }}
          returnFocusTo={rowFocus("category")}
          selectedId={values.categoryId}
          theme={theme}
        />
      )}

      {categoryDialogOpen && householdId && (
        <CategoryDialog
          getFallbackFocus={rowFocus("category")}
          householdId={householdId}
          onCancel={() => setCategoryDialogOpen(false)}
          onSaved={(created) => {
            setOptions((current) =>
              current ? { ...current, categories: [...current.categories, created] } : current,
            )
            update(withField(values, "category", { categoryId: created.id, categorySource: "set" }))
            setCategoryDialogOpen(false)
            // Home, My Chores and the admin list read categories; let them refresh.
            invalidateChores()
          }}
        />
      )}

      {confirmDiscard && (
        <div className={styles.dialogBackdrop} role="presentation">
          <section
            aria-labelledby="discard-changes-title"
            aria-modal="true"
            className={styles.dialog}
            ref={discardDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="discard-changes-title">Discard changes?</h2>
            <p>Your unsaved changes will be lost.</p>
            <div className={styles.dialogButtons}>
              <button
                className={styles.secondaryButton}
                onClick={() => setConfirmDiscard(false)}
                type="button"
              >
                Keep editing
              </button>
              <button className={styles.primaryButton} onClick={exit} type="button">
                Discard
              </button>
            </div>
          </section>
        </div>
      )}

      {confirmArchive && chore && (
        <div className={styles.dialogBackdrop} role="presentation">
          <section
            aria-labelledby="archive-chore-title"
            aria-modal="true"
            className={styles.dialog}
            ref={archiveDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="archive-chore-title">Archive chore?</h2>
            <p>“{chore.title}” will leave the active list. Its history will be preserved.</p>
            {archiveError && (
              <p className={styles.dialogError} role="alert">
                {archiveError}
              </p>
            )}
            <div className={styles.dialogButtons}>
              <button
                className={styles.secondaryButton}
                disabled={archiving}
                onClick={() => setConfirmArchive(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className={styles.dangerButton}
                disabled={archiving}
                onClick={() => void archive()}
                type="button"
              >
                {archiving ? "Archiving…" : "Archive"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
