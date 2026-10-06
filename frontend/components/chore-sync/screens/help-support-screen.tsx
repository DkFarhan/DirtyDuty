"use client"

import { useMemo, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { SubpageHeader } from "./subpage-header"

const helpItems = [
  ["How do household chores work?", "Your household dashboard lists chores scheduled for today and this week. Use My Chores to see assignments and mark eligible chores complete."],
  ["How do I invite someone?", "Open Household and choose Invite Member in the admin actions. An owner or admin can create an invitation."],
  ["How do I change household details?", "An owner can open Household Settings from the Household admin actions to update the name or description."],
  ["What if I need to transfer ownership?", "Open the household members list, open the member menu, and choose Transfer ownership. The chosen member must already be an active household member."],
]

const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@dirtyduty.app"

export function HelpSupportScreen() {
  const { navigate } = useChoreSync()
  const [message, setMessage] = useState("")
  const [copied, setCopied] = useState(false)

  const supportHref = useMemo(() => {
    const subject = encodeURIComponent("DirtyDuty support request")
    const body = encodeURIComponent(
      `Hi DirtyDuty support,\n\nI need help with:\n${message || "Please describe the issue or question."}\n\nApp: DirtyDuty\n`,
    )
    return `mailto:${supportEmail}?subject=${subject}&body=${body}`
  }, [message])

  const copySupportAddress = async () => {
    try {
      await navigator.clipboard.writeText(supportEmail)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <SubpageHeader title="Help & Support" back={() => navigate("profile")} />
      <main className="flex flex-col gap-4 px-4 pt-4">
        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="px-4 pb-3 pt-4">
            <h2 className="font-bold text-slate-900">Frequently asked questions</h2>
            <p className="mt-1 text-xs text-slate-500">Quick answers for using DirtyDuty.</p>
          </div>
          {helpItems.map(([question, answer]) => (
            <details className="border-t border-slate-100 px-4 py-3" key={question}>
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">{question}</summary>
              <p className="pt-2 text-sm leading-relaxed text-slate-500">{answer}</p>
            </details>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <h2 className="font-bold text-slate-900">Contact support</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">Share a quick note and send it directly to the support address configured for this app.</p>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">
            What do you need help with?
            <textarea
              className="mt-1 min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:bg-white"
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Describe the issue or question..."
              value={message}
            />
          </label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <a
              className="flex-1 rounded-xl bg-teal-600 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-teal-700"
              href={supportHref}
            >
              Email support
            </a>
            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700"
              onClick={() => void copySupportAddress()}
              type="button"
            >
              {copied ? "Copied" : "Copy email"}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">Support email: {supportEmail}</p>
        </section>
      </main>
    </div>
  )
}
