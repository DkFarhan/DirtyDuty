import { useEffect, useRef, useState } from "react"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { HouseholdMemberDTO } from "@/lib/household/api"
import { Avatar, ProgressBar } from "./primitives"

export const MEMBER_COLORS = ["bg-teal-500", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-sky-500"]

export type MemberAction = "promote" | "demote" | "remove" | "transfer"

export function memberColor(index: number) {
  return MEMBER_COLORS[index % MEMBER_COLORS.length]
}

export function getMemberActionOptions({ member, currentUserRole, isCurrentUser }: {
  member: HouseholdMemberDTO
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER"
  isCurrentUser: boolean
}) {
  const actions: { label: string; action: MemberAction }[] = []
  const isOwner = currentUserRole === "OWNER"
  const isAdmin = currentUserRole === "ADMIN"

  if (isOwner && !isCurrentUser) {
    if (member.role === "MEMBER") {
      actions.push({ label: "Promote to admin", action: "promote" })
      actions.push({ label: "Transfer ownership", action: "transfer" })
      actions.push({ label: "Remove from household", action: "remove" })
    }
    if (member.role === "ADMIN") {
      actions.push({ label: "Demote to member", action: "demote" })
      actions.push({ label: "Transfer ownership", action: "transfer" })
      actions.push({ label: "Remove from household", action: "remove" })
    }
  }

  if (isAdmin && !isCurrentUser && member.role === "MEMBER") {
    actions.push({ label: "Remove from household", action: "remove" })
  }

  return actions
}

export function getMemberActionCopy(action: MemberAction, member: HouseholdMemberDTO, householdName: string) {
  switch (action) {
    case "promote":
      return {
        title: `Promote ${member.displayName} to admin?`,
        description: `${member.displayName} will be able to manage household members and chores.`,
      }
    case "demote":
      return {
        title: `Remove admin access from ${member.displayName}?`,
        description: `${member.displayName} will lose admin access.`,
      }
    case "remove":
      return {
        title: `Remove ${member.displayName} from ${householdName}?`,
        description: `${member.displayName} will lose access to future chores and assignments. Their history will remain.`,
      }
    case "transfer":
      return {
        title: `Transfer ownership to ${member.displayName}?`,
        description: `${member.displayName} will become the new owner. This is permanent and requires confirmation.`,
      }
    default:
      return null
  }
}

export function MemberActionDialog({
  householdName,
  pendingMemberAction,
  confirmText,
  memberActionError,
  busyMemberId,
  onCancel,
  onChangeConfirmText,
  onConfirm,
}: {
  householdName: string
  pendingMemberAction: { action: MemberAction; member: HouseholdMemberDTO } | null
  confirmText: string
  memberActionError: string | null
  busyMemberId: string | null
  onCancel: () => void
  onChangeConfirmText: (value: string) => void
  onConfirm: () => void
}) {
  if (!pendingMemberAction) return null

  const copy = getMemberActionCopy(pendingMemberAction.action, pendingMemberAction.member, householdName)
  if (!copy) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <section aria-labelledby="member-action-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" role="dialog">
        <h2 className="font-display text-lg font-black text-slate-900" id="member-action-title">{copy.title}</h2>
        <p className="mt-2 text-sm text-slate-500">{copy.description}</p>

        {pendingMemberAction.action === "transfer" && (
          <label className="mt-4 block text-sm font-medium text-slate-600">
            Type “{householdName}” or “{pendingMemberAction.member.displayName}” to confirm
            <input
              autoFocus
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-teal-400 focus:bg-white"
              onChange={(event) => onChangeConfirmText(event.target.value)}
              placeholder={householdName}
              type="text"
              value={confirmText}
            />
          </label>
        )}

        {memberActionError && <p role="alert" className="mt-3 text-sm text-rose-600">{memberActionError}</p>}

        <div className="mt-5 flex gap-2">
          <Button className="flex-1 rounded-xl" onClick={onCancel} type="button" variant="outline">Cancel</Button>
          <Button
            className="flex-1 rounded-xl bg-teal-600 text-white hover:bg-teal-700"
            disabled={busyMemberId === pendingMemberAction.member.userId}
            onClick={onConfirm}
            type="button"
          >
            {busyMemberId === pendingMemberAction.member.userId ? "Working..." : "Confirm"}
          </Button>
        </div>
      </section>
    </div>
  )
}

function formatJoinedAt(joinedAt: string) {
  const date = new Date(joinedAt)
  return Number.isNaN(date.getTime()) ? "Join date unavailable" : `Member since ${new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(date)}`
}

export function MemberCard({
  member,
  colorClass,
  isCurrentUser,
  currentUserRole = "MEMBER",
  onAction,
}: {
  member: HouseholdMemberDTO
  colorClass: string
  isCurrentUser: boolean
  currentUserRole?: "OWNER" | "ADMIN" | "MEMBER"
  onAction?: (action: MemberAction, member: HouseholdMemberDTO) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }

    window.addEventListener("mousedown", handlePointerDown)
    return () => window.removeEventListener("mousedown", handlePointerDown)
  }, [menuOpen])

  const actions = getMemberActionOptions({ member, currentUserRole, isCurrentUser })
  const rate = member.assignedThisWeek > 0
    ? Math.round((member.completedThisWeek / member.assignedThisWeek) * 100)
    : 0

  return (
    <div className="relative bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
      <div className="flex items-start gap-3">
        <Avatar initial={member.displayName.slice(0, 1).toUpperCase()} colorClass={colorClass} className="w-12 h-12 text-lg shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-slate-900">{member.displayName}</p>
            <span className="text-[10px] bg-teal-100 text-teal-700 font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide">{member.role}</span>
            {isCurrentUser && <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide">You</span>}
          </div>
          <p className="text-slate-400 text-xs mt-0.5">{formatJoinedAt(member.joinedAt)}</p>
          <p className="text-slate-400 text-xs mt-0.5">{member.completedThisWeek}/{member.assignedThisWeek} chores done this week</p>
        </div>

        {actions.length > 0 && (
          <div className="relative" ref={menuRef}>
            <button
              aria-label={`Actions for ${member.displayName}`}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-11 z-10 w-52 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
                {actions.map((item) => (
                  <button
                    key={item.action}
                    className={item.action === "remove" ? "w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50" : "w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"}
                    onClick={() => {
                      setMenuOpen(false)
                      onAction?.(item.action, member)
                    }}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-3">
        <ProgressBar value={rate} barClass={colorClass} />
        <p className="text-right text-[10px] text-slate-400 mt-1">{rate}% this week</p>
      </div>
    </div>
  )
}
