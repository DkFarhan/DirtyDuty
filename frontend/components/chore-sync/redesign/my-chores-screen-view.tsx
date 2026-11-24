"use client"

import type { CardRequestView } from "@/lib/household/requests"
import { AwayNote } from "../away-note"
import { WeekChip } from "../week-chip"
import { StartWithBasics } from "../start-with-basics"
import type { WeekChipView } from "@/lib/household/week-by-week"
import { CancelRequestButton, RequestNote, WaitingChip } from "../requests/request-card-status"
import type { ReactNode } from "react"
import type { HomeNavigationDestination, HomeVisualTheme } from "./home-screen-view"
import { BottomNav } from "../bottom-nav"
import type { HouseholdJobViewModel } from "@/lib/household/household-jobs"
import type { CardFeedbackView, CardSurface } from "@/lib/household/card-feedback"
import { CardFeedbackMessage } from "../card-feedback"
import { HouseholdJobCard } from "../household-job-card"
import { OccurrenceMoreButton } from "../occurrence-action-sheet"
import styles from "./my-chores-screen-view.module.css"

export type MyChoresTab = "upcoming" | "completed"
export type MyChoresViewStatus = "loading" | "loaded" | "error"
export type MyChoreCategoryIcon = 1 | 2 | 3 | 4 | 5 | 6

export interface MyChoreUpcomingViewModel {
  id: string
  title: string
  category: string
  dateLabel: string
  durationLabel?: string
  assignedTo: string
  categoryIcon: MyChoreCategoryIcon
  priority?: boolean
  overdue?: boolean
  status?: "PENDING" | "COMPLETED" | "CANCELLED" | "SKIPPED"
  canComplete?: boolean
  /** "Moved from Tue" when moved to another day. */
  movedFrom?: string | null
  /** "Sam is away, so it skipped to you" (Away mode). */
  awayNote?: string | null
  /** Week by week: "Your week · until Sun, Dec 7". */
  weekChip?: WeekChipView | null
  /** Hand-off and swap requests: waiting chip, accepted note, Cancel request (E11). */
  request?: CardRequestView
  /** The viewer may move, skip, undo or reassign this occurrence. */
  hasActions?: boolean
  /** The result of the last action taken from this card, shown under it. */
  feedback?: CardFeedbackView
}

export interface MyChoreCompletedViewModel {
  id: string
  title: string
  category: string
  dateLabel: string
  durationLabel?: string
  assignedTo: string
  completedBy: string
  completing?: boolean
}

export interface MyChoresViewModel {
  status: MyChoresViewStatus
  errorMessage?: string
  refreshError?: string
  actionError?: string
  attentionCount?: number
  attentionChore: MyChoreUpcomingViewModel | null
  upcomingChores: MyChoreUpcomingViewModel[]
  completedChores: MyChoreCompletedViewModel[]
  completedHeading: string
  completingIds: string[]
  /** "When needed" chores the viewer is in the rotation for. */
  householdJobs?: HouseholdJobViewModel[]
  flaggingIds?: string[]
  /** A household with no chores yet: "Start with the basics" instead of the empty states. */
  basics?: { canManage: boolean; adding: boolean; error: string | null } | null
}

export interface MyChoresScreenViewProps {
  theme: HomeVisualTheme
  tab: MyChoresTab
  viewModel: MyChoresViewModel
  activeDestination: HomeNavigationDestination
  onSelectTab: (tab: MyChoresTab) => void
  onCompleteChore: (choreId: string, surface?: CardSurface) => void
  /** Opens the move, skip and reassign sheet for one occurrence. */
  onOpenChoreActions?: (choreId: string, surface?: CardSurface) => void
  /** "Needs doing" on a household job. */
  onFlagJob?: (choreId: string) => void
  onRetry: () => void
  onNavigate: (destination: HomeNavigationDestination) => void
  /** "Requests for you" (E11), at the top of the page when there are open requests. */
  requestsSection?: ReactNode
  /** Cancels the viewer's own open request from their card. */
  onCancelRequest?: (requestId: string, choreId: string) => void
  /** "Add these 4" on the Start with the basics card. */
  onAddBasics?: () => void
  /** "I'll make my own": Quick create. */
  onMakeOwnChore?: () => void
}

