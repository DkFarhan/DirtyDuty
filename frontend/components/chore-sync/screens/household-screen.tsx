"use client"

import { useCallback, useEffect, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { householdApi, type HouseholdMemberDTO } from "@/lib/household/api"
import { useHouseholds } from "@/lib/household/household-context"
import { BottomNav } from "../bottom-nav"
import { MemberCard, memberColor } from "../member-card"
import { ChevronRightIcon } from "../icons"
import { SectionHeader } from "../primitives"
import { InviteHousemateDialog } from "../invite-housemate-dialog"

const adminActions = [
  { icon: "➕", label: "Invite Member", sub: "Share an invite code", action: "invite" },
  { icon: "📋", label: "Manage Chores", sub: "Create, edit, assign chores", action: "chores" },
]

export function HouseholdScreen() {
  const { state, navigate } = useChoreSync()
  const { households } = useHouseholds()
  const household = households[0]
  const [inviteOpen, setInviteOpen] = useState(false)
  const [members, setMembers] = useState<HouseholdMemberDTO[]>([])
  const [memberStatus, setMemberStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [memberError, setMemberError] = useState<string | null>(null)
  const canManage = household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN"

  const setInviteDialogOpen = useCallback((open: boolean) => setInviteOpen(open), [])

  const loadMembers = useCallback(async () => {
    if (!household) {
      setMemberError("Your household could not be found.")
      setMemberStatus("error")
      return
    }
    setMemberStatus("loading")
    setMemberError(null)
    try {
      setMembers(await householdApi.members(household.id))
      setMemberStatus("loaded")
    } catch (cause) {
      setMemberError(cause instanceof ApiError ? cause.message : "Unable to load household members. Please try again.")
      setMemberStatus("error")
    }
  }, [household])

  useEffect(() => { void loadMembers() }, [loadMembers])

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 pb-20">
      <header className="bg-white px-5 pt-12 pb-5">
        <div>
          <p className="text-slate-500 text-sm font-medium">Your household</p>
          <h1 className="text-2xl font-black text-slate-900 font-display">{household?.name ?? "Your household"}</h1>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2.5 py-1 rounded-full">
          {memberStatus === "loaded" ? `${members.length} members` : "Members"}
          </span>
          {canManage && (
            <span className="text-xs bg-teal-100 text-teal-700 font-semibold px-2.5 py-1 rounded-full">
            You are {household.currentUserRole.toLowerCase()}
            </span>
          )}
        </div>
      </header>

      <div className="px-4 pt-4 flex flex-col gap-4">
        <section>
          <SectionHeader title="Members" />
          {memberStatus === "loading" && <div aria-label="Loading household members" className="space-y-3">{[0, 1].map((item) => <div className="h-28 animate-pulse rounded-2xl bg-white" key={item} />)}</div>}
          {memberStatus === "error" && (
            <div className="rounded-2xl border border-slate-100 bg-white p-5 text-center">
              <p role="alert" className="text-sm text-slate-600">{memberError}</p>
              <button className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700" onClick={() => void loadMembers()} type="button">Try again</button>
            </div>
          )}
          {memberStatus === "loaded" && members.length === 0 && <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400">No household members found.</div>}
          {memberStatus === "loaded" && (
            <div className="flex flex-col gap-3">
              {members.map((member, i) => <MemberCard key={member.userId} member={member} colorClass={memberColor(i)} isCurrentUser={member.userId === state.currentUser.id} />)}
            </div>
          )}
        </section>

        {canManage && (
          <section>
            <SectionHeader title="Admin Actions" />
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
              {adminActions.map((item) => (
                <button
                  key={item.action}
                  onClick={() => {
                    if (item.action === "invite") setInviteOpen(true)
                    if (item.action === "chores") navigate("admin", "chores")
                  }}
                  type="button"
                  className="w-full flex items-center gap-4 px-4 py-3.5 transition-colors border-b border-slate-50 last:border-0 hover:bg-slate-50"
                >
                  <span className="text-xl w-8 text-center">{item.icon}</span>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-slate-900 text-sm">{item.label}</p>
                    <p className="text-slate-400 text-xs">{item.sub}</p>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-slate-300" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {household && canManage && (
        <InviteHousemateDialog
          household={household}
          onOpenChange={setInviteDialogOpen}
          open={inviteOpen}
        />
      )}

      <BottomNav active="household" navigate={navigate} />
    </div>
  )
}
