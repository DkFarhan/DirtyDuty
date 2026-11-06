"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { ApiError } from "@/lib/auth/api"
import { choreApi, type HouseholdDashboard } from "@/lib/household/chores"
import { useHouseholds } from "@/lib/household/household-context"
import type { Household } from "@/lib/household/api"
import { InviteHousemateDialog } from "../invite-housemate-dialog"
import { notificationApi } from "@/lib/notifications/api"
import {
  householdChoreResource,
  notificationResource,
  useDataSync,
} from "@/lib/data-sync/data-sync-context"
import {
  optimisticallyCompleteDashboardAssignment,
  rollbackDashboardAssignmentCompletion,
  updateDashboardAssignment,
} from "@/lib/household/assignment-state"
import { usePushSubscriptionHealth } from "@/lib/notifications/push-health"
import {
  HomeScreenView,
  type HomeNavigationDestination,
  type HomeVisualTheme,
} from "../redesign/home-screen-view"
import { createHomeApplicationViewModel } from "../redesign/home-application-adapter"

export function DashboardScreen({ theme = "dark" }: { theme?: HomeVisualTheme } = {}) {
  const { state, navigate, openNotifications } = useChoreSync()
  const {
    state: pushHealth,
    refresh: refreshPushHealth,
    restore: restorePush,
  } = usePushSubscriptionHealth()
  const {
    activeHousehold: household,
    createdHouseholdInvite,
    queueCreatedHouseholdInvite,
  } = useHouseholds()
  const [dashboard, setDashboard] = useState<HouseholdDashboard | null>(null)
  const [dashboardHouseholdId, setDashboardHouseholdId] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [notificationCountError, setNotificationCountError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [completingIds, setCompletingIds] = useState<Set<string>>(() => new Set())
  const [inviteHousehold, setInviteHousehold] = useState<Household | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const dashboardRef = useRef<HouseholdDashboard | null>(null)
  const dashboardHouseholdIdRef = useRef<string | null>(null)
  const requestSequence = useRef(0)
  const unreadRequestSequence = useRef(0)
  const loadUnreadCount = useCallback(async () => {
    const requestId = ++unreadRequestSequence.current
    try {
      const result = await notificationApi.unreadCount()
      if (requestId !== unreadRequestSequence.current) return
      setUnreadCount(result.count)
      setNotificationCountError(null)
    } catch (cause) {
      if (requestId !== unreadRequestSequence.current) return
      setNotificationCountError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to refresh notification count. Please try again.",
      )
    }
  }, [])
  const pendingCompletions = useRef(
    new Map<
      string,
      {
        householdId: string
        assignmentId: string
        previous: import("@/lib/household/chores").AssignmentDTO
        incrementedWeekSummary: boolean
        serverConfirmed: boolean
      }
    >(),
  )
  const pendingCompletionIds = useRef(new Set<string>())
  const choreResource = household
    ? householdChoreResource(household.id)
    : "household:none:chores-and-assignments"
  const {
    revision: choresRevision,
    invalidate: invalidateChores,
    claim: claimCompletion,
    release: releaseCompletion,
  } = useDataSync(choreResource)
  const { revision: notificationsRevision } = useDataSync(notificationResource)
  const canInvite = household?.currentUserRole === "OWNER" || household?.currentUserRole === "ADMIN"

  const loadDashboard = useCallback(async () => {
    if (!household) {
      requestSequence.current += 1
      dashboardRef.current = null
      dashboardHouseholdIdRef.current = null
      setDashboard(null)
      setDashboardHouseholdId(null)
      setError("Your household could not be found.")
      setStatus("error")
      return
    }
    const requestId = ++requestSequence.current
    const hasCurrentData =
      dashboardHouseholdIdRef.current === household.id && dashboardRef.current !== null
    if (!hasCurrentData) setStatus("loading")
    try {
      const nextDashboard = await choreApi.dashboard(household.id)
      if (requestId !== requestSequence.current) return
      let reconciledDashboard = nextDashboard
      for (const pending of pendingCompletions.current.values()) {
        if (pending.householdId !== household.id) continue
        const serverAssignment = [
          reconciledDashboard.today,
          reconciledDashboard.thisWeek,
          reconciledDashboard.overdue,
        ]
          .flat()
          .find((assignment) => assignment.id === pending.assignmentId)
        if (serverAssignment?.status === "COMPLETED") {
          pending.serverConfirmed = true
        } else {
          const optimistic = optimisticallyCompleteDashboardAssignment(
            reconciledDashboard,
            pending.assignmentId,
          )
          if (optimistic) reconciledDashboard = optimistic.dashboard
        }
      }
      dashboardRef.current = reconciledDashboard
      dashboardHouseholdIdRef.current = household.id
      setDashboard(reconciledDashboard)
      setDashboardHouseholdId(household.id)
      setError(null)
      setRefreshError(null)
      setStatus("loaded")
    } catch (cause) {
      if (requestId !== requestSequence.current) return
      const message =
        cause instanceof ApiError
          ? cause.message
          : hasCurrentData
            ? "Unable to refresh your dashboard. Please try again."
            : "Unable to load your dashboard. Please try again."
      if (hasCurrentData) {
        setRefreshError(message)
        return
      }
      setError(message)
      setStatus("error")
    }
  }, [household])

  useEffect(() => {
    void loadDashboard()
    return () => {
      requestSequence.current += 1
    }
  }, [choresRevision, loadDashboard])
  useEffect(() => {
    void loadUnreadCount()
    return () => {
      unreadRequestSequence.current += 1
    }
  }, [loadUnreadCount, notificationsRevision])

  useEffect(() => {
    if (!createdHouseholdInvite) return
    setInviteHousehold(createdHouseholdInvite)
    queueCreatedHouseholdInvite(null)
  }, [createdHouseholdInvite, queueCreatedHouseholdInvite])

  const completeAssignment = async (assignmentId: string) => {
    if (!household) return
    const operationKey = `${household.id}:${assignmentId}`
    if (pendingCompletionIds.current.has(operationKey) || !claimCompletion(assignmentId)) return
    const currentDashboard =
      dashboardHouseholdIdRef.current === household.id ? dashboardRef.current : null
    if (!currentDashboard) {
      releaseCompletion(assignmentId)
      return
    }
    const optimistic = optimisticallyCompleteDashboardAssignment(currentDashboard, assignmentId)
    if (!optimistic) {
      releaseCompletion(assignmentId)
      return
    }

    pendingCompletionIds.current.add(operationKey)
    pendingCompletions.current.set(operationKey, {
      householdId: household.id,
      assignmentId,
      previous: optimistic.previous,
      incrementedWeekSummary: optimistic.incrementedWeekSummary,
      serverConfirmed: false,
    })
    requestSequence.current += 1
    setCompletingIds((current) => new Set(current).add(operationKey))
    dashboardRef.current = optimistic.dashboard
    setDashboard(optimistic.dashboard)
    setActionError(null)
    try {
      const confirmed = await choreApi.complete(household.id, assignmentId)
      requestSequence.current += 1
      if (dashboardHouseholdIdRef.current === household.id && dashboardRef.current) {
        const reconciled = updateDashboardAssignment(dashboardRef.current, confirmed)
        dashboardRef.current = reconciled
        setDashboard(reconciled)
      }
      pendingCompletions.current.delete(operationKey)
      invalidateChores()
    } catch (cause) {
      requestSequence.current += 1
      const pending = pendingCompletions.current.get(operationKey)
      if (
        pending &&
        !pending.serverConfirmed &&
        dashboardHouseholdIdRef.current === household.id &&
        dashboardRef.current
      ) {
        const rolledBack = rollbackDashboardAssignmentCompletion(
          dashboardRef.current,
          pending.previous,
          pending.incrementedWeekSummary,
        )
        dashboardRef.current = rolledBack
        setDashboard(rolledBack)
      }
      pendingCompletions.current.delete(operationKey)
      if (dashboardHouseholdIdRef.current === household.id) {
        setActionError(
          cause instanceof ApiError
            ? cause.message
            : "Unable to complete this chore. Please try again.",
        )
      }
      invalidateChores()
    } finally {
      pendingCompletionIds.current.delete(operationKey)
      releaseCompletion(assignmentId)
      setCompletingIds((current) => {
        const next = new Set(current)
        next.delete(operationKey)
        return next
      })
    }
  }

  const setInviteOpen = useCallback((open: boolean) => {
    if (!open) setInviteHousehold(null)
  }, [])
  const visibleStatus =
    household && dashboardHouseholdId !== household.id && status !== "error" ? "loading" : status
  const currentDashboard = household && dashboardHouseholdId === household.id ? dashboard : null
  const viewModel = createHomeApplicationViewModel({
    dashboard: currentDashboard,
    householdId: household?.id ?? null,
    householdName: household?.name ?? "Your household",
    householdTimezone: household?.timezone ?? "UTC",
    currentUserId: state.currentUser.id,
    displayName: state.currentUser.name,
    notificationCount: unreadCount,
    status: visibleStatus,
    errorMessage: error,
    refreshError,
    actionError,
    notificationCountError,
    completingIds,
    pushHealth,
  })
  const onNavigate = (destination: HomeNavigationDestination) =>
    navigate(destination === "home" ? "dashboard" : destination)
  const onPushAction = () => {
    if (pushHealth.reason === "check-failed") {
      void refreshPushHealth(true)
    } else if (pushHealth.reason === "permission-denied") {
      openNotifications("dashboard")
    } else {
      void restorePush()
    }
  }
  return (
    <>
      <HomeScreenView
        activeDestination="home"
        onCompleteChore={(id) => void completeAssignment(id)}
        onNavigate={onNavigate}
        onOpenNotifications={() => openNotifications("dashboard")}
        onPushAction={onPushAction}
        onRetry={() => void loadDashboard()}
        onRetryNotificationCount={() => void loadUnreadCount()}
        theme={theme}
        viewModel={viewModel}
      />
      {household && canInvite && (
        <InviteHousemateDialog
          household={inviteHousehold ?? household}
          onOpenChange={setInviteOpen}
          open={inviteHousehold !== null}
          theme={theme}
        />
      )}
    </>
  )
}