function UpcomingCard({
  chore,
  index,
  theme,
  completing,
  onComplete,
  onOpenActions,
  onCancelRequest,
}: {
  chore: MyChoreUpcomingViewModel
  index: number
  theme: HomeVisualTheme
  completing: boolean
  onComplete: (choreId: string) => void
  onOpenActions?: (choreId: string) => void
  onCancelRequest?: (requestId: string, choreId: string) => void
}) {
  const cancelRequestId = onCancelRequest ? (chore.request?.cancelRequestId ?? null) : null
  const withRequest = Boolean(chore.request)
  const canComplete =
    chore.canComplete !== false && chore.status !== "COMPLETED" && chore.status !== "CANCELLED"
  const showActions = Boolean(chore.hasActions && onOpenActions)
  return (
    <>
      <article
        className={`${styles.upcomingCard} ${index % 2 === 1 ? styles.alternateUpcomingCard : ""} ${showActions ? styles.upcomingCardWithActions : ""} ${withRequest ? styles.upcomingCardWithRequest : ""} ${cancelRequestId ? styles.upcomingCardWithCancel : ""}`}
        data-chore-id={chore.id}
        data-occurrence-card={chore.id}
        id={`assignment-${chore.id}`}
      >
        <span className={styles.categoryGlass} />
        <span
          aria-hidden="true"
          className={`${styles.categoryGlyph} ${styles[`category${chore.categoryIcon}`]}`}
          data-theme={theme}
        />
        {/* The title shrinks first, so it truncates before the status badge and the More button. */}
        <div className={styles.upcomingHeading}>
          <h3 className={styles.upcomingTitle}>{chore.title}</h3>
          {chore.overdue && <span className={styles.upcomingStatus}>Overdue</span>}
          {chore.status === "CANCELLED" && (
            <span className={`${styles.upcomingStatus} ${styles.cancelledStatus}`}>Cancelled</span>
          )}
          {chore.status === "COMPLETED" && (
            <span className={`${styles.upcomingStatus} ${styles.cancelledStatus}`}>Completed</span>
          )}
          {chore.priority &&
            !chore.overdue &&
            chore.status !== "CANCELLED" &&
            chore.status !== "COMPLETED" && (
              <span aria-hidden="true" className={styles.priorityIndicator} />
            )}
        </div>
        <p className={styles.upcomingCategory}>{chore.category}</p>
        <p className={styles.upcomingDate}>
          {chore.dateLabel}
          {chore.movedFrom && (
            <>
              <span aria-hidden="true"> · </span>
              <span className={styles.movedHint}>{chore.movedFrom}</span>
            </>
          )}
        </p>
        <AwayNote note={chore.awayNote} />
        <WeekChip chip={chore.weekChip} />
        {chore.request && (
          <div className={styles.upcomingRequest}>
            <RequestNote kind={chore.request.noteKind} label={chore.request.noteLabel} />
            <WaitingChip label={chore.request.waitingLabel} />
          </div>
        )}
        {showActions && (
          <OccurrenceMoreButton
            className={styles.upcomingMoreButton}
            onClick={() => onOpenActions?.(chore.id)}
            title={chore.title}
          />
        )}
        <span aria-hidden="true" className={styles.upcomingDivider} />
        <p className={styles.upcomingAssignees}>Assigned to {chore.assignedTo}</p>
        {chore.durationLabel && <p className={styles.upcomingDuration}>{chore.durationLabel}</p>}
        {canComplete && (
          <button
            aria-busy={completing}
            aria-label={`${completing ? "Completing" : "Complete"} ${chore.title}`}
            className={styles.inlineCompleteButton}
            disabled={completing}
            onClick={() => onComplete(chore.id)}
            type="button"
          >
            {!completing && (
              <span aria-hidden="true" className={styles.listCheck} data-theme={theme} />
            )}
            {completing ? "Completing..." : "Complete"}
          </button>
        )}
        {cancelRequestId && (
          <CancelRequestButton
            className={styles.upcomingCancelRequest}
            onCancel={() => onCancelRequest?.(cancelRequestId, chore.id)}
            title={chore.title}
          />
        )}
      </article>
      <CardFeedbackMessage
        className={styles.cardFeedback}
        feedback={chore.feedback}
        theme={theme}
      />
    </>
  )
}

