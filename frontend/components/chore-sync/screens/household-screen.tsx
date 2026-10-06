"use client"

import { useCallback, useEffect, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { householdApi, type HouseholdMemberDTO } from "@/lib/household/api"
import { useHouseholds } from "@/lib/household/household-context"
import { BottomNav } from "../bottom-nav"
import { MemberActionDialog, MemberCard, memberColor, type MemberAction } from "../member-card"
import { ChevronRightIcon } from "../icons"
import { SectionHeader } from "../primitives"
import { InviteHousemateDialog } from "../invite-housemate-dialog"

const adminActions = [
  { icon: "➕", label: "Invite Member", sub: "Share an invite code", action: "invite" },
  { icon: "📋", label: "Manage Chores", sub: "Create, edit, assign chores", action: "chores" },
  { icon: "⚙️", label: "Household Settings", sub: "Edit household details", action: "settings" },
]

export function HouseholdScreen() {
  const { state, navigate } = useChoreSync()
  const { households, activeHousehold, refresh } = useHouseholds()
  const household = activeHousehold ?? households[0]
  const [inviteOpen, setInviteOpen] = useState(false)
  const [leaveFlow, setLeaveFlow] = useState<"closed" | "member-confirm" | "owner-select" | "owner-confirm">("closed")
  const [selectedNewOwnerId, setSelectedNewOwnerId] = useState("")
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [leaveBusy, setLeaveBusy] = useState(false)
  const [members, setMembers] = useState<HouseholdMemberDTO[]>([])
  const [memberStatus, setMemberStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [memberError, setMemberError] = useState<string | null>(null)
  const [pendingMemberAction, setPendingMemberAction] = useState<{ action: MemberAction; member: HouseholdMemberDTO } | null>(null)
  const [confirmText, setConfirmText] = useState("")
  const [memberActionError, setMemberActionError] = useState<string | null>(null)
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)
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

  const handleMemberAction = useCallback((action: MemberAction, member: HouseholdMemberDTO) => {
    if (!household) return
    setMemberActionError(null)
    setPendingMemberAction({ action, member })
    if (action !== "transfer") return
    setConfirmText("")
  }, [household])

  const commitMemberAction = useCallback(async () => {
    if (!household || !pendingMemberAction) return
    const { action, member } = pendingMemberAction
    setBusyMemberId(member.userId)
    setMemberActionError(null)

    try {
      if (action === "promote") {
        await householdApi.updateMemberRole(household.id, member.userId, "ADMIN")
      } else if (action === "demote") {
        await householdApi.updateMemberRole(household.id, member.userId, "MEMBER")
      } else if (action === "remove") {
        await householdApi.removeMember(household.id, member.userId)
      } else if (action === "transfer") {
        const expected = household.name.trim() === confirmText.trim() || member.displayName.trim() === confirmText.trim()
        if (!expected) {
          setMemberActionError("Type the household name or the member name to confirm transfer.")
          setBusyMemberId(null)
          return
        }
        await householdApi.transferOwnership(household.id, member.userId)
      }
      setPendingMemberAction(null)
      setConfirmText("")
      await loadMembers()
      if (action === "transfer") {
        await refresh()
      }
    } catch (cause) {
      setMemberActionError(cause instanceof ApiError ? cause.message : "Unable to update this household member. Please try again.")
    } finally {
      setBusyMemberId(null)
    }
  }, [confirmText, household, loadMembers, pendingMemberAction, refresh])

  const eligibleNewOwners = members.filter((member) =>
    member.userId !== state.currentUser.id && (member.role === "MEMBER" || member.role === "ADMIN"))

  const openLeaveFlow = () => {
    setLeaveError(null)
    setSelectedNewOwnerId("")
    if (household?.currentUserRole !== "OWNER") {
      setLeaveFlow("member-confirm")
      return
    }
    setLeaveFlow("owner-select")
  }

  const leaveHousehold = useCallback(async () => {
    if (!household || leaveBusy) return
    const newOwnerUserId = household.currentUserRole === "OWNER" ? selectedNewOwnerId : undefined
    if (household.currentUserRole === "OWNER" && !eligibleNewOwners.some((member) => member.userId === newOwnerUserId)) {
      setLeaveError("Select an active household member to become the new owner.")
      return
    }
    setLeaveBusy(true)
    setLeaveError(null)
    try {
      await householdApi.leave(household.id, newOwnerUserId)
      const remaining = await refresh()
      setLeaveFlow("closed")
      setSelectedNewOwnerId("")
      navigate(remaining.length ? "dashboard" : "welcome")
    } catch (cause) {
      setLeaveError(cause instanceof ApiError ? cause.message : "Unable to leave this household. Please try again.")
    } finally {
      setLeaveBusy(false)
    }
  }, [eligibleNewOwners, household, leaveBusy, navigate, refresh, selectedNewOwnerId])

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
              {members.map((member, i) => (
                <MemberCard
                  key={member.userId}
                  member={member}
                  colorClass={memberColor(i)}
                  isCurrentUser={member.userId === state.currentUser.id}
                  currentUserRole={(household?.currentUserRole ?? "MEMBER") as "OWNER" | "ADMIN" | "MEMBER"}
                  onAction={handleMemberAction}
                />
              ))}
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
                    if (item.action === "settings") navigate("household-settings")
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

        {household && (
          <section className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
            <h2 className="font-bold text-slate-900">Leave household</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {household.currentUserRole === "OWNER"
                ? "Transfer ownership before leaving. Your past activity stays in the household history."
                : "You will lose access to future chores and assignments, but your past activity stays in the household history."}
            </p>
            <button
              className="mt-3 w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-bold text-rose-700"
              onClick={openLeaveFlow}
              type="button"
            >
              Leave household
            </button>
            {leaveError && <p role="alert" className="mt-3 text-sm text-rose-600">{leaveError}</p>}
          </section>
        )}
      </div>

      {leaveFlow !== "closed" && household && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section aria-modal="true" aria-labelledby="leave-household-title" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" role="dialog">
            {leaveFlow === "member-confirm" && (
              <>
                <h2 className="font-display text-lg font-black text-slate-900" id="leave-household-title">Leave {household.name}?</h2>
                <p className="mt-2 text-sm text-slate-500">This removes your active membership from the household. You can rejoin later with a new invite if needed.</p>
                {leaveError && <p role="alert" className="mt-3 text-sm text-rose-600">{leaveError}</p>}
                <div className="mt-5 flex gap-2">
                  <button className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => { setLeaveFlow("closed"); setLeaveError(null) }} type="button">Cancel</button>
                  <button className="flex-1 rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60" disabled={leaveBusy} onClick={() => void leaveHousehold()} type="button">{leaveBusy ? "Leaving…" : "Confirm"}</button>
                </div>
              </>
            )}

            {leaveFlow === "owner-select" && memberStatus === "loading" && (
              <>
                <h2 className="font-display text-lg font-black text-slate-900" id="leave-household-title">Checking household members</h2>
                <p className="mt-2 text-sm text-slate-500">Loading active members who can take ownership…</p>
                <button className="mt-5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => setLeaveFlow("closed")} type="button">Cancel</button>
              </>
            )}

            {leaveFlow === "owner-select" && memberStatus === "error" && (
              <>
                <h2 className="font-display text-lg font-black text-slate-900" id="leave-household-title">Unable to load household members</h2>
                <p role="alert" className="mt-2 text-sm text-rose-600">{memberError}</p>
                <div className="mt-5 flex gap-2">
                  <button className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => setLeaveFlow("closed")} type="button">Cancel</button>
                  <button className="flex-1 rounded-xl bg-teal-600 px-3 py-2.5 text-sm font-bold text-white" onClick={() => void loadMembers()} type="button">Try again</button>
                </div>
              </>
            )}

            {leaveFlow === "owner-select" && memberStatus === "loaded" && eligibleNewOwners.length > 0 && (
              <>
                <h2 className="font-display text-lg font-black text-slate-900" id="leave-household-title">Transfer ownership before leaving</h2>
                <p className="mt-2 text-sm text-slate-500">Choose an active member or admin to become the owner. You will leave the household in the same action.</p>
                <div className="mt-4 space-y-2">
                  {eligibleNewOwners.map((member) => (
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-800" key={member.userId}>
                      <input
                        checked={selectedNewOwnerId === member.userId}
                        name="new-owner"
                        onChange={() => setSelectedNewOwnerId(member.userId)}
                        type="radio"
                        value={member.userId}
                      />
                      <span className="flex-1 font-semibold">{member.displayName}</span>
                      <span className="text-xs font-medium text-slate-500">{member.role}</span>
                    </label>
                  ))}
                </div>
                {leaveError && <p role="alert" className="mt-3 text-sm text-rose-600">{leaveError}</p>}
                <div className="mt-5 flex gap-2">
                  <button className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => { setLeaveFlow("closed"); setLeaveError(null) }} type="button">Cancel</button>
                  <button
                    className="flex-1 rounded-xl bg-teal-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-60"
                    disabled={!selectedNewOwnerId || leaveBusy}
                    onClick={() => { setLeaveError(null); setLeaveFlow("owner-confirm") }}
                    type="button"
                  >
                    Continue
                  </button>
                </div>
              </>
            )}

            {leaveFlow === "owner-confirm" && (
              <>
                <h2 className="font-display text-lg font-black text-slate-900" id="leave-household-title">
                  Transfer ownership to {eligibleNewOwners.find((member) => member.userId === selectedNewOwnerId)?.displayName} and leave {household.name}?
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {eligibleNewOwners.find((member) => member.userId === selectedNewOwnerId)?.displayName} becomes Owner, you leave the household, and rejoining later requires a new invite.
                </p>
                {leaveError && <p role="alert" className="mt-3 text-sm text-rose-600">{leaveError}</p>}
                <div className="mt-5 flex gap-2">
                  <button className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" disabled={leaveBusy} onClick={() => { setLeaveError(null); setLeaveFlow("owner-select") }} type="button">Back</button>
                  <button className="flex-1 rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60" disabled={leaveBusy} onClick={() => void leaveHousehold()} type="button">{leaveBusy ? "Leaving…" : "Transfer and leave"}</button>
                </div>
              </>
            )}

            {leaveFlow === "owner-select" && memberStatus === "loaded" && eligibleNewOwners.length === 0 && (
              <>
                <h2 className="font-display text-lg font-black text-slate-900" id="leave-household-title">You’re the only active member</h2>
                <p className="mt-2 text-sm text-slate-500">This household cannot be left without another owner. Invite someone to join, or delete the household instead.</p>
                <div className="mt-5 flex flex-col gap-2">
                  <button className="w-full rounded-xl bg-teal-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-teal-700" onClick={() => { setLeaveFlow("closed"); setInviteOpen(true) }} type="button">Invite Member</button>
                  <button className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => { setLeaveFlow("closed"); navigate("household-settings") }} type="button">Delete Household</button>
                  <button className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => setLeaveFlow("closed")} type="button">Cancel</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {household && canManage && (
        <InviteHousemateDialog
          household={household}
          onOpenChange={setInviteDialogOpen}
          open={inviteOpen}
        />
      )}

      <MemberActionDialog
        busyMemberId={busyMemberId}
        confirmText={confirmText}
        householdName={household?.name ?? "Household"}
        memberActionError={memberActionError}
        onCancel={() => { setPendingMemberAction(null); setConfirmText(""); setMemberActionError(null) }}
        onChangeConfirmText={setConfirmText}
        onConfirm={() => void commitMemberAction()}
        pendingMemberAction={pendingMemberAction}
      />

      <BottomNav active="household" navigate={navigate} />
    </div>
  )
}
