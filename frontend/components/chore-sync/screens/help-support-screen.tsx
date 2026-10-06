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
  "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus-visible:border-teal-600 focus-visible:ring-2 focus-visible:ring-teal-600/20"

function MessagePreview({ children }: { children: string }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50">
      <summary className="cursor-pointer px-3.5 py-3 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600">
        Preview message
      </summary>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 px-3.5 py-3 font-sans text-xs leading-relaxed text-slate-600">
        {children}
      </pre>
    </details>
  )
}

export function HelpSupportScreen() {
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
    <div className="min-h-screen bg-slate-50 pb-8">
      <SubpageHeader title="Help & Support" back={() => navigate("profile")} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-8 pt-4 sm:px-6">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-teal-700 via-teal-600 to-cyan-600 p-5 text-white shadow-sm sm:p-7">
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
        </section>

        <section
          aria-labelledby="faq-heading"
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="p-4 sm:p-5">
            <h2 className="font-display text-lg font-black text-slate-900" id="faq-heading">
              Search help
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Browse quick answers about your household and chores.
            </p>
            <div className="mt-4">
              <label className="sr-only" htmlFor="help-search">
                Search help articles
              </label>
              <input
                autoComplete="off"
                className={fieldClassName}
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

          <div>
            {filteredCategories.length > 0 ? (
              filteredCategories.map((category) => (
                <section aria-labelledby={`category-${category.id}`} key={category.id}>
                  <h3 id={`category-${category.id}`}>
                    <button
                      aria-controls={`category-content-${category.id}`}
                      aria-expanded={isSearching || expandedCategoryId === category.id}
                      className="flex min-h-12 w-full items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 sm:px-5"
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
                      <span className="ml-auto text-[11px] font-semibold normal-case tracking-normal text-slate-400">
                        {category.items.length}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`text-sm text-teal-700 transition-transform ${isSearching || expandedCategoryId === category.id ? "rotate-180" : ""}`}
                      >
                        ▾
                      </span>
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
                          className="border-t border-slate-100 first:border-t-0"
                          key={item.id}
                        >
                          <h4>
                            <button
                              aria-controls={answerId}
                              aria-expanded={isExpanded}
                              className="flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 sm:px-5"
                              onClick={() =>
                                setExpandedFaqId((current) =>
                                  current === item.id ? null : item.id,
                                )
                              }
                              type="button"
                            >
                              <span>{item.question}</span>
                              <span
                                aria-hidden="true"
                                className={`shrink-0 text-lg leading-none text-teal-700 transition-transform ${isExpanded ? "rotate-45" : ""}`}
                              >
                                +
                              </span>
                            </button>
                          </h4>
                          <div
                            className="px-4 pb-4 pr-10 text-sm leading-relaxed text-slate-600 sm:px-5 sm:pr-14"
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
              <p className="border-t border-slate-100 px-4 py-8 text-center text-sm text-slate-500 sm:px-5">
                No help articles match that search.
              </p>
            )}
          </div>
        </section>

        <section
          aria-labelledby="report-problem-heading"
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          id="report-problem"
        >
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
          <form className="mt-4 flex flex-col gap-4" onSubmit={preventFormSubmit}>
            <FormField id="problem-summary" label="Short summary" required>
              {({ id, required }) => (
                <input
                  className={fieldClassName}
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
                  className={`${fieldClassName} min-h-28 resize-y`}
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
                  className={`${fieldClassName} min-h-20 resize-y`}
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
            {problemMessage && <MessagePreview>{problemMessage}</MessagePreview>}
            <div className="flex flex-col gap-2 sm:flex-row">
              {problemMailto ? (
                <a
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
                  href={problemMailto}
                >
                  Open email app
                </a>
              ) : (
                <button
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled
                  type="button"
                >
                  Open email app
                </button>
              )}
              <button
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!problemReady}
                onClick={() => void copyMessage("problem", problemMessage, problemReady)}
                type="button"
              >
                Copy message
              </button>
            </div>
            {!supportEmail && (
              <p className="text-sm text-amber-800" role="status">
                Email support is not configured for this environment. You can still copy your
                message.
              </p>
            )}
            {copyStatus?.form === "problem" && (
              <p className="text-sm text-teal-800" role="status">
                {copyStatus.message}
              </p>
            )}
          </form>
        </section>

        <section
          aria-labelledby="send-feedback-heading"
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          id="send-feedback"
        >
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
          <form className="mt-4 flex flex-col gap-4" onSubmit={preventFormSubmit}>
            <FormField id="feedback-type" label="Feedback type">
              {({ id }) => (
                <select
                  className={fieldClassName}
                  id={id}
                  onChange={(event) => onFeedbackChange({ ...feedback, type: event.target.value })}
                  value={feedback.type}
                >
                  <option>General feedback</option>
                  <option>Feature idea</option>
                  <option>Something I like</option>
                  <option>Other</option>
                </select>
              )}
            </FormField>
            <FormField id="feedback-message" label="Message" required>
              {({ id, required }) => (
                <textarea
                  className={`${fieldClassName} min-h-28 resize-y`}
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
                  className={`${fieldClassName} min-h-20 resize-y`}
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
            {feedbackReady && <MessagePreview>{feedbackMessage}</MessagePreview>}
            <div className="flex flex-col gap-2 sm:flex-row">
              {feedbackMailto ? (
                <a
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-violet-700 px-4 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 focus-visible:ring-offset-2"
                  href={feedbackMailto}
                >
                  Open email app
                </a>
              ) : (
                <button
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled
                  type="button"
                >
                  Open email app
                </button>
              )}
              <button
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!feedbackReady}
                onClick={() => void copyMessage("feedback", feedbackMessage, feedbackReady)}
                type="button"
              >
                Copy message
              </button>
            </div>
            {!supportEmail && (
              <p className="text-sm text-amber-800" role="status">
                Email support is not configured for this environment. You can still copy your
                message.
              </p>
            )}
            {copyStatus?.form === "feedback" && (
              <p className="text-sm text-violet-800" role="status">
                {copyStatus.message}
              </p>
            )}
          </form>
        </section>

        <section className="rounded-2xl border border-teal-100 bg-teal-50 p-4 sm:p-5">
          <h2 className="font-display text-lg font-black text-slate-900">Still need help?</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Report a problem or send feedback and we’ll prepare a message you can send to DirtyDuty
            support.
          </p>
          {supportEmail && (
            <p className="mt-2 break-all text-sm font-semibold text-teal-800">{supportEmail}</p>
          )}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <a
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-700 px-4 py-3 text-center text-sm font-bold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
              href="#report-problem"
            >
              Report a problem
            </a>
            <a
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-teal-200 bg-white px-4 py-3 text-center text-sm font-bold text-teal-800 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
              href="#send-feedback"
            >
              Send feedback
            </a>
          </div>
        </section>
      </main>
    </div>
  )
}
