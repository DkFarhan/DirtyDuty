"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { householdApi, type HouseholdMemberDTO } from "@/lib/household/api"
import { useHouseholds } from "@/lib/household/household-context"
import { type MemberAction } from "../member-card"
import { InviteHousemateDialog } from "../invite-housemate-dialog"
import { HouseholdScreenView, type HouseholdVisualTheme } from "../redesign/household-screen-view"
import { createHouseholdApplicationViewModel } from "../redesign/household-application-adapter"

export function HouseholdScreen({ theme = "light" }: { theme?: HouseholdVisualTheme }) {
  const { state, navigate, pendingAccountDeletionUserId, clearAccountDeletion } = useChoreSync()
  const { households, activeHousehold, refresh, removeHousehold } = useHouseholds()
  const household = activeHousehold ?? households[0]
  const [inviteOpen, setInviteOpen] = useState(false)
  const [leaveFlow, setLeaveFlow] = useState<
    "closed" | "member-confirm" | "owner-select" | "owner-confirm"
  >("closed")
  const [selectedNewOwnerId, setSelectedNewOwnerId] = useState("")
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [leaveBusy, setLeaveBusy] = useState(false)
  const leaveSubmissionInProgress = useRef(false)
  const [members, setMembers] = useState<HouseholdMemberDTO[]>([])
  const [memberStatus, setMemberStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [memberError, setMemberError] = useState<string | null>(null)
  const [memberErrorHouseholdId, setMemberErrorHouseholdId] = useState<string | null>(null)
  const [memberRefreshError, setMemberRefreshError] = useState<string | null>(null)
  const [membersHouseholdId, setMembersHouseholdId] = useState<string | null>(null)
  const membersHouseholdIdRef = useRef<string | null>(null)
  const memberRequestSequence = useRef(0)
  const [pendingMemberAction, setPendingMemberAction] = useState<{
    action: MemberAction
    member: HouseholdMemberDTO
  } | null>(null)
  const [openMemberMenuId, setOpenMemberMenuId] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState("")
  const [memberActionError, setMemberActionError] = useState<string | null>(null)
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)
  const canManage = household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN"

  const setInviteDialogOpen = useCallback((open: boolean) => setInviteOpen(open), [])

  const loadMembers = useCallback(async () => {
    if (!household) {
      memberRequestSequence.current += 1
      setMembers([])
      membersHouseholdIdRef.current = null
      setMembersHouseholdId(null)
      setMemberError("Your household could not be found.")
      setMemberErrorHouseholdId(null)
      setMemberStatus("error")
      return
    }
    const requestId = ++memberRequestSequence.current
    const hasCurrentData = membersHouseholdIdRef.current === household.id
    if (!hasCurrentData) setMemberStatus("loading")
    try {
      const result = await householdApi.members(household.id)
      if (requestId !== memberRequestSequence.current) return
      setMembers(result)
      membersHouseholdIdRef.current = household.id
      setMembersHouseholdId(household.id)
      setMemberStatus("loaded")
      setMemberError(null)
      setMemberErrorHouseholdId(null)
      setMemberRefreshError(null)
    } catch (cause) {
      if (requestId !== memberRequestSequence.current) return
      const message =
        cause instanceof ApiError
          ? cause.message
          : hasCurrentData
            ? "Unable to refresh household members. Please try again."
            : "Unable to load household members. Please try again."
      if (hasCurrentData) {
        setMemberRefreshError(message)
      } else {
        setMemberError(message)
        setMemberErrorHouseholdId(household.id)
        setMemberStatus("error")
      }
    }
  }, [household])

  const handleMemberAction = useCallback(
    (action: MemberAction, member: HouseholdMemberDTO) => {
      if (!household) return
      setOpenMemberMenuId(null)
      setMemberActionError(null)
      setPendingMemberAction({ action, member })
      if (action !== "transfer") return
      setConfirmText("")
    },
    [household],
  )

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
        const expected =
          household.name.trim() === confirmText.trim() ||
          member.displayName.trim() === confirmText.trim()
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
        if (pendingAccountDeletionUserId === state.currentUser.id) {
          navigate("privacy-security")
        } else {
          void refresh().catch(() => undefined)
        }
      }
    } catch (cause) {
      setMemberActionError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to update this household member. Please try again.",
      )
    } finally {
      setBusyMemberId(null)
    }
  }, [
    confirmText,
    household,
    loadMembers,
    navigate,
    pendingMemberAction,
    pendingAccountDeletionUserId,
    refresh,
    state.currentUser.id,
  ])

  const eligibleNewOwners = members.filter(
    (member) =>
      member.userId !== state.currentUser.id &&
      (member.role === "MEMBER" || member.role === "ADMIN"),
  )

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
    if (!household || leaveBusy || leaveSubmissionInProgress.current) return
    const isOwner = household.currentUserRole === "OWNER"
    if (
      (isOwner && leaveFlow !== "owner-confirm") ||
      (!isOwner && leaveFlow !== "member-confirm")
    ) {
      return
    }
    const newOwnerUserId = isOwner ? selectedNewOwnerId : undefined
    if (isOwner && !eligibleNewOwners.some((member) => member.userId === newOwnerUserId)) {
      setLeaveError("Select an active household member to become the new owner.")
      return
    }
    leaveSubmissionInProgress.current = true
    setLeaveBusy(true)
    setLeaveError(null)
    try {
      await householdApi.leave(household.id, newOwnerUserId)
      const remaining = removeHousehold(household.id)
      setLeaveFlow("closed")
      setSelectedNewOwnerId("")
      navigate(remaining.length ? "dashboard" : "welcome")
      void refresh().catch(() => undefined)
    } catch (cause) {
      setLeaveError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to leave this household. Please try again.",
      )
    } finally {
      leaveSubmissionInProgress.current = false
      setLeaveBusy(false)
    }
  }, [
    eligibleNewOwners,
    household,
    leaveFlow,
    leaveBusy,
    navigate,
    refresh,
    removeHousehold,
    selectedNewOwnerId,
  ])

  useEffect(() => {
    void loadMembers()
    return () => {
      memberRequestSequence.current += 1
    }
  }, [loadMembers])

  const visibleMemberStatus = !household
    ? memberStatus
    : membersHouseholdId === household.id
      ? memberStatus
      : memberErrorHouseholdId === household.id
        ? "error"
        : "loading"

  const householdViewModel = createHouseholdApplicationViewModel({
    household: household ?? null,
    members: membersHouseholdId === household?.id ? members : [],
    currentUserId: state.currentUser.id,
    status: visibleMemberStatus,
    errorMessage: visibleMemberStatus === "error" ? memberError : null,
    refreshError:
      visibleMemberStatus === "loaded" && membersHouseholdId === household?.id
        ? memberRefreshError
        : null,
  })
  return (
    <>
      <HouseholdScreenView
        activeDestination="household"
        busyMemberId={busyMemberId}
        confirmText={confirmText}
        leaveBusy={leaveBusy}
        leaveError={leaveError}
        leaveFlow={leaveFlow}
        memberActionError={memberActionError}
        onChangeConfirmText={setConfirmText}
        onCloseLeave={() => {
          setLeaveFlow("closed")
          setLeaveError(null)
        }}
        onBackToSuccessorSelection={() => {
          setLeaveError(null)
          setLeaveFlow("owner-select")
        }}
        onCloseMemberAction={() => {
          setPendingMemberAction(null)
          setConfirmText("")
          setMemberActionError(null)
          setOpenMemberMenuId(null)
          if (pendingAccountDeletionUserId === state.currentUser.id) clearAccountDeletion()
        }}
        onConfirmLeave={() => void leaveHousehold()}
        onConfirmMemberAction={() => void commitMemberAction()}
        onContinueOwnerLeave={() => {
          setLeaveError(null)
          setLeaveFlow("owner-confirm")
        }}
        onHouseholdSettings={() => navigate("household-settings")}
        onManageChores={() => navigate("admin", "chores")}
        onMemberAction={handleMemberAction}
        onNavigate={(destination) => navigate(destination)}
        onOpenInvite={() => setInviteOpen(true)}
        onOpenLeave={openLeaveFlow}
        onRetry={() => void loadMembers()}
        onSelectSuccessor={setSelectedNewOwnerId}
        onToggleMemberMenu={(memberId) =>
          setOpenMemberMenuId((openId) => (openId === memberId ? null : memberId))
        }
        openMemberMenuId={openMemberMenuId}
        pendingMemberAction={pendingMemberAction}
        selectedNewOwnerId={selectedNewOwnerId}
        theme={theme}
        viewModel={householdViewModel}
      />
      {household && canManage && (
        <InviteHousemateDialog
          household={household}
          onOpenChange={setInviteDialogOpen}
          open={inviteOpen}
          theme={theme}
        />
      )}
    </>
  )
}
