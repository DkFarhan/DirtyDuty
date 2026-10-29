"use client"

import type { HomeNavigationDestination, HomeVisualTheme } from "./home-screen-view"
import styles from "./my-chores-screen-view.module.css"

export type MyChoresTab = "upcoming" | "completed"
export type MyChoresViewStatus = "loading" | "loaded" | "error"
export type MyChoreCategoryIcon = 1 | 2 | 3 | 4 | 5 | 6

export interface MyChoreUpcomingViewModel {
  id: string
  title: string
  category: string
  dateLabel: string
  durationLabel: string
  assignedTo: string
  categoryIcon: MyChoreCategoryIcon
  priority?: boolean
  overdue?: boolean
}

export interface MyChoreCompletedViewModel {
  id: string
  title: string
  category: string
  dateLabel: string
  durationLabel: string
  assignedTo: string
  completedBy: string
}

export interface MyChoresViewModel {
  status: MyChoresViewStatus
  errorMessage?: string
  refreshError?: string
  attentionChore: MyChoreUpcomingViewModel | null
  upcomingChores: MyChoreUpcomingViewModel[]
  completedChores: MyChoreCompletedViewModel[]
  completedHeading: string
  completingIds: string[]
}

export interface MyChoresScreenViewProps {
  theme: HomeVisualTheme
  tab: MyChoresTab
  viewModel: MyChoresViewModel
  activeDestination: HomeNavigationDestination
  onSelectTab: (tab: MyChoresTab) => void
  onCompleteChore: (choreId: string) => void
  onRetry: () => void
  onNavigate: (destination: HomeNavigationDestination) => void
}

const navigationItems: Array<{
  id: HomeNavigationDestination
  label: string
  iconClass: string
}> = [
  { id: "home", label: "Home", iconClass: styles.homeIcon },
  { id: "my-chores", label: "My Chores", iconClass: styles.choresIcon },
  { id: "household", label: "Household", iconClass: styles.householdIcon },
  { id: "profile", label: "Profile", iconClass: styles.profileIcon },
]

function Navigation({
  activeDestination,
  theme,
  onNavigate,
}: Pick<MyChoresScreenViewProps, "activeDestination" | "theme" | "onNavigate">) {
  return (
    <nav aria-label="Preview navigation" className={styles.navigation}>
      <div className={styles.navigationCapsule}>
        <div
          aria-hidden="true"
          className={styles.activeIsland}
          data-active-destination={activeDestination}
        />
        <div className={styles.navigationItems}>
          {navigationItems.map((item) => {
            const active = activeDestination === item.id
            return (
              <button
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={`${styles.navigationItem} ${active ? styles.activeNavigationItem : ""}`}
                key={item.id}
                onClick={() => onNavigate(item.id)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`${styles.navigationIcon} ${item.iconClass}`}
                  data-theme={theme}
                />
                <span className={styles.navigationLabel}>{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

function UpcomingCard({
  chore,
  index,
  theme,
  completing,
  onComplete,
}: {
  chore: MyChoreUpcomingViewModel
  index: number
  theme: HomeVisualTheme
  completing: boolean
  onComplete: (choreId: string) => void
}) {
  return (
    <article
      className={`${styles.upcomingCard} ${index % 2 === 1 ? styles.alternateUpcomingCard : ""}`}
      data-chore-id={chore.id}
    >
      <span className={styles.categoryGlass} />
      <span
        aria-hidden="true"
        className={`${styles.categoryGlyph} ${styles[`category${chore.categoryIcon}`]}`}
        data-theme={theme}
      />
      <h3 className={styles.upcomingTitle}>{chore.title}</h3>
      {chore.priority && <span aria-hidden="true" className={styles.priorityIndicator} />}
      <p className={styles.upcomingCategory}>{chore.category}</p>
      <p className={styles.upcomingDate}>{chore.dateLabel}</p>
      <span aria-hidden="true" className={styles.upcomingDivider} />
      <p className={styles.upcomingAssignees}>Assigned to {chore.assignedTo}</p>
      <p className={styles.upcomingDuration}>{chore.durationLabel}</p>
      <button
        aria-busy={completing}
        aria-label={`${completing ? "Completing" : "Complete"} ${chore.title}`}
        className={styles.inlineCompleteButton}
        disabled={completing}
        onClick={() => onComplete(chore.id)}
        type="button"
      >
        {!completing && <span aria-hidden="true" className={styles.listCheck} data-theme={theme} />}
        {completing ? "Completing..." : "Complete"}
      </button>
    </article>
  )
}

function AttentionCard({
  chore,
  theme,
  completing,
  onComplete,
}: {
  chore: MyChoreUpcomingViewModel
  theme: HomeVisualTheme
  completing: boolean
  onComplete: (choreId: string) => void
}) {
  return (
    <article className={styles.attentionCard} data-chore-id={chore.id}>
      <span className={styles.attentionAccent} />
      <span className={styles.overdueBadge}>OVERDUE</span>
      <span className={styles.attentionIconGlass} />
      <span aria-hidden="true" className={styles.attentionBath} data-theme={theme} />
      <h3>{chore.title}</h3>
      <p className={styles.attentionMeta}>
        {chore.category}
        <span aria-hidden="true"> · </span>
        {chore.dateLabel}
      </p>
      <span aria-hidden="true" className={styles.attentionClock} data-theme={theme} />
      <p className={styles.attentionDuration}>{chore.durationLabel}</p>
      <p className={styles.attentionAssignees}>Assigned to {chore.assignedTo}</p>
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
    </article>
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
    >
      <span className={styles.completedIconGlass} />
      <span aria-hidden="true" className={styles.completedSymbol} data-theme={theme} />
      <h3>{chore.title}</h3>
      <p className={styles.completedMeta}>
        {chore.category}
        <span aria-hidden="true"> · </span>
        {chore.dateLabel}
      </p>
      <p className={styles.completedDuration}>{chore.durationLabel}</p>
      <span aria-hidden="true" className={styles.completedDivider} />
      <p className={styles.completedAssignees}>Assigned to {chore.assignedTo}</p>
      <span className={styles.completedBy}>
        <span aria-hidden="true">✓</span> Completed by {chore.completedBy}
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
  onRetry,
  onNavigate,
}: MyChoresScreenViewProps) {
  const upcomingCount = viewModel.upcomingChores.length + (viewModel.attentionChore ? 1 : 0)
  const attentionCount = Number(viewModel.attentionChore !== null)
  const overdueCount = Number(viewModel.attentionChore?.overdue === true)
  const completedCount = viewModel.completedChores.length
  const hasLoaded = viewModel.status === "loaded"
  const displayedCount = tab === "upcoming" ? upcomingCount : completedCount

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

                {tab === "upcoming" && (
                  <>
                    {displayedCount === 0 ? (
                      <EmptyState tab="upcoming" />
                    ) : (
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
                    <EmptyState tab="completed" />
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
      <Navigation activeDestination={activeDestination} onNavigate={onNavigate} theme={theme} />
    </div>
  )
}
