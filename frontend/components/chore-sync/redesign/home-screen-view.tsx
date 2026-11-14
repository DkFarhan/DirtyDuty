"use client"

import type { CSSProperties } from "react"
import { OccurrenceMoreButton } from "../occurrence-action-sheet"
import { BottomNav } from "../bottom-nav"
import styles from "./home-screen-view.module.css"

export type HomeVisualTheme = "dark" | "light"
export type HomeNavigationDestination = "home" | "my-chores" | "household" | "profile"
export type HomeViewStatus = "loading" | "loaded" | "error"

export interface HomeChoreViewModel {
  id: string
  title: string
  category: string
  scheduledLabel: string
  durationLabel?: string
  assignedTo: string
  status?: "PENDING" | "COMPLETED" | "CANCELLED" | "SKIPPED"
  /** "Moved from Tue" when moved to another day. */
  movedFrom?: string | null
  /** The viewer may move, skip, undo or reassign this occurrence. */
  hasActions?: boolean
  completedBy?: string | null
  overdue?: boolean
  canComplete?: boolean
  completing?: boolean
}

export interface HomeUpcomingChoreViewModel {
  id: string
  title: string
  category: string
  timeLabel: string
  skipped?: boolean
  movedFrom?: string | null
  hasActions?: boolean
}

export interface HomeUpcomingGroupViewModel {
  dateLabel: string
  chores: HomeUpcomingChoreViewModel[]
}

export interface HomePushNoticeViewModel {
  heading: string
  message: string | null
  actionLabel: string
}

export interface HomeScreenViewModel {
  status: HomeViewStatus
  errorMessage?: string
  refreshError?: string
  actionError?: string
  notificationCountError?: string
  pushNotice?: HomePushNoticeViewModel | null
  displayName: string
  greeting: string
  dateLabel: string
  householdName: string
  notificationCount: number
  householdWeek: {
    completedCount: number
    totalCount: number
  }
  personalWeek: {
    title: string
    message: string
    completedCount: number
    assignedCount: number
    dueTodayCount: number
    overdueCount: number
  }
  attentionChore: HomeChoreViewModel | null
  additionalAttentionChores?: HomeChoreViewModel[]
  todayChores: HomeChoreViewModel[]
  upcomingDateLabel: string
  upcomingChores: HomeUpcomingChoreViewModel[]
  upcomingGroups?: HomeUpcomingGroupViewModel[]
}

export interface HomeScreenViewProps {
  theme: HomeVisualTheme
  viewModel: HomeScreenViewModel
  activeDestination: HomeNavigationDestination
  onCompleteChore: (choreId: string) => void
  /** Opens the move, skip and reassign sheet for one occurrence. */
  onOpenChoreActions?: (choreId: string) => void
  onRetry: () => void
  onRetryNotificationCount?: () => void
  onPushAction?: () => void
  onOpenNotifications: () => void
  onNavigate: (destination: HomeNavigationDestination) => void
}

function percentage(completedCount: number, totalCount: number) {
  if (totalCount <= 0) return 0
  return Math.round((completedCount / totalCount) * 100)
}

function paddedCount(value: number) {
  return String(Math.max(0, value)).padStart(2, "0")
}

