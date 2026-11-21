"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Bell,
  Bug,
  CalendarDays,
  ChevronRight,
  CirclePlus,
  ClipboardList,
  Droplet,
  Flame,
  KeyRound,
  Lightbulb,
  ListChecks,
  Megaphone,
  Moon,
  Package,
  PartyPopper,
  Pin,
  Plane,
  Sparkles,
  Text,
  Thermometer,
  Truck,
  UsersRound,
  UtensilsCrossed,
  WashingMachine,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { boardApi, type BoardMember, type BoardPost, type BoardPostType } from "@/lib/board/api"
import {
  MAX_POST_DETAILS,
  MAX_POST_TITLE,
  applyPostSuggestion,
  buildPostRequest,
  initialPostValues,
  notifyLabel,
  postSummary,
  valuesFromPost,
  whenLabel,
  withPostField,
  type PostFormError,
  type PostFormValues,
} from "@/lib/board/post-form"
import {
  POPULAR_POST_SUGGESTIONS,
  TYPE_LABELS,
  choreHintFor,
  describePostSuggestion,
  matchPostSuggestions,
  type PostSuggestion,
  type PostSuggestionIcon,
} from "@/lib/board/post-suggestions"
import { useChoreSync } from "@/lib/chore-sync/store"
import { householdBoardResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { useHouseholds } from "@/lib/household/household-context"
import { NotifySheet, TYPE_ICONS, TypeSheet, WhenSheet } from "../board/post-sheets"
import {
  HouseholdLiveDesignHeader,
  type PreviewTheme,
} from "../redesign/household-secondary-design-preview"
import { useDialogFocus } from "../use-dialog-focus"
import designStyles from "../redesign/household-secondary-design-preview.module.css"
import formStyles from "../chore-form/chore-form.module.css"
import styles from "../board/board-post-form.module.css"

export const POST_ICONS: Record<PostSuggestionIcon, (size: number) => ReactNode> = {
  bug: (size) => <Bug size={size} />,
  wrench: (size) => <Wrench size={size} />,
  zap: (size) => <Zap size={size} />,
  droplet: (size) => <Droplet size={size} />,
  flame: (size) => <Flame size={size} />,
  users: (size) => <UsersRound size={size} />,
  party: (size) => <PartyPopper size={size} />,
  bell: (size) => <Bell size={size} />,
  sparkles: (size) => <Sparkles size={size} />,
  clipboard: (size) => <ClipboardList size={size} />,
  truck: (size) => <Truck size={size} />,
  wifi: (size) => <Wifi size={size} />,
  thermometer: (size) => <Thermometer size={size} />,
  lightbulb: (size) => <Lightbulb size={size} />,
  washer: (size) => <WashingMachine size={size} />,
  box: (size) => <Package size={size} />,
  moon: (size) => <Moon size={size} />,
  plane: (size) => <Plane size={size} />,
  key: (size) => <KeyRound size={size} />,
  utensils: (size) => <UtensilsCrossed size={size} />,
  megaphone: (size) => <Megaphone size={size} />,
}

type Sheet = "type" | "when" | "notify"

/** New post and Edit post: the same page, prefilled when editing. */
export function BoardPostFormScreen({ theme = "light" }: { theme?: PreviewTheme }) {
  const { state, navigate, editingBoardPostId, openBoardPost, startChoreDraft } = useChoreSync()
  const { activeHousehold: household } = useHouseholds()
  const householdId = household?.id ?? null
  const timeZone = household?.timezone ?? "UTC"
  const viewerId = state.currentUser.id
  const editing = editingBoardPostId !== null
  const { invalidate } = useDataSync(
    householdId ? householdBoardResource(householdId) : "household:none:board",
  )

  const [members, setMembers] = useState<BoardMember[]>([])
  const [admin, setAdmin] = useState(
    household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN",
  )
  const [original, setOriginal] = useState<BoardPost | null>(null)
  const [values, setValues] = useState<PostFormValues | null>(null)
  const [savedValues, setSavedValues] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<PostFormError | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const suggestionsRef = useRef<HTMLUListElement | null>(null)
  const discardRef = useRef<HTMLElement | null>(null)
  const savingRef = useRef(false)

  useDialogFocus(
    discardRef,
    confirmDiscard,
    () => setConfirmDiscard(false),
    () => document.querySelector<HTMLElement>("[data-board-form-cancel]"),
  )

  useEffect(() => {
    if (!householdId) return
    let cancelled = false
    Promise.all([
      boardApi.board(householdId),
      editingBoardPostId ? boardApi.get(householdId, editingBoardPostId) : Promise.resolve(null),
    ])
      .then(([board, post]) => {
        if (cancelled) return
        const next = post ? valuesFromPost(post) : initialPostValues()
        setMembers(board.members)
        setAdmin(board.viewerIsAdmin)
        setOriginal(post)
        setValues(next)
        setSavedValues(JSON.stringify(next))
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(
            cause instanceof ApiError
              ? cause.message
              : "Unable to open the form. Please try again.",
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [editingBoardPostId, householdId])

  const ready = values !== null
  useEffect(() => {
    if (ready && !editing) nameRef.current?.focus()
  }, [editing, ready])

  const authorId = original ? original.authorUserId : viewerId
  const others = useMemo(
    () => members.filter((member) => member.userId !== authorId),
    [authorId, members],
  )
  const dirty = values !== null && JSON.stringify(values) !== savedValues
  const back = () => {
    if (editing && editingBoardPostId) openBoardPost(editingBoardPostId)
    else navigate("board")
  }
  const leave = () => (dirty ? setConfirmDiscard(true) : back())

  const update = (next: PostFormValues) => {
    setValues(next)
    setFieldError(null)
    setSaveError(null)
  }

  const save = async () => {
    if (!householdId || !values || savingRef.current) return
    const result = buildPostRequest(values, timeZone, original)
    if ("error" in result) {
      setFieldError(result.error)
      if (result.error.field === "title") nameRef.current?.focus()
      return
    }
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      if (editing && editingBoardPostId) {
        await boardApi.update(householdId, editingBoardPostId, result.request)
        invalidate()
        openBoardPost(editingBoardPostId)
      } else {
        await boardApi.create(householdId, result.request)
        invalidate()
        navigate("board")
      }
    } catch (cause) {
      setSaveError(
        cause instanceof ApiError ? cause.message : "Unable to post this. Please try again.",
      )
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const header = (
    <HouseholdLiveDesignHeader
      eyebrow={editing ? "Board · Edit post" : "Board · New post"}
      heroDescription="You can see who has seen it, and remind the rest."
      heroEyebrow="Tell everyone once"
      heroIconNode={<Megaphone size={28} />}
      heroTitle={
        <>
          Say it once.
          <br />
          Everyone sees it.
        </>
      }
      household={household?.name ?? "Your household"}
      onBack={leave}
      title={editing ? "Edit post" : "Post to the house"}
    />
  )
  const rootClass = `flex min-h-screen flex-col ${designStyles.liveRoot} ${designStyles.choreForm} ${designStyles[theme]} ${formStyles.page}`

  if (!values) {
    return (
      <div className={rootClass} data-theme={theme}>
        {header}
        <div className={designStyles.liveContent}>
          {loadError || !householdId ? (
            <>
              <p className={`${formStyles.card} ${formStyles.inputError}`} role="alert">
                {loadError ?? "Your household could not be found."}
              </p>
              <button className={formStyles.secondaryButton} onClick={back} type="button">
                Back to the board
              </button>
            </>
          ) : (
            [0, 1].map((item) => (
              <div
                aria-label="Loading"
                className={`${formStyles.card} h-36 animate-pulse`}
                key={item}
              />
            ))
          )}
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------------ name card
  const title = values.title
  const named = title.trim() !== ""
  const matches = !editing && suggesting && named ? matchPostSuggestions(title) : []
  const choreHint = !editing && named ? choreHintFor(title) : null
  const pick = (suggestion: PostSuggestion) => {
    update(applyPostSuggestion(values, suggestion))
    setSuggesting(false)
    nameRef.current?.focus()
  }
  const titleError = fieldError?.field === "title" ? fieldError.message : null
  const chooseType = (type: BoardPostType) => update(withPostField(values, "type", { type }))
  const summary = values.type ? postSummary(values, members, authorId ?? viewerId, timeZone) : null

  const nameCard = (
    <section aria-label="What's happening" className={formStyles.card}>
      <label className={formStyles.fieldLabel} htmlFor="board-post-title">
        What&apos;s happening?
      </label>
      <input
        aria-describedby={titleError ? "board-post-title-error" : undefined}
        aria-invalid={titleError ? true : undefined}
        autoComplete="off"
        className={formStyles.nameInput}
        id="board-post-title"
        maxLength={MAX_POST_TITLE}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (!(next instanceof Node) || !suggestionsRef.current?.contains(next)) {
            setSuggesting(false)
          }
        }}
        onChange={(event) => {
          update({ ...values, title: event.target.value })
          setSuggesting(true)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape") {
            if (matches.length > 0) event.preventDefault()
            setSuggesting(false)
          }
        }}
        placeholder="e.g. Pest control on Thursday"
        ref={nameRef}
        value={title}
      />
      {title.length >= MAX_POST_TITLE - 20 && (
        <p className={formStyles.counter}>
          {title.length}/{MAX_POST_TITLE}
        </p>
      )}
      {titleError && (
        <p className={formStyles.inputError} id="board-post-title-error" role="alert">
          {titleError}
        </p>
      )}
      {!editing && !named && (
        <>
          <p className={formStyles.sectionLabel} id="board-post-popular">
            Suggestions
          </p>
          <ul aria-labelledby="board-post-popular" className={formStyles.chips}>
            {POPULAR_POST_SUGGESTIONS.map((suggestion) => (
              <li key={suggestion.title}>
                <button className={formStyles.chip} onClick={() => pick(suggestion)} type="button">
                  <span aria-hidden="true">{POST_ICONS[suggestion.icon](15)}</span>
                  {suggestion.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {matches.length > 0 && (
        <>
          <p className={formStyles.sectionLabel} id="board-post-suggestions">
            Suggestions
          </p>
          <ul
            aria-labelledby="board-post-suggestions"
            className={formStyles.suggestions}
            ref={suggestionsRef}
          >
            {matches.map(({ suggestion, before, match, after }) => (
              <li key={suggestion.title}>
                <button
                  aria-label={`Use ${suggestion.title}: ${describePostSuggestion(suggestion)}`}
                  className={formStyles.suggestion}
                  onClick={() => pick(suggestion)}
                  type="button"
                >
                  <span aria-hidden="true" className={formStyles.tile}>
                    {POST_ICONS[suggestion.icon](17)}
                  </span>
                  <span>
                    <span className={formStyles.suggestionTitle}>
                      {before}
                      <strong>{match}</strong>
                      {after}
                    </span>
                    <span className={formStyles.suggestionHint}>
                      {describePostSuggestion(suggestion)}
                    </span>
                  </span>
                  <CirclePlus aria-hidden="true" size={20} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {choreHint && (
        <div className={styles.choreHint} data-testid="board-chore-hint">
          <ListChecks aria-hidden="true" size={16} />
          <p>
            &ldquo;{choreHint}&rdquo; sounds like a chore.{" "}
            {admin ? (
              <button
                className={styles.choreHintLink}
                onClick={() => startChoreDraft({ title: choreHint, returnTo: "board" })}
                type="button"
              >
                Create a chore instead
              </button>
            ) : (
              <span>Ask an admin to add it as a chore.</span>
            )}
          </p>
        </div>
      )}
      {values.type && (
        <>
          <p className={formStyles.sectionLabel} id="board-post-type">
            Type
          </p>
          <div
            aria-labelledby="board-post-type"
            className={`${formStyles.segmented} ${styles.typeSegments}`}
            role="group"
          >
            {(["EVENT", "PROBLEM", "HEADS_UP"] as const).map((type) => (
              <button
                aria-pressed={values.type === type}
                className={`${formStyles.segment} ${styles.typeSegment}`}
                key={type}
                onClick={() => chooseType(type)}
                type="button"
              >
                {TYPE_ICONS[type](15)}
                {TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </>
      )}
      {summary && named && matches.length === 0 && (
        <p aria-live="polite" className={formStyles.summary} data-testid="board-post-summary">
          <Sparkles aria-hidden="true" size={15} />
          <span>
            {summary.map((part, index) =>
              part.strong ? <strong key={index}>{part.text}</strong> : part.text,
            )}
          </span>
        </p>
      )}
    </section>
  )

  // ------------------------------------------------------------------ rows
  const rowFocus = (row: Sheet) => () =>
    document.querySelector<HTMLElement>(`[data-board-form-row="${row}"]`)
  const row = (id: Sheet, icon: ReactNode, label: string, value: string, onClick: () => void) => (
    <button
      aria-haspopup="dialog"
      aria-label={`${label}: ${value}`}
      className={formStyles.row}
      data-board-form-row={id}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className={formStyles.tile}>
        {icon}
      </span>
      <span className={formStyles.rowLabel}>{label}</span>
      <span className={formStyles.rowValue}>{value}</span>
      <ChevronRight aria-hidden="true" size={18} />
    </button>
  )
  const rowError = (field: PostFormError["field"]) =>
    fieldError?.field === field ? (
      <p className={formStyles.error} role="alert">
        {fieldError.message}
      </p>
    ) : null

  const rowsCard = (
    <section aria-label="Post settings" className={`${formStyles.card} ${formStyles.rows}`}>
      {values.type === null && (
        <div className={formStyles.rowWrap}>
          {row("type", <Megaphone size={18} />, "Type", "Picked from what you write", () =>
            setSheet("type"),
          )}
        </div>
      )}
      {values.type === "EVENT" && (
        <div className={formStyles.rowWrap}>
          {row("when", <CalendarDays size={18} />, "When", whenLabel(values), () =>
            setSheet("when"),
          )}
          {rowError("when")}
        </div>
      )}
      {(values.type !== null || named) && (
        <div className={`${formStyles.rowWrap} ${styles.detailsBlock}`}>
          <label className={styles.detailsHead} htmlFor="board-post-details">
            <span aria-hidden="true" className={formStyles.tile}>
              <Text size={18} />
            </span>
            Details
            <small>Optional</small>
          </label>
          <textarea
            className={styles.detailsInput}
            id="board-post-details"
            maxLength={MAX_POST_DETAILS}
            onChange={(event) =>
              update(withPostField(values, "details", { details: event.target.value }))
            }
            placeholder="Add a note (optional)"
            rows={3}
            value={values.details}
          />
          {values.details.length >= MAX_POST_DETAILS - 100 && (
            <p className={formStyles.counter}>
              {values.details.length}/{MAX_POST_DETAILS}
            </p>
          )}
        </div>
      )}
      <div className={formStyles.rowWrap}>
        {row("notify", <Bell size={18} />, "Notify", notifyLabel(values, others), () =>
          setSheet("notify"),
        )}
        {rowError("notify")}
      </div>
      {admin && (
        <div className={formStyles.rowWrap}>
          <button
            aria-checked={values.pinned}
            className={`${formStyles.toggleRow} ${styles.pinRow}`}
            onClick={() => update({ ...values, pinned: !values.pinned })}
            role="switch"
            type="button"
          >
            <span aria-hidden="true" className={formStyles.tile}>
              <Pin size={18} />
            </span>
            <span>Pin to house info</span>
            <span aria-hidden="true" className={formStyles.switch} />
          </button>
        </div>
      )}
    </section>
  )

  const postDisabled = !named || saving
  return (
    <div className={rootClass} data-theme={theme}>
      {header}
      <main className={`${designStyles.liveContent} ${formStyles.main}`}>
        {nameCard}
        {rowsCard}
      </main>

      <div className={formStyles.footer}>
        <div className={formStyles.footerInner}>
          {saveError && (
            <p className={formStyles.footerError} role="alert">
              {saveError}
            </p>
          )}
          <div className={formStyles.footerButtons}>
            <button
              className={formStyles.secondaryButton}
              data-board-form-cancel
              onClick={leave}
              type="button"
            >
              Cancel
            </button>
            <button
              aria-disabled={postDisabled}
              className={formStyles.primaryButton}
              disabled={postDisabled}
              onClick={() => void save()}
              type="button"
            >
              {saving ? "Saving…" : editing ? "Save" : "Post"}
            </button>
          </div>
        </div>
      </div>

      {sheet === "type" && (
        <TypeSheet
          onChoose={(type) => {
            chooseType(type)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
          returnFocusTo={() => nameRef.current}
          theme={theme}
          value={values.type}
        />
      )}
      {sheet === "when" && (
        <WhenSheet
          onChange={(patch) => update({ ...values, ...patch })}
          onClose={() => setSheet(null)}
          returnFocusTo={rowFocus("when")}
          theme={theme}
          timeZone={timeZone}
          values={values}
        />
      )}
      {sheet === "notify" && (
        <NotifySheet
          members={others}
          mode={values.notifyMode}
          onChange={(notifyMode, recipients) => update({ ...values, notifyMode, recipients })}
          onClose={() => setSheet(null)}
          recipients={values.recipients}
          returnFocusTo={rowFocus("notify")}
          theme={theme}
        />
      )}

      {confirmDiscard && (
        <div className={formStyles.dialogBackdrop} role="presentation">
          <section
            aria-labelledby="board-discard-title"
            aria-modal="true"
            className={formStyles.dialog}
            ref={discardRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="board-discard-title">{editing ? "Discard changes?" : "Discard this post?"}</h2>
            <p>What you wrote will be lost.</p>
            <div className={formStyles.dialogButtons}>
              <button
                className={formStyles.secondaryButton}
                onClick={() => setConfirmDiscard(false)}
                type="button"
              >
                Keep writing
              </button>
              <button className={formStyles.primaryButton} onClick={back} type="button">
                Discard
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
