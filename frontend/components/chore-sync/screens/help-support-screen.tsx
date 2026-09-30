"use client"

import { useChoreSync } from "@/lib/chore-sync/store"
import { SubpageHeader } from "./subpage-header"

const helpItems = [
  ["How do household chores work?", "Your household dashboard lists chores scheduled for today and this week. Use My Chores to see assignments and mark eligible chores complete."],
  ["How do I invite someone?", "Open Household and choose Invite Member in the admin actions. An owner or admin can create an invitation."],
  ["How do I change household details?", "An owner or admin can open Household Settings from the Household admin actions to update the name or description."],
]

export function HelpSupportScreen() {
  const { navigate } = useChoreSync()

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
          <p className="mt-1 text-sm leading-relaxed text-slate-500">In-app support requests are not available yet. The button is disabled so it won’t submit a request that cannot be delivered.</p>
          <button aria-describedby="support-note" className="mt-3 cursor-not-allowed rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-400" disabled type="button">Contact support · Coming soon</button>
          <p className="sr-only" id="support-note">Coming soon; support contact is not available yet.</p>
        </section>
      </main>
    </div>
  )
}