function AttentionCard({
  chore,
  theme,
  completing,
  onComplete,
  onOpenActions,
  onCancelRequest,
}: {
  chore: MyChoreUpcomingViewModel
  theme: HomeVisualTheme
  completing: boolean
  onComplete: (choreId: string) => void
  onOpenActions?: (choreId: string) => void
  onCancelRequest?: (requestId: string, choreId: string) => void
}) {
  const showActions = Boolean(chore.hasActions && onOpenActions)
  const cancelRequestId = onCancelRequest ? (chore.request?.cancelRequestId ?? null) : null
  return (
    <>
      <article
        className={`${styles.attentionCard} ${showActions ? styles.attentionCardWithActions : ""} ${chore.request ? styles.attentionCardWithRequest : ""} ${cancelRequestId ? styles.attentionCardWithCancel : ""}`}
        data-chore-id={chore.id}
        data-occurrence-card={chore.id}
        id={`assignment-${chore.id}`}
      >
        <span className={styles.attentionAccent} />
        <span className={styles.overdueBadge}>OVERDUE</span>
        <span className={styles.attentionIconGlass} />
        <span aria-hidden="true" className={styles.attentionBath} data-theme={theme} />
        <h3>{chore.title}</h3>
        <p className={styles.attentionMeta}>
          {chore.category}
          <span aria-hidden="true"> · </span>
          {chore.dateLabel}
          {chore.movedFrom && (
            <>
              <span aria-hidden="true"> · </span>
              <span className={styles.movedHint}>{chore.movedFrom}</span>
            </>
          )}
        </p>
        <AwayNote note={chore.awayNote} />
        <WeekChip chip={chore.weekChip} />
        {chore.request && (
          <div className={styles.attentionRequest}>
            <RequestNote kind={chore.request.noteKind} label={chore.request.noteLabel} />
            <WaitingChip label={chore.request.waitingLabel} />
          </div>
        )}
        {cancelRequestId && (
          <CancelRequestButton
            className={styles.attentionCancelRequest}
            onCancel={() => onCancelRequest?.(cancelRequestId, chore.id)}
            title={chore.title}
          />
        )}
        {showActions && (
          <OccurrenceMoreButton
            className={styles.attentionMoreButton}
            onClick={() => onOpenActions?.(chore.id)}
            title={chore.title}
          />
        )}
        <span aria-hidden="true" className={styles.attentionClock} data-theme={theme} />
        {chore.durationLabel && <p className={styles.attentionDuration}>{chore.durationLabel}</p>}
        <p className={styles.attentionAssignees}>Assigned to {chore.assignedTo}</p>
        {chore.canComplete !== false &&
          chore.status !== "COMPLETED" &&
          chore.status !== "CANCELLED" && (
            <button
              aria-busy={completing}
              className={styles.attentionCompleteButton}
              disabled={completing}
              onClick={() => onComplete(chore.id)}
              type="button"
            >
              {!completing && (
                <span aria-hidden="true" className={styles.attentionCheck} data-theme={theme} />
              )}
              {completing ? "Completing..." : "Mark complete"}
            </button>
          )}
      </article>
      <CardFeedbackMessage
        className={styles.cardFeedback}
        feedback={chore.feedback}
        theme={theme}
      />
    </>
  )
}

function CompletedCard({
  chore,
  index,
  theme,
}: {
  chore: MyChoreCompletedViewModel
  index: number
  theme: HomeVisualTheme
}) {
  return (
    <article
      className={`${styles.completedCard} ${index % 2 === 1 ? styles.alternateCompletedCard : ""}`}
      data-chore-id={chore.id}
      id={`assignment-${chore.id}`}
    >
      <span className={styles.completedIconGlass} />
      <span aria-hidden="true" className={styles.completedSymbol} data-theme={theme} />
      <h3>{chore.title}</h3>
      <p className={styles.completedMeta}>
        {chore.category}
        <span aria-hidden="true"> · </span>
        {chore.dateLabel}
      </p>
      {chore.durationLabel && <p className={styles.completedDuration}>{chore.durationLabel}</p>}
      <span aria-hidden="true" className={styles.completedDivider} />
      <p className={styles.completedAssignees}>Assigned to {chore.assignedTo}</p>
      <span className={styles.completedBy}>
        {!chore.completing && <span aria-hidden="true">✓</span>}
        {chore.completing ? "Completing..." : `Completed by ${chore.completedBy}`}
      </span>
    </article>
  )
}

function EmptyState({ tab }: { tab: MyChoresTab }) {
  const completed = tab === "completed"
  return (
    <>
      <section
        aria-label={completed ? "No completed chores" : "No upcoming chores"}
        className={styles.emptyPanel}
      >
        <span aria-hidden="true" className={styles.emptyRoundel} data-state={tab} />
        <span aria-hidden="true" className={styles.emptyIcon} data-state={tab} />
        <h2>{completed ? "A fresh start." : "All caught up."}</h2>
        <p>
          {completed ? "Completed chores will appear here." : "No upcoming chores assigned to you."}
        </p>
      </section>
      <p className={styles.stateFootnote}>
        {completed
          ? "Your completed chore history begins here."
          : "No chores waiting. Enjoy the breathing room."}
      </p>
    </>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <>
      <section aria-label="Chore load failed" className={styles.errorPanel}>
        <span aria-hidden="true" className={styles.errorRoundel} />
        <span aria-hidden="true" className={styles.errorIcon} />
        <h2>We couldn&apos;t load your chores.</h2>
        <p role="alert">{message}</p>
        <button onClick={onRetry} type="button">
          Try again
        </button>
      </section>
      <p className={styles.stateFootnote}>The rest of DirtyDuty is still accessible.</p>
    </>
  )
}