function ChoreCard({
  chore,
  onComplete,
  onOpenActions,
  theme,
  attention = false,
  today = false,
}: {
  chore: HomeChoreViewModel
  onComplete: (choreId: string) => void
  onOpenActions?: (choreId: string) => void
  theme: HomeVisualTheme
  attention?: boolean
  today?: boolean
}) {
  const canComplete =
    chore.canComplete !== false &&
    chore.status !== "COMPLETED" &&
    chore.status !== "CANCELLED" &&
    chore.status !== "SKIPPED"
  const showActions = Boolean(chore.hasActions && onOpenActions)
  const cardClassName = [
    styles.attentionCard,
    today && styles.todayCard,
    today && chore.overdue && chore.status === "PENDING" && styles.todayOverdueCard,
    showActions && styles.cardWithActions,
    chore.status === "SKIPPED" && styles.skippedCard,
  ]
    .filter(Boolean)
    .join(" ")
  return (
    <article className={cardClassName} data-chore-id={chore.id} data-occurrence-card={chore.id}>
      {showActions && (
        <OccurrenceMoreButton
          className={styles.cardMoreButton}
          onClick={() => onOpenActions?.(chore.id)}
          theme={theme}
          title={chore.title}
        />
      )}
      {(chore.overdue || (attention && chore.status === undefined)) && (
        <span className={styles.overdueBadge}>OVERDUE</span>
      )}
      <h3 className={styles.choreTitle}>{chore.title}</h3>
      <p className={styles.choreMeta}>
        {chore.category}
        <span aria-hidden="true"> · </span>
        {chore.scheduledLabel}
        {chore.movedFrom && (
          <>
            <span aria-hidden="true"> · </span>
            <span className={styles.movedHint}>{chore.movedFrom}</span>
          </>
        )}
      </p>
      {chore.durationLabel && (
        <p className={styles.duration}>
          <span aria-hidden="true" className={styles.durationClock} />
          {chore.durationLabel}
        </p>
      )}
      <p className={styles.assignedTo}>Assigned to {chore.assignedTo}</p>
      {chore.status === "COMPLETED" && (
        <p className={styles.choreStatus}>
          Completed{chore.completedBy ? ` by ${chore.completedBy}` : ""}
        </p>
      )}
      {chore.status === "CANCELLED" && <p className={styles.choreStatus}>Cancelled</p>}
      {chore.status === "SKIPPED" && <p className={styles.choreStatus}>Skipped</p>}
      {canComplete && (
        <button
          aria-busy={chore.completing}
          className={styles.completeButton}
          disabled={chore.completing}
          onClick={() => onComplete(chore.id)}
          type="button"
        >
          {!chore.completing && <span aria-hidden="true" className={styles.completeIcon} />}
          {chore.completing ? "Completing..." : "Mark complete"}
        </button>
      )}
    </article>
  )
}

function SectionHeading({
  id,
  title,
  count,
  countLabel,
}: {
  id: string
  title: string
  count: number
  countLabel: string
}) {
  return (
    <div className={styles.sectionHeading}>
      <h2 id={id}>{title}</h2>
      <span className={styles.countBadge}>
        {count} {countLabel}
      </span>
    </div>
  )
}

