"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MoreHorizontal, Plus } from "lucide-react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import {
  categoryIcon,
  choreApi,
  type Chore,
  type ChoreManagementOptions,
} from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import { householdChoreResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useDialogFocus } from "../use-dialog-focus"
import {
  HouseholdLiveDesignHeader,
  HouseholdLiveDesignSectionHeading,
  type PreviewTheme,
} from "../redesign/household-secondary-design-preview"
import designStyles from "../redesign/household-secondary-design-preview.module.css"

export function AdminScreen({
  initialTab = "chores",
  theme = "light",
}: {
  initialTab?: "members" | "chores"
  theme?: PreviewTheme
}) {
  void initialTab
  const { navigate, editChore } = useChoreSync()
  const { activeHousehold: household } = useHouseholds()
  const [chores, setChores] = useState<Chore[]>([])
  const [choreState, setChoreState] = useState<"loading" | "loaded" | "error">("loading")
  const [choreError, setChoreError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyChoreId, setBusyChoreId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [openMenuPlacement, setOpenMenuPlacement] = useState<"above" | "below">("below")
  const [archiveChore, setArchiveChore] = useState<Chore | null>(null)
  const archiveDialogRef = useRef<HTMLElement | null>(null)
  const [managementOptions, setManagementOptions] = useState<ChoreManagementOptions | null>(null)
  const requestSequence = useRef(0)
  const loadedHouseholdId = useRef<string | null>(null)
  const busyChores = useRef(new Set<string>())
  const choreResource = household
    ? householdChoreResource(household.id)
    : "household:none:chores-and-assignments"
  const { revision, invalidate } = useDataSync(choreResource)
  useDialogFocus(
    archiveDialogRef,
    archiveChore !== null,
    () => setArchiveChore(null),
    () => {
      if (!archiveChore) return null
      return (
        Array.from(document.querySelectorAll<HTMLButtonElement>("[data-archive-trigger]")).find(
          (button) => button.dataset.archiveTrigger === archiveChore.id,
        ) ?? null
      )
    },
  )

  const loadChores = useCallback(async () => {
    if (!household) {
      requestSequence.current += 1
      setChores([])
      setManagementOptions(null)
      loadedHouseholdId.current = null
      setChoreState("error")
      setChoreError("Your household could not be found.")
      return
    }
    const requestId = ++requestSequence.current
    const hasCurrentData = loadedHouseholdId.current === household.id
    if (!hasCurrentData) setChoreState("loading")
    try {
      const [nextChores, nextOptions] = await Promise.all([
        choreApi.list(household.id),
        choreApi.options(household.id),
      ])
      if (requestId !== requestSequence.current) return
      setChores(nextChores)
      setManagementOptions(nextOptions)
      loadedHouseholdId.current = household.id
      setChoreError(null)
      setRefreshError(null)
      setChoreState("loaded")
    } catch (cause) {
      if (requestId !== requestSequence.current) return
      const message =
        cause instanceof ApiError ? cause.message : "Unable to load chores. Please try again."
      if (hasCurrentData) {
        setRefreshError(
          cause instanceof ApiError ? cause.message : "Unable to refresh chores. Please try again.",
        )
        return
      }
      setChoreError(message)
      setChoreState("error")
    }
  }, [household])

  useEffect(() => {
    void loadChores()
    return () => {
      requestSequence.current += 1
    }
  }, [loadChores, revision])

  const runLifecycleAction = async (chore: Chore, action: "pause" | "activate" | "archive") => {
    if (!household) return
    const operationKey = `${household.id}:${chore.id}`
    if (busyChores.current.has(operationKey)) return
    busyChores.current.add(operationKey)
    setBusyChoreId(operationKey)
    setActionError(null)
    try {
      const updated =
        action === "pause"
          ? await choreApi.pause(household.id, chore.id)
          : action === "activate"
            ? await choreApi.activate(household.id, chore.id)
            : await choreApi.archive(household.id, chore.id)
      if (loadedHouseholdId.current === household.id) {
        setChores((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      }
      setOpenMenuId(null)
      setArchiveChore(null)
      invalidate()
    } catch (cause) {
      if (loadedHouseholdId.current === household.id) {
        setActionError(
          cause instanceof ApiError
            ? cause.message
            : "Unable to update this chore. Please try again.",
        )
      }
    } finally {
      busyChores.current.delete(operationKey)
      setBusyChoreId((current) => (current === operationKey ? null : current))
    }
  }

  const describeRecurrence = (rule: string | undefined) => {
    if (!rule) return "No schedule"
    if (rule === "FREQ=ONCE") return "One time"
    const fields = Object.fromEntries(
      rule.split(";").map((field) => {
        const [key, value] = field.split("=")
        return [key, value]
      }),
    )
    const dayNames: Record<string, string> = {
      MO: "Monday",
      TU: "Tuesday",
      WE: "Wednesday",
      TH: "Thursday",
      FR: "Friday",
      SA: "Saturday",
      SU: "Sunday",
    }
    if (fields.FREQ === "DAILY") return "Daily"
    const days = fields.BYDAY?.split(",")
      .map((day) => dayNames[day])
      .filter(Boolean)
      .join(", ")
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

  const activeHouseholdId = household?.id ?? null
  const visibleChores = chores.filter((chore) => chore.archivedAt === null)
  const visibleChoreState =
    loadedHouseholdId.current === activeHouseholdId || choreState === "error"
      ? choreState
      : "loading"
  const activeChoreCount = visibleChores.filter((chore) => chore.active).length
  const pausedChoreCount = visibleChores.filter((chore) => !chore.active).length
  const routineCountLabel = `${visibleChores.length} ${
    visibleChores.length === 1 ? "routine" : "routines"
  }`

  return (
    <div
      className={`flex min-h-screen flex-col ${`${designStyles.liveRoot} ${designStyles[theme]} ${designStyles.adminPage}`}`}
    >
      {
        <HouseholdLiveDesignHeader
          action={
            <button
              aria-label="Create a chore"
              className={designStyles.primaryButton}
              onClick={() => navigate("create-chore")}
              type="button"
            >
              <Plus aria-hidden="true" size={17} /> Create chore
            </button>
          }
          eyebrow="Household · Admin tools"
          heroDescription="Keep routines clear, shared, and easy to adjust."
          heroEyebrow="A rhythm that works"
          heroIcon="repeat"
          heroTitle={
            <>
              Make room for
              <br />a smoother week.
            </>
          }
          household={household?.name ?? "Your household"}
          onBack={() => navigate("household")}
          title="Manage chores"
        />
      }

      <div className={designStyles.liveContent}>
        {
          <>
            <div className={designStyles.summaryGrid}>
              <article className={designStyles.summaryCard}>
                <span>Active</span>
                <strong>{visibleChoreState === "loaded" ? activeChoreCount : "—"}</strong>
                <small>Household routines</small>
              </article>
              <article className={designStyles.summaryCard}>
                <span>Paused</span>
                <strong>{visibleChoreState === "loaded" ? pausedChoreCount : "—"}</strong>
                <small>Ready when you are</small>
              </article>
              <article className={designStyles.summaryCard}>
                <span>Household</span>
                <strong>
                  {visibleChoreState === "loaded"
                    ? (managementOptions?.activeMembers.length ?? "—")
                    : "—"}
                </strong>
                <small>People in the rotation</small>
              </article>
            </div>
            <HouseholdLiveDesignSectionHeading
              detail={visibleChoreState === "loaded" ? routineCountLabel : "Routines"}
              eyebrow="The shared rhythm"
              title="Household chores"
            />
          </>
        }
        <div className={designStyles.choreList}>
          {(actionError || (visibleChoreState === "loaded" && refreshError)) && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <p role="alert" className="flex-1">
                {actionError ?? refreshError}
              </p>
              {visibleChoreState === "loaded" && refreshError && (
                <button
                  className="shrink-0 font-bold underline"
                  onClick={() => void loadChores()}
                  type="button"
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {visibleChoreState === "loading" && (
            <div aria-label="Loading chores" className={designStyles.choreList}>
              {[0, 1, 2].map((item) => (
                <div className={`${designStyles.choreCard} ${designStyles.skeleton}`} key={item} />
              ))}
            </div>
          )}
          {visibleChoreState === "error" && (
            <div className={designStyles.emptyCard}>
              {<p className={designStyles.eyebrow}>A momentary pause</p>}
              {<h3>Chores didn’t load.</h3>}
              <p role="alert" className="text-sm text-slate-600">
                {choreError}
              </p>
              <Button
                className={designStyles.secondaryButton}
                onClick={() => void loadChores()}
                type="button"
                variant="outline"
              >
                Try again
              </Button>
            </div>
          )}
          {visibleChoreState === "loaded" && visibleChores.length === 0 && (
            <div className={designStyles.emptyCard}>
              {
                <>
                  <span aria-hidden="true" className={designStyles.emptyGlyph}>
                    <Plus size={24} />
                  </span>
                  <p className={designStyles.eyebrow}>A fresh start</p>
                  <h3>No shared chores yet.</h3>
                </>
              }
              <p className="mt-1 text-sm text-slate-400">
                Create your first chore and keep the household moving.
              </p>
              <Button
                className={designStyles.primaryButton}
                onClick={() => navigate("create-chore")}
                type="button"
              >
                Create Chore
              </Button>
            </div>
          )}
          {visibleChoreState === "loaded" &&
            visibleChores.map((chore) => {
              const category = chore.categoryId
                ? managementOptions?.categories.find((item) => item.id === chore.categoryId)
                : undefined
              const categoryLabel = category?.name
              const peopleNeeded = chore.schedule?.peopleNeeded ?? 1
              const participantCount = chore.schedule?.participantUserIds.length ?? 0
              const fixedAssignee = managementOptions?.activeMembers.find(
                (member) => member.userId === chore.schedule?.fixedAssigneeUserId,
              )
              const peopleLabel = `${participantCount} ${
                participantCount === 1 ? "person" : "people"
              }`
              const assignment =
                chore.schedule?.assignmentStrategy === "FIXED"
                  ? fixedAssignee
                    ? `Fixed · ${fixedAssignee.displayName}`
                    : "Fixed assignment"
                  : chore.schedule?.assignmentStrategy === "ROUND_ROBIN"
                    ? `Rotate · ${
                        participantCount > 0
                          ? peopleLabel
                          : `${peopleNeeded} ${peopleNeeded === 1 ? "person" : "people"}`
                      }`
                    : chore.schedule?.assignmentStrategy === "RANDOM"
                      ? `Random · ${peopleNeeded} of ${
                          participantCount > 0 ? peopleLabel : "participants"
                        }`
                      : null
              const scheduleDescription = chore.schedule
                ? [
                    chore.schedule.recurrenceRule
                      ? describeRecurrence(chore.schedule.recurrenceRule)
                      : null,
                    formatTime(chore.schedule.dueTime),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : ""
              const categoryScheduleParts = [categoryLabel, scheduleDescription].filter(
                (value): value is string => Boolean(value),
              )
              const choreDetails = [
                assignment,
                Number.isFinite(chore.difficulty) ? `Effort ${chore.difficulty}/5` : null,
                chore.estimatedMinutes ? `~${chore.estimatedMinutes} min` : null,
              ]
                .filter(Boolean)
                .join(" · ")
              return (
                <article
                  className={cn(
                    designStyles.choreCard,
                    openMenuId === chore.id && designStyles.choreCardMenuOpen,
                  )}
                  key={chore.id}
                >
                  <div className={"contents"}>
                    <span aria-hidden="true" className={designStyles.choreIcon}>
                      {categoryIcon(category?.iconKey)}
                    </span>
                    <div className={`min-w-0 flex-1 ${designStyles.choreInfo}`}>
                      <div
                        className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${
                          designStyles.choreTitleLine
                        }`}
                      >
                        <h3 className="min-w-0 break-words font-display text-base font-extrabold leading-snug text-slate-900">
                          {chore.title}
                        </h3>
                        <span
                          className={`${designStyles.statusPill} ${
                            chore.active ? designStyles.activePill : designStyles.pausedPill
                          }`}
                        >
                          {chore.active ? "Active" : "Paused"}
                        </span>
                      </div>
                      {(categoryScheduleParts.length > 0 || false) && (
                        <p
                          className={`mt-1.5 text-xs ${""}text-slate-600 ${designStyles.metaLine}`}
                        >
                          {
                            <>
                              {categoryScheduleParts[0]}
                              {categoryScheduleParts.length > 1 && (
                                <>
                                  {" "}
                                  <span>·</span> {categoryScheduleParts.slice(1).join(" · ")}
                                </>
                              )}
                            </>
                          }
                        </p>
                      )}
                      {choreDetails && (
                        <p
                          className={`mt-1 text-xs leading-relaxed text-slate-500 ${designStyles.metaLine}`}
                        >
                          {choreDetails}
                        </p>
                      )}
                    </div>
                    <button
                      aria-expanded={openMenuId === chore.id}
                      aria-label={`Actions for ${chore.title}`}
                      data-archive-trigger={chore.id}
                      className={designStyles.moreButton}
                      onClick={(event) => {
                        if (openMenuId === chore.id) {
                          setOpenMenuId(null)
                          return
                        }
                        {
                          const buttonBounds = event.currentTarget.getBoundingClientRect()
                          const availableAbove = buttonBounds.top
                          const availableBelow = window.innerHeight - buttonBounds.bottom
                          setOpenMenuPlacement(
                            availableBelow < 148 && availableAbove > availableBelow
                              ? "above"
                              : "below",
                          )
                        }
                        setOpenMenuId(chore.id)
                      }}
                      type="button"
                    >
                      <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
                    </button>
                  </div>
                  {openMenuId === chore.id && (
                    <div
                      className={`absolute right-4 top-12 z-10 w-36 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg ${cn(
                        designStyles.actionMenu,
                        openMenuPlacement === "above" && designStyles.actionMenuAbove,
                      )}`}
                    >
                      <button
                        className="w-full px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() => editChore(chore.id)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="w-full px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() =>
                          void runLifecycleAction(chore, chore.active ? "pause" : "activate")
                        }
                        disabled={busyChoreId === `${household?.id}:${chore.id}`}
                        type="button"
                      >
                        {busyChoreId === `${household?.id}:${chore.id}`
                          ? chore.active
                            ? "Pausing…"
                            : "Activating…"
                          : chore.active
                            ? "Pause"
                            : "Activate"}
                      </button>
                      <button
                        className="w-full px-3 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50"
                        onClick={() => {
                          setArchiveChore(chore)
                          setOpenMenuId(null)
                        }}
                        type="button"
                      >
                        Archive
                      </button>
                    </div>
                  )}
                </article>
              )
            })}
        </div>
      </div>

      {archiveChore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section
            aria-labelledby="archive-chore-title"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            role="dialog"
            ref={archiveDialogRef}
            tabIndex={-1}
          >
            <h2 className="font-display text-lg font-black text-slate-900" id="archive-chore-title">
              Archive chore?
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              “{archiveChore.title}” will leave the active list. Its history will be preserved.
            </p>
            <div className="mt-5 flex gap-2">
              <Button
                className="flex-1 rounded-xl"
                onClick={() => setArchiveChore(null)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                className="flex-1 rounded-xl bg-rose-600 text-white hover:bg-rose-700"
                onClick={() => void runLifecycleAction(archiveChore, "archive")}
                disabled={busyChoreId === `${household?.id}:${archiveChore.id}`}
                type="button"
              >
                {busyChoreId === `${household?.id}:${archiveChore.id}` ? "Archiving…" : "Archive"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
