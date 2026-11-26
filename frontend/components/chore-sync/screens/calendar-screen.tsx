"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import { householdChoreResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import { choreApi, type AssignmentDTO } from "@/lib/household/chores"
import {
  calendarApi,
  calendarTitle,
  householdToday,
  isCurrentRange,
  quickCreateDraft,
  rangeFor,
  rangeLabel,
  rememberedView,
  rememberView,
  stepAnchor,
  type CalendarDTO,
  type CalendarFilter,
  type CalendarView as View,
} from "@/lib/household/calendar"
import { useHouseholds } from "@/lib/household/household-context"
import { runOccurrenceAction } from "@/lib/household/occurrence-actions"
import { CalendarView, type CalendarStatus } from "../calendar/calendar-view"
import { OccurrenceActionSheet } from "../occurrence-action-sheet"
import {
  HouseholdLiveDesignHeader,
  type PreviewTheme,
} from "../redesign/household-secondary-design-preview"
import designStyles from "../redesign/household-secondary-design-preview.module.css"

/** The household calendar (6c), opened from My Chores: Week and Month, everyone's chores. */
export function CalendarScreen({ theme = "dark" }: { theme?: PreviewTheme }) {
  const { state, navigate, startChoreDraft } = useChoreSync()
  const { activeHousehold: household } = useHouseholds()
  const householdId = household?.id ?? null
  const timeZone = household?.timezone ?? "UTC"
  const today = householdToday(timeZone)
  const [view, setView] = useState<View>("week")
  const [anchor, setAnchor] = useState(today)
  const [selectedDay, setSelectedDay] = useState(today)
  const [filter, setFilter] = useState<CalendarFilter>("everyone")
  const [filterOpen, setFilterOpen] = useState(false)
  const [calendar, setCalendar] = useState<CalendarDTO | null>(null)
  const [status, setStatus] = useState<CalendarStatus>("loading")
  const [error, setError] = useState<string | null>(null)
  const [actionTarget, setActionTarget] = useState<AssignmentDTO | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { revision, invalidate } = useDataSync(
    householdId ? householdChoreResource(householdId) : "household:none:chores-and-assignments",
  )
  const sequence = useRef(0)

  // The last Week or Month choice on this device.
  useEffect(() => setView(rememberedView()), [])

  const { from, to } = rangeFor(view, anchor)
  const load = useCallback(async () => {
    if (!householdId) return
    const request = ++sequence.current
    setStatus("loading")
    try {
      const next = await calendarApi.get(householdId, from, to)
      if (request !== sequence.current) return
      setCalendar(next)
      setError(null)
      setStatus("loaded")
    } catch (cause) {
      if (request !== sequence.current) return
      setError(
        cause instanceof ApiError ? cause.message : "The calendar couldn't be loaded right now.",
      )
      setStatus("error")
    }
  }, [from, householdId, to])

  useEffect(() => {
    void load()
  }, [load, revision])

  // A filtered member who left the household falls back to everyone.
  useEffect(() => {
    if (filter !== "everyone" && calendar && !calendar.members.some((m) => m.userId === filter)) {
      setFilter("everyone")
    }
  }, [calendar, filter])

  const changeView = (next: View) => {
    setView(next)
    rememberView(next)
    if (next === "month") setSelectedDay(anchor.slice(0, 7) === today.slice(0, 7) ? today : anchor)
  }

  const step = (direction: -1 | 1) => {
    const next = stepAnchor(view, anchor, direction)
    setAnchor(next)
    if (view === "month") {
      setSelectedDay(next.slice(0, 7) === today.slice(0, 7) ? today : next)
    }
  }

  const openItem = async (id: string) => {
    if (!householdId) return
    setNotice(null)
    try {
      setActionTarget(await choreApi.occurrence(householdId, id))
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.message : "That chore couldn't be opened.")
    }
  }

  // Only the newest range's data is shown while another loads.
  const shown = calendar && calendar.from === from && calendar.to === to ? calendar : null

  return (
    <div
      className={`flex min-h-screen flex-col ${designStyles.liveRoot} ${designStyles[theme]}`}
      data-theme={theme}
    >
      <HouseholdLiveDesignHeader
        eyebrow="My Chores · Schedule"
        household={household?.name ?? "Your household"}
        onBack={() => navigate("my-chores")}
        title={calendarTitle(view, anchor, today)}
      />
      <main className={designStyles.liveContent} style={{ gap: 12, marginTop: 18 }}>
        {notice && (
          <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: 13 }}>
            {notice}
          </p>
        )}
        <CalendarView
          anchor={anchor}
          calendar={shown}
          error={error}
          filter={filter}
          filterOpen={filterOpen}
          onAdd={(date) => startChoreDraft(quickCreateDraft(date))}
          onCloseFilter={() => setFilterOpen(false)}
          onFilterChange={(next) => {
            setFilter(next)
            setFilterOpen(false)
          }}
          onNext={() => step(1)}
          onOpenFilter={() => setFilterOpen(true)}
          onOpenItem={(id) => void openItem(id)}
          onPrev={() => step(-1)}
          onRetry={() => void load()}
          onSelectDay={setSelectedDay}
          onToday={() => {
            setAnchor(today)
            setSelectedDay(today)
          }}
          onViewChange={changeView}
          rangeLabel={rangeLabel(view, anchor)}
          selectedDay={selectedDay}
          showToday={!isCurrentRange(view, anchor, today)}
          status={status}
          theme={theme}
          timeZone={timeZone}
          today={today}
          view={view}
        />
      </main>
      {household && actionTarget && (
        <OccurrenceActionSheet
          assignment={actionTarget}
          householdId={household.id}
          householdTimezone={household.timezone}
          onClose={() => setActionTarget(null)}
          onRequestSent={(_, message) => {
            setActionTarget(null)
            setNotice(message)
            invalidate()
          }}
          onSubmit={(action) => {
            const target = actionTarget.id
            setActionTarget(null)
            void runOccurrenceAction(household.id, target, action)
              .then(() => setNotice(null))
              .catch((cause: unknown) =>
                setNotice(
                  cause instanceof ApiError
                    ? cause.message
                    : "Unable to update this chore. Please try again.",
                ),
              )
              .finally(invalidate)
          }}
          theme={theme}
          viewerId={state.currentUser.id}
        />
      )}
    </div>
  )
}