export function HomeScreenView({
  theme,
  viewModel,
  activeDestination,
  onCompleteChore,
  onOpenChoreActions,
  onRetry,
  onRetryNotificationCount = onRetry,
  onPushAction = onRetry,
  onOpenNotifications,
  onNavigate,
}: HomeScreenViewProps) {
  const householdProgress = percentage(
    viewModel.householdWeek.completedCount,
    viewModel.householdWeek.totalCount,
  )
  const personalProgress = percentage(
    viewModel.personalWeek.completedCount,
    viewModel.personalWeek.assignedCount,
  )
  const ringStyle = {
    "--completion": `${householdProgress}%`,
  } as CSSProperties
  const attentionCount = viewModel.personalWeek.overdueCount
  const attentionChores = [
    ...(viewModel.attentionChore ? [viewModel.attentionChore] : []),
    ...(viewModel.additionalAttentionChores ?? []),
  ]
  const upcomingGroups =
    viewModel.upcomingGroups ??
    (viewModel.upcomingChores.length > 0
      ? [{ dateLabel: viewModel.upcomingDateLabel, chores: viewModel.upcomingChores }]
      : [])

  return (
    <div
      className={`${styles.screen} ${theme === "dark" ? styles.darkTheme : styles.lightTheme}`}
      data-preview-theme={theme}
    >
      <main
        aria-busy={viewModel.status === "loading"}
        className={styles.scrollContent}
        data-scroll-container
      >
        <span aria-hidden="true" className={styles.backgroundAtmosphereCyan} />
        <span aria-hidden="true" className={styles.backgroundAtmosphereTwilight} />
        <header className={styles.header}>
          <div className={styles.topBar}>
            <p className={styles.dateLabel}>{viewModel.dateLabel}</p>
            <div className={styles.headerActions}>
              <button
                aria-label={
                  viewModel.notificationCount > 0
                    ? `Notifications, ${viewModel.notificationCount} unread`
                    : "Notifications"
                }
                className={styles.notificationButton}
                onClick={onOpenNotifications}
                type="button"
              >
                <span aria-hidden="true" className={styles.notificationGlass} />
                <span aria-hidden="true" className={styles.bellIcon} />
                {viewModel.notificationCount > 0 && (
                  <span className={styles.notificationBadge}>
                    <span aria-hidden="true" className={styles.notificationBadgeArt} />
                    <span className={styles.notificationBadgeText}>
                      {viewModel.notificationCount > 99 ? "99+" : viewModel.notificationCount}
                    </span>
                  </span>
                )}
              </button>
              <span
                aria-label={`${viewModel.displayName} profile`}
                className={styles.avatar}
                role="img"
              >
                <span aria-hidden="true" className={styles.avatarGlass} />
                <span aria-hidden="true" className={styles.avatarRim} />
                <span aria-hidden="true" className={styles.avatarArt} />
                <span className={styles.avatarInitial}>
                  {viewModel.displayName.trim().slice(0, 1).toUpperCase()}
                </span>
              </span>
            </div>
          </div>
          <p className={styles.greeting}>{viewModel.greeting}</p>
          <h1 className={styles.displayName}>{viewModel.displayName}.</h1>
          <p className={styles.householdName}>
            <span aria-hidden="true" className={styles.householdGlyph} />
            <span>{viewModel.householdName}</span>
          </p>
        </header>

        {viewModel.pushNotice && (
          <section
            aria-label="Push notification status"
            aria-live="polite"
            className={styles.pushNotice}
          >
            <div>
              <h2>{viewModel.pushNotice.heading}</h2>
              {viewModel.pushNotice.message && <p>{viewModel.pushNotice.message}</p>}
            </div>
            <button onClick={onPushAction} type="button">
              {viewModel.pushNotice.actionLabel}
            </button>
          </section>
        )}

        {(viewModel.refreshError || viewModel.actionError || viewModel.notificationCountError) && (
          <section className={styles.feedbackNotices}>
            {viewModel.refreshError && (
              <div role="alert">
                <p>{viewModel.refreshError}</p>
                <button onClick={onRetry} type="button">
                  Retry
                </button>
              </div>
            )}
            {viewModel.actionError && <p role="alert">{viewModel.actionError}</p>}
            {viewModel.notificationCountError && (
              <div role="alert">
                <p>{viewModel.notificationCountError}</p>
                <button onClick={onRetryNotificationCount} type="button">
                  Retry
                </button>
              </div>
            )}
          </section>
        )}

        <section aria-label="Household weekly progress" className={styles.householdHero}>
          <span aria-hidden="true" className={styles.householdAmbient} />
          <p className={styles.heroEyebrow}>EVERYONE AT HOME&nbsp;&nbsp; / &nbsp;&nbsp;THIS WEEK</p>
          <div className={styles.heroMetric}>
            <span className={styles.heroValue}>{householdProgress}</span>
            <span className={styles.heroPercent}>%</span>
            <span
              aria-label={`${householdProgress}% complete`}
              className={styles.progressOrbit}
              role="img"
              style={ringStyle}
            >
              <span aria-hidden="true" className={styles.orbitTrack} />
              {householdProgress === 25 ? (
                <span aria-hidden="true" className={styles.orbitProgress25} />
              ) : (
                <span aria-hidden="true" className={styles.orbitProgress} />
              )}
              <span className={styles.orbitCenter}>
                <span aria-hidden="true" className={styles.orbitGlint} />
              </span>
            </span>
          </div>
          <p className={styles.householdCompletion}>
            {viewModel.householdWeek.completedCount} of {viewModel.householdWeek.totalCount} chores
            completed
          </p>
          <div aria-hidden="true" className={styles.heroDivider} />
          <p className={styles.heroFootnote}>Small steps. A home in sync.</p>
        </section>

        <section aria-labelledby="personal-week-title" className={styles.personalWeek}>
          <p className={styles.personalEyebrow}>YOUR WEEK</p>
          <h2 className={styles.personalTitle} id="personal-week-title">
            {viewModel.personalWeek.title}
          </h2>
          <p className={styles.personalMessage}>{viewModel.personalWeek.message}</p>
          {viewModel.personalWeek.assignedCount > 0 && (
            <>
              <div className={styles.personalProgressLabel}>
                <span>
                  {viewModel.personalWeek.completedCount} of {viewModel.personalWeek.assignedCount}{" "}
                  completed
                </span>
                <span>{personalProgress}%</span>
              </div>
              <div
                aria-label={`${personalProgress}% of assigned chores completed`}
                className={styles.personalProgressTrack}
                role="img"
              >
                <span style={{ width: `${personalProgress}%` }} />
              </div>
            </>
          )}
          <dl className={styles.personalStats}>
            <div>
              <dd>{paddedCount(viewModel.personalWeek.assignedCount)}</dd>
              <dt>Assigned</dt>
            </div>
            <div>
              <dd>{paddedCount(viewModel.personalWeek.completedCount)}</dd>
              <dt>Completed</dt>
            </div>
            <div>
              <dd>{paddedCount(viewModel.personalWeek.dueTodayCount)}</dd>
              <dt>Due today</dt>
            </div>
            <div>
              <dd className={viewModel.personalWeek.overdueCount > 0 ? styles.overdueValue : ""}>
                {paddedCount(viewModel.personalWeek.overdueCount)}
              </dd>
              <dt>Overdue</dt>
            </div>
          </dl>
        </section>

        {viewModel.status === "loading" && (
          <div aria-label="Loading home overview" className={styles.loadingState} role="status">
            <span />
            <span />
            <span />
          </div>
        )}

        {viewModel.status === "error" && (
          <div className={styles.errorState}>
            <p role="alert">{viewModel.errorMessage ?? "Unable to load your home overview."}</p>
            <button onClick={onRetry} type="button">
              Try again
            </button>
          </div>
        )}

        {viewModel.status === "loaded" && (
          <>
            {attentionChores.length > 0 && (
              <section aria-labelledby="attention-title" className={styles.attentionSection}>
                <SectionHeading
                  count={attentionCount}
                  countLabel="OVERDUE"
                  id="attention-title"
                  title="Needs attention"
                />
                <div className={styles.attentionList}>
                  {attentionChores.map((chore) => (
                    <ChoreCard
                      attention
                      chore={chore}
                      key={chore.id}
                      onComplete={onCompleteChore}
                      onOpenActions={onOpenChoreActions}
                      theme={theme}
                    />
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="today-title" className={styles.todaySection}>
              <div className={styles.listSectionHeading}>
                <h2 id="today-title">Today</h2>
                <span>{viewModel.todayChores.length} DUE TODAY</span>
              </div>
              {viewModel.todayChores.length === 0 ? (
                <div className={styles.todayEmpty}>
                  <span aria-hidden="true" className={styles.todayCheck}>
                    <span className={styles.todayCheckArt} />
                  </span>
                  <div>
                    <p>No chores due today.</p>
                    <span>Enjoy your free time.</span>
                  </div>
                </div>
              ) : (
                <div className={styles.todayList}>
                  {viewModel.todayChores.map((chore) => (
                    <ChoreCard
                      chore={chore}
                      key={chore.id}
                      onComplete={onCompleteChore}
                      onOpenActions={onOpenChoreActions}
                      theme={theme}
                      today
                    />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="up-next-title" className={styles.upcomingSection}>
              <SectionHeading
                count={viewModel.upcomingChores.filter((chore) => !chore.skipped).length}
                countLabel="UPCOMING"
                id="up-next-title"
                title="Up next"
              />
              {upcomingGroups.length === 0 ? (
                <p className={styles.upcomingEmpty}>Nothing else is coming up this week.</p>
              ) : (
                <div className={styles.upcomingGroups}>
                  {upcomingGroups.map((group) => (
                    <div className={styles.upcomingList} key={group.dateLabel}>
                      <p className={styles.upcomingDate}>{group.dateLabel}</p>
                      {group.chores.map((chore, index) => (
                        <article
                          className={`${styles.upcomingItem} ${chore.skipped ? styles.skippedItem : ""}`}
                          data-occurrence-card={chore.id}
                          key={chore.id}
                        >
                          <span aria-hidden="true" className={styles.timelineStop}>
                            <span className={styles.timelineStopCore} />
                          </span>
                          <div className={styles.upcomingCopy}>
                            <h3>{chore.title}</h3>
                            <p>
                              {chore.category}
                              {chore.skipped && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span className={styles.skippedLabel}>Skipped</span>
                                </>
                              )}
                              {chore.movedFrom && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span className={styles.movedHint}>{chore.movedFrom}</span>
                                </>
                              )}
                            </p>
                          </div>
                          <time className={styles.upcomingTime}>{chore.timeLabel}</time>
                          {chore.hasActions && onOpenChoreActions && (
                            <OccurrenceMoreButton
                              className={styles.upcomingMoreButton}
                              onClick={() => onOpenChoreActions(chore.id)}
                              theme={theme}
                              title={chore.title}
                            />
                          )}
                          {index < group.chores.length - 1 && (
                            <span aria-hidden="true" className={styles.timelineDivider} />
                          )}
                        </article>
                      ))}
                    </div>
                  ))}
                  <p className={styles.upcomingFootnote}>
                    That&apos;s what&apos;s coming up this week.
                  </p>
                </div>
              )}
            </section>
          </>
        )}
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
