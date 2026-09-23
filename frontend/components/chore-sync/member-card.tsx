import type { Member } from "@/lib/chore-sync/types"
import { Avatar, ProgressBar } from "./primitives"

/**
 * Stable palette indexed by member position. Kept here so any future member
 * list (e.g. the leaderboard) renders members in consistent colors.
 */
export const MEMBER_COLORS = ["bg-teal-500", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-sky-500"]

export function memberColor(index: number) {
  return MEMBER_COLORS[index % MEMBER_COLORS.length]
}

export function MemberCard({
  member,
  colorClass,
  done,
  total,
  rate,
  isCurrentUser,
}: {
  member: Member
  colorClass: string
  done: number
  total: number
  rate: number
  isCurrentUser: boolean
}) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
      <div className="flex items-center gap-3">
        <Avatar initial={member.avatar} colorClass={colorClass} className="w-12 h-12 text-lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-slate-900">{member.name}</p>
            {member.isAdmin && (
              <span className="text-[10px] bg-teal-100 text-teal-700 font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                Admin
              </span>
            )}
            {isCurrentUser && (
              <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                You
              </span>
            )}
          </div>
          <p className="text-slate-400 text-xs mt-0.5">
            {done}/{total} chores done this week
          </p>
        </div>
      </div>
      <div className="mt-3">
        <ProgressBar value={rate} barClass={colorClass} />
        <p className="text-right text-[10px] text-slate-400 mt-1">{rate}% this week</p>
      </div>
    </div>
  )
}
