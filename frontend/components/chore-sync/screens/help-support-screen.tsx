"use client"

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { faqCategories, type FaqCategory } from "../help-support-faq"
import {
  createMailtoHref,
  formatFeedbackMessage,
  formatProblemMessage,
  getSafeDiagnostics,
  getSupportEmail,
  type FeedbackReport,
  type ProblemReport,
  type SafeDiagnostics,
} from "../support-message"
import type { Theme } from "@/components/theme/theme-provider"
import { ProfileDestinationHeader, ProfileDestinationView } from "./profile-screen-view"
import profileStyles from "./profile-screen-view.module.css"

type CopyStatus = {
  form: "problem" | "feedback"
  message: string
}

const initialProblem: ProblemReport = {
  summary: "",
  details: "",
  attemptedAction: "",
}

const initialFeedback: FeedbackReport = {
  type: "General feedback",
  message: "",
  improvement: "",
}

function filterFaqCategories(categories: FaqCategory[], query: string): FaqCategory[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return categories

  return categories
    .map((category) => ({
      ...category,
      items: category.items.filter(({ question, answer }) =>
        `${question} ${answer}`.toLowerCase().includes(normalizedQuery),
      ),
    }))
    .filter((category) => category.items.length > 0)
}

function FormField({
  id,
  label,
  required = false,
  children,
}: {
  id: string
  label: string
  required?: boolean
  children: (props: { id: string; required: boolean }) => ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-rose-600">
            *
          </span>
        )}
      </label>
      {children({ id, required })}
    </div>
  )
}

function MessagePreview({ children }: { children: string }) {
  return (
    <details className={profileStyles.helpMessagePreview}>
      <summary className={profileStyles.helpMessagePreviewSummary}>Preview message</summary>
      <pre className={profileStyles.helpMessagePreviewBody}>{children}</pre>
    </details>
  )
}