function LoadingState() {
  return (
    <div aria-label="Loading my chores" className={styles.loadingState} role="status">
      <span />
      <span />
      <span />
    </div>
  )
}

export function MyChoresScreenView({
  theme,
  tab,
  viewModel,
  activeDestination,
  onSelectTab,
  onCompleteChore,
  onOpenChoreActions,
  onFlagJob,
  onRetry,
  onNavigate,
  requestsSection,
  onCancelRequest,
  onAddBasics,
  onMakeOwnChore,
}: MyChoresScreenViewProps) {
  const basics = viewModel.basics ? (
    <StartWithBasics
      adding={viewModel.basics.adding}
      canManage={viewModel.basics.canManage}
      error={viewModel.basics.error}
      onAdd={onAddBasics}
      onMakeOwn={onMakeOwnChore}
    />
  ) : null
  const jobs = viewModel.householdJobs ?? []
  const upcomingCount =
    viewModel.upcomingChores.length +
    (viewModel.attentionChore ? 1 : 0) +
    jobs.filter((job) => job.yourTurn).length
  const attentionCount = viewModel.attentionCount ?? Number(viewModel.attentionChore !== null)
  const overdueCount =
    viewModel.attentionCount ?? Number(viewModel.attentionChore?.overdue === true)
  const completedCount = viewModel.completedChores.length
  const hasLoaded = viewModel.status === "loaded"
  const scheduledCount = viewModel.upcomingChores.length + (viewModel.attentionChore ? 1 : 0)

  return (
    <div
      className={`${styles.screen} ${theme === "dark" ? styles.darkTheme : styles.lightTheme}`}
      data-preview-theme={theme}
      data-preview-tab={tab}
    >
      <main
        aria-busy={viewModel.status === "loading"}
        className={styles.scrollContent}
        data-scroll-container
      >
        <span aria-hidden="true" className={styles.headerPlane} />
        <span aria-hidden="true" className={styles.headerBloom} data-tab={tab} />
        <span aria-hidden="true" className={styles.headerFade} />
        <div className={styles.content}>
          <header className={styles.header}>
            <p className={styles.eyebrow}>YOUR ROUTINE&nbsp; / &nbsp;THE COMMON ROOM</p>
            <h1>My chores.</h1>
            <p className={styles.subtitle}>A little more room to breathe.</p>
            <div aria-label="Chore totals" className={styles.counters}>
              <div className={styles.upcomingCounter}>
                <span className={styles.upcomingNumber}>{hasLoaded ? upcomingCount : "—"}</span>
                <span className={styles.upcomingCounterLabel}>UPCOMING</span>
              </div>
              <span aria-hidden="true" className={styles.counterDivider} />
              <div className={styles.completedCounter}>
                <span className={styles.completedNumber}>{hasLoaded ? completedCount : "—"}</span>
                <span className={styles.completedCounterLabel}>DONE</span>
              </div>
            </div>
          </header>

          <div className={styles.requestsCard}>{requestsSection}</div>

          <div aria-label="Chore lists" className={styles.tabs} role="tablist">
            {(["upcoming", "completed"] as const).map((value) => (
              <button
                aria-selected={tab === value}
                className={`${styles.tab} ${tab === value ? styles.selectedTab : ""}`}
                id={`my-chores-tab-${value}`}
                key={value}
                onClick={() => onSelectTab(value)}
                role="tab"
                type="button"
              >
                {value === "upcoming" ? "Upcoming" : "Completed"}
              </button>
            ))}
          </div>

          <div
            aria-labelledby={`my-chores-tab-${tab}`}
            className={styles.tabPanel}
            id={`my-chores-panel-${tab}`}
            role="tabpanel"
          >
            {viewModel.status === "loading" && <LoadingState />}

            {viewModel.status === "error" && (
              <ErrorState
                message={
                  viewModel.errorMessage ??
                  "Your list is temporarily unavailable. Please try again."
                }
                onRetry={onRetry}
              />
            )}

            {viewModel.status === "loaded" && (
              <>
                {viewModel.refreshError && (
                  <div className={styles.refreshError}>
                    <p role="alert">{viewModel.refreshError}</p>
                    <button onClick={onRetry} type="button">
                      Retry
                    </button>
                  </div>
                )}
                {viewModel.actionError && (
                  <div className={styles.refreshError} role="alert">
                    <p>{viewModel.actionError}</p>
                  </div>
                )}

                {tab === "upcoming" && (
                  <>
                    {jobs.length > 0 && (
                      <section
                        aria-labelledby="household-jobs-title"
                        className={styles.jobsSection}
                      >
                        <div className={styles.upNextHeading}>
                          <h2 id="household-jobs-title">Household jobs</h2>
                          <span>{jobs.filter((job) => job.yourTurn).length} YOUR TURN</span>
                        </div>
                        <div className={styles.jobList}>
                          {jobs.map((job) => (
                            <HouseholdJobCard
                              completing={viewModel.completingIds.includes(job.id)}
                              flagging={(viewModel.flaggingIds ?? []).includes(job.id)}
                              job={job}
                              key={job.id}
                              onComplete={(id) => onCompleteChore(id, "job")}
                              onFlag={onFlagJob}
                              onOpenActions={
                                onOpenChoreActions && ((id) => onOpenChoreActions(id, "job"))
                              }
                              theme={theme}
                            />
                          ))}
                        </div>
                      </section>
                    )}
                    {scheduledCount === 0 && jobs.length === 0 ? (
                      (basics ?? <EmptyState tab="upcoming" />)
                    ) : scheduledCount === 0 ? null : (
                      <>
                        {viewModel.attentionChore && (
                          <section
                            aria-labelledby="needs-attention-title"
                            className={styles.attentionSection}
                          >
                            <div className={styles.attentionHeading}>
                              <h2 id="needs-attention-title">
                                {String(attentionCount).padStart(2, "0")}&nbsp; / &nbsp;NEEDS
                                ATTENTION
                              </h2>
                              <span>{overdueCount} OVERDUE</span>
                            </div>
                            <AttentionCard
                              chore={viewModel.attentionChore}
                              completing={viewModel.completingIds.includes(
                                viewModel.attentionChore.id,
                              )}
                              onComplete={onCompleteChore}
                              onCancelRequest={onCancelRequest}
                              onOpenActions={onOpenChoreActions}
                              theme={theme}
                            />
                          </section>
                        )}
                        <section aria-labelledby="up-next-title" className={styles.upNextSection}>
                          <div className={styles.upNextHeading}>
                            <h2 id="up-next-title">Up next</h2>
                            <span>{viewModel.upcomingChores.length} MORE ON YOUR LIST</span>
                          </div>
                          <div className={styles.upcomingList}>
                            {viewModel.upcomingChores.map((chore, index) => (
                              <UpcomingCard
                                chore={chore}
                                completing={viewModel.completingIds.includes(chore.id)}
                                index={index}
                                key={chore.id}
                                onComplete={onCompleteChore}
                                onCancelRequest={onCancelRequest}
                                onOpenActions={onOpenChoreActions}
                                theme={theme}
                              />
                            ))}
                          </div>
                          <p className={styles.upcomingFootnote}>
                            That&apos;s everything currently on your list.
                          </p>
                        </section>
                      </>
                    )}
                  </>
                )}

                {tab === "completed" &&
                  (completedCount === 0 ? (
                    (basics ?? <EmptyState tab="completed" />)
                  ) : (
                    <section
                      aria-labelledby="recent-wins-title"
                      className={styles.completedSection}
                    >
                      <p className={styles.completedEyebrow}>YOUR RECENT WINS</p>
                      <h2 id="recent-wins-title">{viewModel.completedHeading}</h2>
                      <div className={styles.completedList}>
                        {viewModel.completedChores.map((chore, index) => (
                          <CompletedCard chore={chore} index={index} key={chore.id} theme={theme} />
                        ))}
                      </div>
                      <div className={styles.completedFootnote}>
                        <span
                          aria-hidden="true"
                          className={styles.completedStar}
                          data-theme={theme}
                        />
                        <p>Small wins add up.</p>
                      </div>
                    </section>
                  ))}
              </>
            )}
          </div>
        </div>
      </main>
      <BottomNav
        active={activeDestination === "home" ? "dashboard" : activeDestination}
        ariaLabel="Preview navigation"
        navigate={(destination) => onNavigate(destination === "dashboard" ? "home" : destination)}
        theme={theme}
      />
    </div>
  )
}
