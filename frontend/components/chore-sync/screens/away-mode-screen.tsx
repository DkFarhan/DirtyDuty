"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BellOff,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  Pause,
  Pencil,
  Plane,
  Repeat2,
  Sparkles,
  UsersRound,
} from "lucide-react"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import { categoryIcon } from "@/lib/household/category-icons"
import {
  QUICK_PICKS,
  awayApi,
  awaySummary,
  effectLine,
  effectiveEnd,
  formatAwayDay,
  matchingQuickPick,
  quickPickDates,
  todayIn,
  validateAwayDates,
  type AwayDates,
  type AwayEffect,
  type AwayStatus,
} from "@/lib/household/away"
import {
  HouseholdLiveDesignHeader,
  type PreviewTheme,
} from "../redesign/household-secondary-design-preview"
import { useDialogFocus } from "../use-dialog-focus"
import designStyles from "../redesign/household-secondary-design-preview.module.css"
import formStyles from "../chore-form/chore-form.module.css"
import styles from "./away-mode-screen.module.css"

/**
 * Away mode (E10). A1 sets or changes the dates, with a live preview of what happens to the
 * member's chores; A2 shows away mode while it's on or upcoming. The member opens it from Profile;
 * an owner or admin opens it for someone from the Household member menu.
 */
export function AwayModeScreen({ theme = "light" }: { theme?: PreviewTheme }) {
  const { state, navigate, awayTarget, awayReturn } = useChoreSync()
  const { activeHousehold } = useHouseholds()
  const householdId = activeHousehold?.id ?? null
  const userId = awayTarget?.userId ?? state.currentUser.id
  const self = !awayTarget || awayTarget.userId === state.currentUser.id
  const today = todayIn(activeHousehold?.timezone ?? "UTC")
  const [status, setStatus] = useState<AwayStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [dates, setDates] = useState<AwayDates>(() => quickPickDates("weekend", today))
  const [postToBoard, setPostToBoard] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const confirmRef = useRef<HTMLElement | null>(null)
  const name = awayTarget?.displayName ?? status?.displayName ?? ""

  const back = useCallback(() => navigate(awayReturn), [awayReturn, navigate])

  const load = useCallback(async () => {
    if (!householdId) return
    setLoadError(null)
    try {
      const result = await awayApi.status(householdId, userId)
      setStatus(result)
      setEditing(!result.period)
    } catch (cause) {
      setLoadError(
        cause instanceof ApiError ? cause.message : "Away mode didn't load. Please try again.",
      )
    }
  }, [householdId, userId])

  useEffect(() => {
    void load()
  }, [load])

  useDialogFocus(
    confirmRef,
    confirmEnd,
    () => setConfirmEnd(false),
    () => document.querySelector<HTMLElement>("[data-away-end]"),
  )

  const period = status?.period ?? null
  const keptStart = period?.status === "ACTIVE" ? period.startsOn : null

  const startEditing = () => {
    if (period) {
      setDates({
        startsOn: period.startsOn,
        endsOn: period.untilBack ? null : period.endsOn,
        untilBack: period.untilBack,
      })
    }
    setSaveError(null)
    setEditing(true)
  }

  const save = async () => {
    if (!householdId || saving) return
    if (validateAwayDates(dates, today, keptStart)) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = period
        ? await awayApi.update(householdId, userId, dates)
        : await awayApi.set(householdId, userId, dates, postToBoard)
      setStatus(result)
      setEditing(false)
    } catch (cause) {
      setSaveError(
        cause instanceof ApiError
          ? cause.message
          : "Away mode couldn't be saved. Please try again.",
      )
    } finally {
      setSaving(false)
    }
  }

  const endNow = async () => {
    if (!householdId || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await awayApi.end(householdId, userId)
      setStatus(result)
      setConfirmEnd(false)
      setEditing(true)
      setDates(quickPickDates("weekend", today))
    } catch (cause) {
      setConfirmEnd(false)
      setSaveError(
        cause instanceof ApiError
          ? cause.message
          : "Away mode couldn't be ended. Please try again.",
      )
    } finally {
      setSaving(false)
    }
  }

  const title = self ? "Away mode" : `Away mode for ${name}`
  const eyebrow = self ? "Profile · Away mode" : "Household · Away mode"
  const household = activeHousehold?.name ?? "Your household"
  const rootClass = `flex min-h-screen flex-col ${designStyles.liveRoot} ${designStyles.choreForm} ${designStyles[theme]} ${formStyles.page} ${styles.page}`

  if (!status) {
    return (
      <div className={rootClass} data-theme={theme}>
        <HouseholdLiveDesignHeader
          eyebrow={eyebrow}
          heroEyebrow="Taking a break"
          heroIconNode={<Plane size={28} />}
          heroTitle="Away mode"
          household={household}
          onBack={back}
          title={title}
        />
        <div className={designStyles.liveContent}>
          {loadError ? (
            <div className={`${formStyles.card} ${styles.stack}`}>
              <p className={formStyles.inputError} role="alert">
                {loadError}
              </p>
              <button
                className={formStyles.secondaryButton}
                onClick={() => void load()}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : (
            <div
              aria-label="Loading away mode"
              className={`${formStyles.card} h-40 animate-pulse`}
            />
          )}
        </div>
      </div>
    )
  }

  if (editing) {
    return (
      <AwaySetDates
        back={period ? () => setEditing(false) : back}
        dates={dates}
        eyebrow={eyebrow}
        household={household}
        householdId={householdId}
        keptStart={keptStart}
        name={name}
        onChange={setDates}
        onPostToBoard={setPostToBoard}
        onSave={() => void save()}
        postToBoard={postToBoard}
        rootClass={rootClass}
        saveError={saveError}
        saving={saving}
        self={self}
        showBoardToggle={!period}
        theme={theme}
        title={title}
        today={today}
        userId={userId}
      />
    )
  }

  const upcoming = period?.status === "UPCOMING"
  const covered = status.chores.filter((chore) => chore.effect !== "PAUSED").length
  const paused = status.chores
    .filter((chore) => chore.effect === "PAUSED")
    .map((chore) => chore.title)

  return (
    <div className={rootClass} data-theme={theme}>
      <HouseholdLiveDesignHeader
        eyebrow={eyebrow}
        heroDescription={
          self
            ? "Enjoy the break. The house has your turns covered."
            : `The house has ${name}'s turns covered.`
        }
        heroDetails={
          period && (
            <p className={styles.dateChip}>
              <CalendarDays aria-hidden="true" size={14} />
              {upcoming
                ? `Starts ${formatAwayDay(period.startsOn)}`
                : period.untilBack
                  ? `Since ${formatAwayDay(period.startsOn)}`
                  : `${formatAwayDay(period.startsOn)} – ${formatAwayDay(period.endsOn)}`}
            </p>
          )
        }
        heroEyebrow={
          upcoming
            ? self
              ? "You're going away"
              : `${name} is going away`
            : self
              ? "You're away"
              : `${name} is away`
        }
        heroIconNode={<Plane size={28} />}
        heroTitle={
          period?.untilBack ? "Back when you're back." : `Back ${formatAwayDay(period!.returnsOn)}.`
        }
        household={household}
        onBack={back}
        title={title}
      />
      <main className={`${designStyles.liveContent} ${formStyles.main} ${styles.stack}`}>
        <section aria-label="While away" className={`${formStyles.card} ${styles.statusRows}`}>
          <div className={styles.statusRow}>
            <span aria-hidden="true" className={formStyles.tile}>
              <Repeat2 size={18} />
            </span>
            <span className={styles.statusLabel}>Turns covered</span>
            <span className={styles.statusValue}>
              {covered === 0 ? "None" : `${covered} ${covered === 1 ? "chore" : "chores"}`}
            </span>
          </div>
          <div className={styles.statusRow}>
            <span aria-hidden="true" className={formStyles.tile}>
              <Pause size={18} />
            </span>
            <span className={styles.statusLabel}>Paused</span>
            <span className={styles.statusValue}>
              {paused.length ? paused.join(", ") : "Nothing"}
            </span>
          </div>
          <div className={styles.statusRow}>
            <span aria-hidden="true" className={formStyles.tile}>
              <BellOff size={18} />
            </span>
            <span className={styles.statusLabel}>Chore reminders</span>
            <span className={styles.statusValue}>
              {self ? "Off until you're back" : "Off until they're back"}
            </span>
          </div>
        </section>
        <button
          className={`${formStyles.card} ${styles.linkRow}`}
          onClick={startEditing}
          type="button"
        >
          <span aria-hidden="true" className={formStyles.tile}>
            <Pencil size={18} />
          </span>
          <span className={styles.statusLabel}>Change dates</span>
          <ChevronRight aria-hidden="true" className={styles.chevron} size={18} />
        </button>
        <p className={styles.footnote}>
          Board posts still reach {self ? "you" : "them"}, using {self ? "your" : "their"} normal
          notification settings.
        </p>
      </main>
      <div className={formStyles.footer}>
        <div className={formStyles.footerInner}>
          {saveError && (
            <p className={formStyles.footerError} role="alert">
              {saveError}
            </p>
          )}
          <div className={formStyles.footerButtons}>
            <button className={formStyles.secondaryButton} onClick={back} type="button">
              Done
            </button>
            <button
              className={formStyles.primaryButton}
              data-away-end
              onClick={() => setConfirmEnd(true)}
              type="button"
            >
              {upcoming ? "Cancel away dates" : self ? "I'm back now" : `${name} is back`}
            </button>
          </div>
        </div>
      </div>
      {confirmEnd && (
        <div className={formStyles.dialogBackdrop} role="presentation">
          <section
            aria-labelledby="away-end-title"
            aria-modal="true"
            className={formStyles.dialog}
            ref={confirmRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 id="away-end-title">
              {upcoming ? "Cancel these away dates?" : "End away mode now?"}
            </h2>
            <p>
              {upcoming
                ? "Nothing changes for their chores."
                : `${self ? "Your" : "Their"} turns start again today, level with everyone.`}
            </p>
            <div className={formStyles.dialogButtons}>
              <button
                className={formStyles.secondaryButton}
                onClick={() => setConfirmEnd(false)}
                type="button"
              >
                Keep it on
              </button>
              <button
                className={formStyles.primaryButton}
                disabled={saving}
                onClick={() => void endNow()}
                type="button"
              >
                {saving ? "Ending…" : upcoming ? "Cancel dates" : "End now"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function AwaySetDates({
  back,
  dates,
  eyebrow,
  household,
  householdId,
  keptStart,
  name,
  onChange,
  onPostToBoard,
  onSave,
  postToBoard,
  rootClass,
  saveError,
  saving,
  self,
  showBoardToggle,
  theme,
  title,
  today,
  userId,
}: {
  back: () => void
  dates: AwayDates
  eyebrow: string
  household: string
  householdId: string | null
  keptStart: string | null
  name: string
  onChange: (dates: AwayDates) => void
  onPostToBoard: (value: boolean) => void
  onSave: () => void
  postToBoard: boolean
  rootClass: string
  saveError: string | null
  saving: boolean
  self: boolean
  showBoardToggle: boolean
  theme: PreviewTheme
  title: string
  today: string
  userId: string
}) {
  const [chores, setChores] = useState<AwayEffect[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const error = validateAwayDates(dates, today, keptStart)
  const pick = matchingQuickPick(dates, today)
  const previewKey = `${dates.startsOn}|${dates.endsOn}|${dates.untilBack}`

  useEffect(() => {
    if (!householdId || error) return
    let live = true
    const timer = window.setTimeout(() => {
      awayApi
        .preview(householdId, userId, dates)
        .then((result) => {
          if (!live) return
          setChores(result.chores)
          setPreviewError(null)
        })
        .catch((cause: unknown) => {
          if (!live) return
          setPreviewError(
            cause instanceof ApiError
              ? cause.message
              : "The preview didn't load. Please try again.",
          )
        })
    }, 200)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
    // previewKey stands for the dates, so a new object with the same dates doesn't refetch.
  }, [householdId, userId, previewKey, Boolean(error)])

  const summary = useMemo(
    () => awaySummary(dates, today, chores ?? [], self),
    [chores, dates, self, today],
  )
  const endsOn = effectiveEnd(dates, today)

  return (
    <div className={rootClass} data-theme={theme}>
      <HouseholdLiveDesignHeader
        eyebrow={eyebrow}
        heroDescription={
          self
            ? "Your chores pause or pass to others while you're gone. Nothing piles up when you're back."
            : `${name}'s chores pause or pass to others while they're gone. Nothing piles up when they're back.`
        }
        heroEyebrow="Taking a break"
        heroIconNode={<Plane size={28} />}
        heroTitle={
          self ? (
            <>
              Going away? We&apos;ll
              <br />
              cover your turns.
            </>
          ) : (
            <>
              Going away? We&apos;ll
              <br />
              cover {name}&apos;s turns.
            </>
          )
        }
        household={household}
        onBack={back}
        title={title}
      />
      <main className={`${designStyles.liveContent} ${formStyles.main} ${styles.stack}`}>
        <section aria-label="Dates" className={formStyles.card}>
          <div className={styles.dateGrid}>
            <DateField
              invalid={error?.field === "startsOn"}
              label="From"
              min={keptStart ?? today}
              onChange={(value) => onChange({ ...dates, startsOn: value })}
              value={dates.startsOn}
            />
            <DateField
              display={dates.untilBack ? "I'm back" : undefined}
              invalid={error?.field === "endsOn"}
              label="Until"
              min={dates.startsOn || today}
              onChange={(value) => onChange({ ...dates, endsOn: value, untilBack: false })}
              value={dates.untilBack ? (endsOn ?? "") : (dates.endsOn ?? "")}
            />
          </div>
          {error && (
            <p className={`${formStyles.inputError} ${styles.dateError}`} role="alert">
              {error.message}
            </p>
          )}
          <p className={formStyles.sectionLabel} id="away-quick-picks">
            Quick picks
          </p>
          <div aria-labelledby="away-quick-picks" className={formStyles.chips} role="group">
            {QUICK_PICKS.map((option) => (
              <button
                aria-pressed={pick === option.id}
                className={`${formStyles.chip} ${styles.pick}`}
                key={option.id}
                onClick={() => onChange(quickPickDates(option.id, today))}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          {!error && (
            <p aria-live="polite" className={formStyles.summary} data-testid="away-summary">
              <Sparkles aria-hidden="true" size={16} />
              <span>
                {summary.map((part, index) =>
                  part.strong ? (
                    <strong key={index}>{part.text}</strong>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )}
              </span>
            </p>
          )}
        </section>

        <section
          aria-labelledby="away-chores-heading"
          className={`${formStyles.card} ${styles.effects}`}
        >
          <h2 className={styles.effectsHeading} id="away-chores-heading">
            What happens to {self ? "your" : `${name}'s`} chores
          </h2>
          {previewError && (
            <p className={formStyles.inputError} role="alert">
              {previewError}
            </p>
          )}
          {!previewError && chores === null && !error && (
            <div
              aria-label="Loading the preview"
              className={`${styles.effectSkeleton} animate-pulse`}
            />
          )}
          {chores !== null && chores.length === 0 && (
            <p className={styles.effectsEmpty}>
              {self ? "None of your chores" : `None of ${name}'s chores`} come up on these dates.
            </p>
          )}
          {chores !== null && chores.length > 0 && (
            <ul className={styles.effectList}>
              {chores.map((chore) => (
                <li className={styles.effect} key={chore.choreId}>
                  <span aria-hidden="true" className={formStyles.tile}>
                    {categoryIcon(chore.categoryIcon)}
                  </span>
                  <span className={styles.effectCopy}>
                    <strong>{chore.title}</strong>
                    <small>
                      {chore.effect === "SKIPS_YOU" ? (
                        <Repeat2 aria-hidden="true" size={13} />
                      ) : chore.effect === "PAUSED" ? (
                        <Pause aria-hidden="true" size={13} />
                      ) : (
                        <UsersRound aria-hidden="true" size={13} />
                      )}
                      {effectLine(chore, self)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.levelNote}>
            <Check aria-hidden="true" size={16} />
            <span>
              When {self ? "you're" : "they're"} back, {self ? "you start" : "they start"} level
              with everyone. No catching up.
            </span>
          </p>
        </section>

        {showBoardToggle && (
          <div className={formStyles.card}>
            <button
              aria-checked={postToBoard}
              className={formStyles.toggleRow}
              onClick={() => onPostToBoard(!postToBoard)}
              role="switch"
              type="button"
            >
              <span aria-hidden="true" className={formStyles.tile}>
                <FileText size={18} />
              </span>
              <span className={styles.toggleLabel}>Also post it on the Board</span>
              <span aria-hidden="true" className={formStyles.switch} />
            </button>
          </div>
        )}
      </main>
      <div className={formStyles.footer}>
        <div className={formStyles.footerInner}>
          {saveError && (
            <p className={formStyles.footerError} role="alert">
              {saveError}
            </p>
          )}
          <div className={formStyles.footerButtons}>
            <button className={formStyles.secondaryButton} onClick={back} type="button">
              Cancel
            </button>
            <button
              aria-disabled={Boolean(error) || saving}
              className={formStyles.primaryButton}
              disabled={Boolean(error) || saving}
              onClick={onSave}
              type="button"
            >
              {saving ? "Saving…" : showBoardToggle ? "Set away" : "Save dates"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A date shown as "Fri, Nov 28" that opens the native date picker. */
function DateField({
  label,
  value,
  min,
  invalid,
  display,
  onChange,
}: {
  label: string
  value: string
  min: string
  invalid: boolean
  display?: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <span className={formStyles.fieldLabel}>{label}</span>
      <label className={styles.dateField} data-invalid={invalid ? "true" : undefined}>
        <CalendarDays aria-hidden="true" size={18} />
        <span className={styles.dateText}>
          {display ?? (value ? formatAwayDay(value) : "Choose")}
        </span>
        <input
          aria-invalid={invalid}
          aria-label={label}
          className={styles.dateNative}
          min={min}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value)
          }}
          onClick={(event) => {
            try {
              event.currentTarget.showPicker?.()
            } catch {
              // Some browsers only open the picker from their own control.
            }
          }}
          type="date"
          value={value}
        />
      </label>
    </div>
  )
}