export function HelpSupportScreen({ theme = "light" }: { theme?: Exclude<Theme, "system"> }) {
  const { navigate } = useChoreSync()
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null)
  const [expandedFaqId, setExpandedFaqId] = useState<string | null>(null)
  const [problem, setProblem] = useState(initialProblem)
  const [feedback, setFeedback] = useState(initialFeedback)
  const [diagnostics, setDiagnostics] = useState<SafeDiagnostics | null>(null)
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null)

  useEffect(() => {
    setDiagnostics(getSafeDiagnostics())
  }, [])

  const supportEmail = getSupportEmail()
  const filteredCategories = useMemo(
    () => filterFaqCategories(faqCategories, searchQuery),
    [searchQuery],
  )
  const isSearching = searchQuery.trim().length > 0
  const problemMessage = diagnostics ? formatProblemMessage(problem, diagnostics) : ""
  const feedbackMessage = formatFeedbackMessage(feedback)
  const problemReady = Boolean(problem.summary.trim() && problem.details.trim() && diagnostics)
  const feedbackReady = Boolean(feedback.message.trim())
  const problemMailto = problemReady
    ? createMailtoHref(supportEmail, `DirtyDuty problem: ${problem.summary.trim()}`, problemMessage)
    : null
  const feedbackMailto = feedbackReady
    ? createMailtoHref(supportEmail, `DirtyDuty feedback: ${feedback.type}`, feedbackMessage)
    : null

  const copyMessage = async (form: CopyStatus["form"], message: string, ready: boolean) => {
    if (!ready) return
    try {
      await navigator.clipboard.writeText(message)
      setCopyStatus({ form, message: "Message copied. You can paste it into an email." })
    } catch {
      setCopyStatus({
        form,
        message: "Could not access the clipboard. Open the preview and copy the message manually.",
      })
    }
  }

  const preventFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
  }

  const onProblemChange = (next: ProblemReport) => {
    setProblem(next)
    setCopyStatus(null)
  }

  const onFeedbackChange = (next: FeedbackReport) => {
    setFeedback(next)
    setCopyStatus(null)
  }

  return (
    <ProfileDestinationView destination="help-support" theme={theme}>
      {
        <ProfileDestinationHeader
          eyebrow="HERE TO HELP"
          title="Help & support"
          back={() => navigate("profile")}
          theme={theme}
        />
      }
      <main className={profileStyles.helpMain}>
        <section className={profileStyles.helpHero}>
          {
            <>
              <div className={profileStyles.helpHeroRow}>
                <div className={profileStyles.helpHeroHeading}>
                  <p>DIRTYDUTY / HELP DESK</p>
                  <h2>
                    A little help goes
                    <br />a long way.
                  </h2>
                </div>
                <span aria-hidden="true" className={profileStyles.helpHeroIcon}>
                  <span className={profileStyles.helpHeroIconTile}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" src={`/profile-redesign/icons/help-mark-${theme}.svg`} />
                  </span>
                </span>
              </div>
              <p className={profileStyles.helpHeroDescription}>
                Find a quick answer, report a problem, or share an idea for making household chores
                easier.
              </p>
              <div aria-label="Help desk services" className={profileStyles.helpKeywords}>
                <span>QUICK ANSWERS</span>
                <span>PROBLEM REPORTS</span>
                <span>IDEAS</span>
              </div>
            </>
          }
        </section>

        <section aria-labelledby="faq-heading" className={profileStyles.helpSearchCard}>
          <div className={profileStyles.helpSearchBody}>
            {<p className={profileStyles.helpSectionEyebrow}>FIND YOUR ANSWER</p>}
            <h2 className={profileStyles.helpSectionTitle} id="faq-heading">
              Search help
            </h2>
            <p className={profileStyles.helpSearchDescription}>
              Browse quick answers about your household and chores.
            </p>
            <div className={profileStyles.helpSearchField}>
              <label className="sr-only" htmlFor="help-search">
                Search help articles
              </label>
              {
                <span aria-hidden="true" className={profileStyles.helpSearchGlyph}>
                  ⌕
                </span>
              }
              <input
                autoComplete="off"
                className={profileStyles.helpSearchInput}
                id="help-search"
                onChange={(event) => {
                  setSearchQuery(event.target.value)
                  setExpandedCategoryId(null)
                  setExpandedFaqId(null)
                }}
                placeholder="Search help..."
                type="search"
                value={searchQuery}
              />
            </div>
          </div>

          <div className={profileStyles.helpCategories}>
            {filteredCategories.length > 0 ? (
              filteredCategories.map((category) => (
                <section
                  aria-labelledby={`category-${category.id}`}
                  className={profileStyles.helpFaqCategory}
                  key={category.id}
                >
                  <h3 id={`category-${category.id}`}>
                    <button
                      aria-controls={`category-content-${category.id}`}
                      aria-expanded={isSearching || expandedCategoryId === category.id}
                      className={profileStyles.helpCategoryToggle}
                      onClick={() => {
                        if (isSearching) return
                        setExpandedCategoryId((current) =>
                          current === category.id ? null : category.id,
                        )
                        setExpandedFaqId(null)
                      }}
                      type="button"
                    >
                      <span>{category.title}</span>
                      <span className={profileStyles.helpCategoryCount}>
                        {category.items.length}
                      </span>
                      {
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          aria-hidden="true"
                          className={`${profileStyles.helpFaqChevron} ${isSearching || expandedCategoryId === category.id ? profileStyles.expanded : ""}`}
                          src={`/profile-redesign/icons/help-chevron-down-${theme}.svg`}
                        />
                      }
                    </button>
                  </h3>
                  <div
                    hidden={!isSearching && expandedCategoryId !== category.id}
                    id={`category-content-${category.id}`}
                  >
                    {category.items.map((item) => {
                      const isExpanded = expandedFaqId === item.id
                      const answerId = `answer-${item.id}`
                      return (
                        <article className={profileStyles.helpFaqQuestion} key={item.id}>
                          <h4>
                            <button
                              aria-controls={answerId}
                              aria-expanded={isExpanded}
                              className={profileStyles.helpQuestionToggle}
                              onClick={() =>
                                setExpandedFaqId((current) =>
                                  current === item.id ? null : item.id,
                                )
                              }
                              type="button"
                            >
                              <span>{item.question}</span>
                              {
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  aria-hidden="true"
                                  className={`${profileStyles.helpFaqChevron} ${isExpanded ? profileStyles.expanded : ""}`}
                                  src={`/profile-redesign/icons/help-chevron-down-${theme}.svg`}
                                />
                              }
                            </button>
                          </h4>
                          <div
                            className={profileStyles.helpFaqAnswer}
                            hidden={!isExpanded}
                            id={answerId}
                          >
                            {item.answer}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))
            ) : (
              <p className={profileStyles.helpNoResults}>No help articles match that search.</p>
            )}
          </div>
          {
            <p className={profileStyles.helpFaqHint}>
              Select a category or search questions and answers.
            </p>
          }
        </section>

        <section
          aria-labelledby="report-problem-heading"
          className={profileStyles.helpReportCard}
          id="report-problem"
        >
          {
            <>
              <div className={profileStyles.helpCardHeading}>
                <span aria-hidden="true" className={profileStyles.helpCardIconTile}>
                  !
                </span>
                <div className={profileStyles.helpCardTitleGroup}>
                  <p className={profileStyles.helpReportEyebrow}>SOMETHING NOT WORKING?</p>
                  <h2 id="report-problem-heading">Report a problem</h2>
                </div>
              </div>
              <p className={profileStyles.helpCardDescription}>
                We’ll prepare a message for you to send. DirtyDuty does not submit a support ticket.
              </p>
            </>
          }
          <form className={profileStyles.helpForm} onSubmit={preventFormSubmit}>
            <FormField id="problem-summary" label="Short summary" required>
              {({ id, required }) => (
                <input
                  className={profileStyles.helpTextControl}
                  id={id}
                  maxLength={120}
                  onChange={(event) => onProblemChange({ ...problem, summary: event.target.value })}
                  placeholder="For example, I can't mark a chore complete"
                  required={required}
                  value={problem.summary}
                />
              )}
            </FormField>
            <FormField id="problem-details" label="What happened?" required>
              {({ id, required }) => (
                <textarea
                  className={`${profileStyles.helpTextControl} ${profileStyles.helpTextArea}`}
                  id={id}
                  maxLength={3000}
                  onChange={(event) => onProblemChange({ ...problem, details: event.target.value })}
                  placeholder="Tell us what you saw..."
                  required={required}
                  value={problem.details}
                />
              )}
            </FormField>
            <FormField id="problem-action" label="What were you trying to do? (optional)">
              {({ id }) => (
                <textarea
                  className={`${profileStyles.helpTextControl} ${profileStyles.helpOptionalTextArea}`}
                  id={id}
                  maxLength={1500}
                  onChange={(event) =>
                    onProblemChange({ ...problem, attemptedAction: event.target.value })
                  }
                  placeholder="A little context can help us understand the problem."
                  value={problem.attemptedAction}
                />
              )}
            </FormField>
            <MessagePreview>{problemMessage}</MessagePreview>
            <div className={profileStyles.helpActions}>
              {problemMailto ? (
                <a
                  className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 dark:focus-visible:ring-teal-400 dark:focus-visible:ring-offset-slate-900 ${`${profileStyles.helpPrimaryAction} ${profileStyles.helpReportPrimaryAction}`}`}
                  href={problemMailto}
                >
                  Open email app
                </a>
              ) : (
                <button
                  className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${`${profileStyles.helpPrimaryAction} ${profileStyles.helpReportPrimaryAction}`}`}
                  disabled
                  type="button"
                >
                  Open email app
                </button>
              )}
              <button
                className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:ring-teal-400 dark:focus-visible:ring-offset-slate-900 ${profileStyles.helpSecondaryAction}`}
                disabled={!problemReady}
                onClick={() => void copyMessage("problem", problemMessage, problemReady)}
                type="button"
              >
                Copy message
              </button>
            </div>
            {
              <p className={profileStyles.helpFormNote}>
                Actions enable after the required fields are filled. Nothing is sent automatically.
              </p>
            }
            {!supportEmail && (
              <p className="text-sm text-amber-800 dark:text-amber-300" role="status">
                Email support is not configured for this environment. You can still copy your
                message.
              </p>
            )}
            {copyStatus?.form === "problem" && (
              <p className="text-sm text-teal-800 dark:text-teal-300" role="status">
                {copyStatus.message}
              </p>
            )}
          </form>
        </section>

        <section
          aria-labelledby="send-feedback-heading"
          className={profileStyles.helpFeedbackCard}
          id="send-feedback"
        >
          {
            <>
              <div className={profileStyles.helpCardHeading}>
                <span aria-hidden="true" className={profileStyles.helpCardIconTile}>
                  ✦
                </span>
                <div className={profileStyles.helpCardTitleGroup}>
                  <p className={profileStyles.helpFeedbackEyebrow}>GOT AN IDEA?</p>
                  <h2 id="send-feedback-heading">Send feedback</h2>
                </div>
              </div>
              <p className={profileStyles.helpCardDescription}>
                Share what you think. Your message stays separate from problem reports.
              </p>
            </>
          }
          <form className={profileStyles.helpForm} onSubmit={preventFormSubmit}>
            <FormField id="feedback-type" label="Feedback type">
              {({ id }) => (
                <div className={profileStyles.helpSelectField}>
                  <select
                    className={profileStyles.helpSelectControl}
                    id={id}
                    onChange={(event) =>
                      onFeedbackChange({ ...feedback, type: event.target.value })
                    }
                    value={feedback.type}
                  >
                    <option>General feedback</option>
                    <option>Feature idea</option>
                    <option>Something I like</option>
                    <option>Other</option>
                  </select>
                  {
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      aria-hidden="true"
                      className={profileStyles.helpSelectChevron}
                      src={`/profile-redesign/icons/help-chevron-down-${theme}.svg`}
                    />
                  }
                </div>
              )}
            </FormField>
            <FormField id="feedback-message" label="Message" required>
              {({ id, required }) => (
                <textarea
                  className={`${profileStyles.helpTextControl} ${profileStyles.helpTextArea}`}
                  id={id}
                  maxLength={3000}
                  onChange={(event) =>
                    onFeedbackChange({ ...feedback, message: event.target.value })
                  }
                  placeholder="Tell us what you think..."
                  required={required}
                  value={feedback.message}
                />
              )}
            </FormField>
            <FormField
              id="feedback-improvement"
              label="What would make DirtyDuty better? (optional)"
            >
              {({ id }) => (
                <textarea
                  className={`${profileStyles.helpTextControl} ${profileStyles.helpOptionalTextArea}`}
                  id={id}
                  maxLength={1500}
                  onChange={(event) =>
                    onFeedbackChange({ ...feedback, improvement: event.target.value })
                  }
                  placeholder="Share an idea if you have one."
                  value={feedback.improvement}
                />
              )}
            </FormField>
            <MessagePreview>{feedbackMessage}</MessagePreview>
            <div className={profileStyles.helpActions}>
              {feedbackMailto ? (
                <a
                  className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-violet-700 px-4 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${`${profileStyles.helpPrimaryAction} ${profileStyles.helpFeedbackPrimaryAction}`}`}
                  href={feedbackMailto}
                >
                  Open email app
                </a>
              ) : (
                <button
                  className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${`${profileStyles.helpPrimaryAction} ${profileStyles.helpFeedbackPrimaryAction}`}`}
                  disabled
                  type="button"
                >
                  Open email app
                </button>
              )}
              <button
                className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900 ${profileStyles.helpSecondaryAction}`}
                disabled={!feedbackReady}
                onClick={() => void copyMessage("feedback", feedbackMessage, feedbackReady)}
                type="button"
              >
                Copy message
              </button>
            </div>
            {
              <p className={profileStyles.helpFormNote}>
                Your feedback opens in your email app. This page never submits your message.
              </p>
            }
            {!supportEmail && (
              <p className="text-sm text-amber-800 dark:text-amber-300" role="status">
                Email support is not configured for this environment. You can still copy your
                message.
              </p>
            )}
            {copyStatus?.form === "feedback" && (
              <p className="text-sm text-violet-800 dark:text-violet-300" role="status">
                {copyStatus.message}
              </p>
            )}
          </form>
        </section>

        <section className={profileStyles.helpStillCard}>
          {<p className={profileStyles.helpStillEyebrow}>PERSONAL SUPPORT</p>}
          <h2 className={profileStyles.helpStillTitle}>Still need help?</h2>
          <p className={profileStyles.helpStillDescription}>
            Report a problem or send feedback and we’ll prepare a message you can send to DirtyDuty
            support.
          </p>
          {supportEmail && <p className={profileStyles.helpStillEmail}>{supportEmail}</p>}
          <div className={profileStyles.helpStillActions}>
            <a
              className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-center text-sm font-bold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 dark:focus-visible:ring-teal-400 dark:focus-visible:ring-offset-slate-900 ${profileStyles.helpStillPrimary}`}
              href="#report-problem"
            >
              Report a problem
            </a>
            <a
              className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-teal-200 bg-white px-4 py-3 text-center text-sm font-bold text-teal-800 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 dark:border-teal-700 dark:bg-slate-800 dark:text-teal-300 dark:hover:bg-slate-700 dark:focus-visible:ring-teal-400 dark:focus-visible:ring-offset-slate-900 ${profileStyles.helpStillSecondary}`}
              href="#send-feedback"
            >
              Send feedback
            </a>
          </div>
        </section>
        {<p className={profileStyles.helpEndCaption}>DIRTYDUTY{"   ·   "}MADE FOR SHARED HOMES</p>}
      </main>
    </ProfileDestinationView>
  )
}
