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
import { SubpageHeader } from "./subpage-header"
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

const fieldClassName =
  "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-600/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus-visible:border-teal-400 dark:focus-visible:ring-teal-400/30"

function MessagePreview({
  children,
  redesigned = false,
}: {
  children: string
  redesigned?: boolean
}) {
  return (
    <details
      className={
        redesigned
          ? profileStyles.helpMessagePreview
          : "rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-800"
      }
    >
      <summary
        className={
          redesigned
            ? profileStyles.helpMessagePreviewSummary
            : "cursor-pointer px-3.5 py-3 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 dark:text-slate-200 dark:focus-visible:ring-teal-400"
        }
      >
        Preview message
      </summary>
      <pre
        className={
          redesigned
            ? profileStyles.helpMessagePreviewBody
            : "max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 px-3.5 py-3 font-sans text-xs leading-relaxed text-slate-600 dark:border-slate-600 dark:text-slate-300"
        }
      >
        {children}
      </pre>
    </details>
  )
}

export function HelpSupportScreen({
  redesigned = false,
  theme = "light",
}: {
  redesigned?: boolean
  theme?: Exclude<Theme, "system">
}) {
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
    <ProfileDestinationView
      destination="help-support"
      legacyClassName="min-h-screen bg-slate-50 pb-8"
      redesigned={redesigned}
      theme={theme}
    >
      {redesigned ? (
        <ProfileDestinationHeader
          eyebrow="HERE TO HELP"
          title="Help & support"
          back={() => navigate("profile")}
          theme={theme}
        />
      ) : (
        <SubpageHeader title="Help & Support" back={() => navigate("profile")} />
      )}
      <main
        className={
          redesigned
            ? profileStyles.helpMain
            : "mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-8 pt-4 sm:px-6"
        }
      >
        <section
          className={
            redesigned
              ? profileStyles.helpHero
              : "overflow-hidden rounded-3xl bg-gradient-to-br from-teal-700 via-teal-600 to-cyan-600 p-5 text-white shadow-sm sm:p-7"
          }
        >
          {redesigned ? (
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
          ) : (
            <>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-100">
                DirtyDuty help desk
              </p>
              <h2 className="mt-2 font-display text-2xl font-black sm:text-3xl">
                A little help goes a long way.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-teal-50 sm:text-base">
                Find a quick answer, report a problem, or share an idea for making household chores
                easier.
              </p>
            </>
          )}
        </section>

        <section
          aria-labelledby="faq-heading"
          className={
            redesigned
              ? profileStyles.helpSearchCard
              : "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          }
        >
          <div className={redesigned ? profileStyles.helpSearchBody : "p-4 sm:p-5"}>
            {redesigned && <p className={profileStyles.helpSectionEyebrow}>FIND YOUR ANSWER</p>}
            <h2
              className={
                redesigned
                  ? profileStyles.helpSectionTitle
                  : "font-display text-lg font-black text-slate-900"
              }
              id="faq-heading"
            >
              Search help
            </h2>
            <p
              className={
                redesigned ? profileStyles.helpSearchDescription : "mt-1 text-sm text-slate-500"
              }
            >
              Browse quick answers about your household and chores.
            </p>
            <div className={redesigned ? profileStyles.helpSearchField : "mt-4"}>
              <label className="sr-only" htmlFor="help-search">
                Search help articles
              </label>
              {redesigned && (
                <span aria-hidden="true" className={profileStyles.helpSearchGlyph}>
                  ⌕
                </span>
              )}
              <input
                autoComplete="off"
                className={redesigned ? profileStyles.helpSearchInput : fieldClassName}
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

          <div className={redesigned ? profileStyles.helpCategories : undefined}>
            {filteredCategories.length > 0 ? (
              filteredCategories.map((category) => (
                <section
                  aria-labelledby={`category-${category.id}`}
                  className={redesigned ? profileStyles.helpFaqCategory : undefined}
                  key={category.id}
                >
                  <h3 id={`category-${category.id}`}>
                    <button
                      aria-controls={`category-content-${category.id}`}
                      aria-expanded={isSearching || expandedCategoryId === category.id}
                      className={
                        redesigned
                          ? profileStyles.helpCategoryToggle
                          : "flex min-h-12 w-full items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 sm:px-5 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:focus-visible:ring-teal-400"
                      }
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
                      <span
                        className={
                          redesigned
                            ? profileStyles.helpCategoryCount
                            : "ml-auto text-[11px] font-semibold normal-case tracking-normal text-slate-400"
                        }
                      >
                        {category.items.length}
                      </span>
                      {redesigned ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          aria-hidden="true"
                          className={`${profileStyles.helpFaqChevron} ${isSearching || expandedCategoryId === category.id ? profileStyles.expanded : ""}`}
                          src={`/profile-redesign/icons/help-chevron-down-${theme}.svg`}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className={`text-sm text-teal-700 transition-transform ${isSearching || expandedCategoryId === category.id ? "rotate-180" : ""}`}
                        >
                          ▾
                        </span>
                      )}
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
                        <article
                          className={
                            redesigned
                              ? profileStyles.helpFaqQuestion
                              : "border-t border-slate-100 first:border-t-0"
                          }
                          key={item.id}
                        >
                          <h4>
                            <button
                              aria-controls={answerId}
                              aria-expanded={isExpanded}
                              className={
                                redesigned
                                  ? profileStyles.helpQuestionToggle
                                  : "flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 sm:px-5 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:ring-teal-400"
                              }
                              onClick={() =>
                                setExpandedFaqId((current) =>
                                  current === item.id ? null : item.id,
                                )
                              }
                              type="button"
                            >
                              <span>{item.question}</span>
                              {redesigned ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  aria-hidden="true"
                                  className={`${profileStyles.helpFaqChevron} ${isExpanded ? profileStyles.expanded : ""}`}
                                  src={`/profile-redesign/icons/help-chevron-down-${theme}.svg`}
                                />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className={`shrink-0 text-lg leading-none text-teal-700 transition-transform ${isExpanded ? "rotate-45" : ""}`}
                                >
                                  +
                                </span>
                              )}
                            </button>
                          </h4>
                          <div
                            className={
                              redesigned
                                ? profileStyles.helpFaqAnswer
                                : "px-4 pb-4 pr-10 text-sm leading-relaxed text-slate-600 sm:px-5 sm:pr-14 dark:text-slate-300"
                            }
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
              <p
                className={
                  redesigned
                    ? profileStyles.helpNoResults
                    : "border-t border-slate-100 px-4 py-8 text-center text-sm text-slate-500 sm:px-5"
                }
              >
                No help articles match that search.
              </p>
            )}
          </div>
          {redesigned && (
            <p className={profileStyles.helpFaqHint}>
              Select a category or search questions and answers.
            </p>
          )}
        </section>

        <section
          aria-labelledby="report-problem-heading"
          className={
            redesigned
              ? profileStyles.helpReportCard
              : "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          }
          id="report-problem"
        >
          {redesigned ? (
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
          ) : (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-rose-600">
                Something not working?
              </p>
              <h2
                className="mt-1 font-display text-lg font-black text-slate-900"
                id="report-problem-heading"
              >
                Report a problem
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                We’ll prepare a message for you to send. DirtyDuty does not submit a support ticket.
              </p>
            </div>
          )}
          <form
            className={redesigned ? profileStyles.helpForm : "mt-4 flex flex-col gap-4"}
            onSubmit={preventFormSubmit}
          >
            <FormField id="problem-summary" label="Short summary" required>
              {({ id, required }) => (
                <input
                  className={redesigned ? profileStyles.helpTextControl : fieldClassName}
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
                  className={
                    redesigned
                      ? `${profileStyles.helpTextControl} ${profileStyles.helpTextArea}`
                      : `${fieldClassName} min-h-28 resize-y`
                  }
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
                  className={
                    redesigned
                      ? `${profileStyles.helpTextControl} ${profileStyles.helpOptionalTextArea}`
                      : `${fieldClassName} min-h-20 resize-y`
                  }
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
            {(redesigned || problemMessage) && (
              <MessagePreview redesigned={redesigned}>{problemMessage}</MessagePreview>
            )}
            <div
              className={redesigned ? profileStyles.helpActions : "flex flex-col gap-2 sm:flex-row"}
            >
              {problemMailto ? (
                <a
                  className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 dark:focus-visible:ring-teal-400 dark:focus-visible:ring-offset-slate-900 ${redesigned ? `${profileStyles.helpPrimaryAction} ${profileStyles.helpReportPrimaryAction}` : ""}`}
                  href={problemMailto}
                >
                  Open email app
                </a>
              ) : (
                <button
                  className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${redesigned ? `${profileStyles.helpPrimaryAction} ${profileStyles.helpReportPrimaryAction}` : ""}`}
                  disabled
                  type="button"
                >
                  Open email app
                </button>
              )}
              <button
                className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:ring-teal-400 dark:focus-visible:ring-offset-slate-900 ${redesigned ? profileStyles.helpSecondaryAction : ""}`}
                disabled={!problemReady}
                onClick={() => void copyMessage("problem", problemMessage, problemReady)}
                type="button"
              >
                Copy message
              </button>
            </div>
            {redesigned && (
              <p className={profileStyles.helpFormNote}>
                Actions enable after the required fields are filled. Nothing is sent automatically.
              </p>
            )}
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
          className={
            redesigned
              ? profileStyles.helpFeedbackCard
              : "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          }
          id="send-feedback"
        >
          {redesigned ? (
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
          ) : (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-violet-600">
                Got an idea?
              </p>
              <h2
                className="mt-1 font-display text-lg font-black text-slate-900"
                id="send-feedback-heading"
              >
                Send feedback
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                Share what you think. Your message stays separate from problem reports.
              </p>
            </div>
          )}
          <form
            className={redesigned ? profileStyles.helpForm : "mt-4 flex flex-col gap-4"}
            onSubmit={preventFormSubmit}
          >
            <FormField id="feedback-type" label="Feedback type">
              {({ id }) => (
                <div className={redesigned ? profileStyles.helpSelectField : undefined}>
                  <select
                    className={redesigned ? profileStyles.helpSelectControl : fieldClassName}
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
                  {redesigned && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      aria-hidden="true"
                      className={profileStyles.helpSelectChevron}
                      src={`/profile-redesign/icons/help-chevron-down-${theme}.svg`}
                    />
                  )}
                </div>
              )}
            </FormField>
            <FormField id="feedback-message" label="Message" required>
              {({ id, required }) => (
                <textarea
                  className={
                    redesigned
                      ? `${profileStyles.helpTextControl} ${profileStyles.helpTextArea}`
                      : `${fieldClassName} min-h-28 resize-y`
                  }
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
                  className={
                    redesigned
                      ? `${profileStyles.helpTextControl} ${profileStyles.helpOptionalTextArea}`
                      : `${fieldClassName} min-h-20 resize-y`
                  }
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
            {(redesigned || feedbackReady) && (
              <MessagePreview redesigned={redesigned}>{feedbackMessage}</MessagePreview>
            )}
            <div
              className={redesigned ? profileStyles.helpActions : "flex flex-col gap-2 sm:flex-row"}
            >
              {feedbackMailto ? (
                <a
                  className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-violet-700 px-4 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${redesigned ? `${profileStyles.helpPrimaryAction} ${profileStyles.helpFeedbackPrimaryAction}` : ""}`}
                  href={feedbackMailto}
                >
                  Open email app
                </a>
              ) : (
                <button
                  className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${redesigned ? `${profileStyles.helpPrimaryAction} ${profileStyles.helpFeedbackPrimaryAction}` : ""}`}
                  disabled
                  type="button"
                >
                  Open email app
                </button>
              )}
              <button
                className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900 ${redesigned ? profileStyles.helpSecondaryAction : ""}`}
                disabled={!feedbackReady}
                onClick={() => void copyMessage("feedback", feedbackMessage, feedbackReady)}
                type="button"
              >
                Copy message
              </button>
            </div>
            {redesigned && (
              <p className={profileStyles.helpFormNote}>
                Your feedback opens in your email app. This page never submits your message.
              </p>
            )}
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

        <section
          className={
            redesigned
              ? profileStyles.helpStillCard
              : "rounded-2xl border border-teal-100 bg-teal-50 p-4 sm:p-5 dark:border-teal-800 dark:bg-teal-950/40"
          }
        >
          {redesigned && <p className={profileStyles.helpStillEyebrow}>PERSONAL SUPPORT</p>}
          <h2
            className={
              redesigned
                ? profileStyles.helpStillTitle
                : "font-display text-lg font-black text-slate-900"
            }
          >
            Still need help?
          </h2>
          <p
            className={
              redesigned
                ? profileStyles.helpStillDescription
                : "mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300"
            }
          >
            Report a problem or send feedback and we’ll prepare a message you can send to DirtyDuty
            support.
          </p>
          {supportEmail && (
            <p
              className={
                redesigned
                  ? profileStyles.helpStillEmail
                  : "mt-2 break-all text-sm font-semibold text-teal-800 dark:text-teal-300"
              }
            >
              {supportEmail}
            </p>
          )}
          <div
            className={
              redesigned ? profileStyles.helpStillActions : "mt-4 flex flex-col gap-2 sm:flex-row"
            }
          >
            <a
              className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-center text-sm font-bold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 dark:focus-visible:ring-teal-400 dark:focus-visible:ring-offset-slate-900 ${redesigned ? profileStyles.helpStillPrimary : ""}`}
              href="#report-problem"
            >
              Report a problem
            </a>
            <a
              className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-teal-200 bg-white px-4 py-3 text-center text-sm font-bold text-teal-800 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 dark:border-teal-700 dark:bg-slate-800 dark:text-teal-300 dark:hover:bg-slate-700 dark:focus-visible:ring-teal-400 dark:focus-visible:ring-offset-slate-900 ${redesigned ? profileStyles.helpStillSecondary : ""}`}
              href="#send-feedback"
            >
              Send feedback
            </a>
          </div>
        </section>
        {redesigned && (
          <p className={profileStyles.helpEndCaption}>DIRTYDUTY{"   ·   "}MADE FOR SHARED HOMES</p>
        )}
      </main>
    </ProfileDestinationView>
  )
}
