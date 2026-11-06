"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useAuth } from "@/lib/auth/auth-context"
import { useChoreSync } from "@/lib/chore-sync/store"
import { notificationApi } from "@/lib/notifications/api"
import { profileApi, type Profile } from "@/lib/profile/api"
import { notificationResource, useDataSync } from "@/lib/data-sync/data-sync-context"
import type { Theme } from "@/components/theme/theme-provider"
import { ProfileScreenView } from "./profile-screen-view"

export function ProfileScreen({ theme = "light" }: { theme?: Exclude<Theme, "system"> }) {
  const { state, navigate, openNotifications } = useChoreSync()
  const { logout } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [notificationError, setNotificationError] = useState("")
  const notificationRequestSequence = useRef(0)
  const { revision: notificationRevision } = useDataSync(notificationResource)

  const loadProfile = useCallback(async () => {
    setError("")
    try {
      const result = await profileApi.get()
      setProfile(result)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to load your profile. Please try again.",
      )
    }
  }, [])

  const loadNotificationCount = useCallback(async () => {
    const requestId = ++notificationRequestSequence.current
    try {
      const result = await notificationApi.unreadCount()
      if (requestId !== notificationRequestSequence.current) return
      setUnreadCount(result.count)
      setNotificationError("")
    } catch (cause) {
      if (requestId !== notificationRequestSequence.current) return
      setNotificationError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to refresh notification count. Please try again.",
      )
    }
  }, [])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])
  useEffect(() => {
    void loadNotificationCount()
    return () => {
      notificationRequestSequence.current += 1
    }
  }, [loadNotificationCount, notificationRevision])

  const handleLogout = async () => {
    if (isSubmitting) return
    setError("")
    setIsSubmitting(true)
    try {
      await logout()
      navigate("login")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to sign out. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const initials =
    profile?.displayName?.trim().slice(0, 1).toUpperCase() || state.currentUser.avatar
  return (
    <ProfileScreenView
      error={error}
      initials={initials}
      isSubmitting={isSubmitting}
      notificationError={notificationError}
      onEdit={() => navigate("edit-profile")}
      onNavigate={(destination) => navigate(destination)}
      onNotifications={() => openNotifications("profile")}
      onPrimaryNavigate={navigate}
      onRetryNotifications={() => void loadNotificationCount()}
      onRetryProfile={() => void loadProfile()}
      onSignOut={() => void handleLogout()}
      profile={profile}
      theme={theme}
      unreadCount={unreadCount}
    />
  )
}
