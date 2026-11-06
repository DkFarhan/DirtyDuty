import type { HouseholdMemberDTO } from "@/lib/household/api"

export type MemberAction = "promote" | "demote" | "remove" | "transfer"

export function getMemberActionOptions({
  member,
  currentUserRole,
  isCurrentUser,
}: {
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

export function getMemberActionCopy(
  action: MemberAction,
  member: HouseholdMemberDTO,
  householdName: string,
) {
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
