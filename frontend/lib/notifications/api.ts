import { api } from "@/lib/auth/api"

export type Notification = {
  id: string
  type: string
  category: string
  priority: string
  title: string
  message: string
  referenceType: string | null
  referenceId: string | null
  status: string
  scheduledAt: string | null
  sentAt: string | null
  readAt: string | null
  createdAt: string
}

export type NotificationPreferences = {
  choreAssignedEnabled: boolean
  choreRemindersEnabled: boolean
  overdueEnabled: boolean
  choreCompletionEnabled: boolean
  householdUpdatesEnabled: boolean
  quietHoursStart: string | null
  quietHoursEnd: string | null
  notificationStyleOverride: NotificationStyle | null
  householdNotificationStyle: NotificationStyle
  funnyNotificationsEnabled: boolean
  competitiveNotificationsEnabled: boolean
  pushEnabled: boolean
}

export type NotificationStyle = "NORMAL" | "FUNNY" | "MOTIVATIONAL" | "COMPETITIVE" | "MINIMAL"

export type PushPublicKey = {
  publicKey: string | null
  available: boolean
}

export const notificationApi = {
  list: () => api.get<Notification[]>("/api/notifications"),
  unreadCount: () => api.get<{ count: number }>("/api/notifications/unread-count"),
  markRead: (id: string) => api.patch<void>(`/api/notifications/${encodeURIComponent(id)}/read`),
  markAllRead: () => api.patch<void>("/api/notifications/read-all"),
  pushPublicKey: () => api.get<PushPublicKey>("/api/notifications/push/public-key"),
  subscribePush: (subscription: { endpoint: string; publicKey: string; authSecret: string }) =>
    api.put<void>("/api/notifications/push-subscriptions", subscription),
  unsubscribePush: (endpoint: string) =>
    api.post<void>("/api/notifications/push-subscriptions/unsubscribe", { endpoint }),
  setHouseholdStyle: (householdId: string, style: NotificationStyle) =>
    api.put<void>(`/api/notifications/households/${encodeURIComponent(householdId)}/style`, { style }),
  preferences: async () => normalizePreferences(await api.get<NotificationPreferences>("/api/notifications/preferences")),
  updatePreferences: async (preferences: NotificationPreferences) =>
    normalizePreferences(await api.put<NotificationPreferences>("/api/notifications/preferences", serializePreferences(preferences))),
}

function normalizePreferences(preferences: NotificationPreferences): NotificationPreferences {
  return {
    ...preferences,
    choreAssignedEnabled: preferences.choreAssignedEnabled ?? true,
    choreRemindersEnabled: preferences.choreRemindersEnabled ?? true,
    overdueEnabled: preferences.overdueEnabled ?? true,
    choreCompletionEnabled: preferences.choreCompletionEnabled ?? true,
    householdUpdatesEnabled: preferences.householdUpdatesEnabled ?? true,
    notificationStyleOverride: preferences.notificationStyleOverride ?? null,
    householdNotificationStyle: preferences.householdNotificationStyle ?? "NORMAL",
    funnyNotificationsEnabled: preferences.funnyNotificationsEnabled ?? false,
    competitiveNotificationsEnabled: preferences.competitiveNotificationsEnabled ?? true,
    pushEnabled: preferences.pushEnabled ?? false,
    quietHoursStart: preferences.quietHoursStart?.slice(0, 5) ?? null,
    quietHoursEnd: preferences.quietHoursEnd?.slice(0, 5) ?? null,
  }
}

function serializePreferences(preferences: NotificationPreferences): Omit<NotificationPreferences, "householdNotificationStyle"> {
  return {
    choreAssignedEnabled: preferences.choreAssignedEnabled,
    choreRemindersEnabled: preferences.choreRemindersEnabled,
    overdueEnabled: preferences.overdueEnabled,
    choreCompletionEnabled: preferences.choreCompletionEnabled,
    householdUpdatesEnabled: preferences.householdUpdatesEnabled,
    quietHoursStart: preferences.quietHoursStart && preferences.quietHoursStart.length === 5 ? `${preferences.quietHoursStart}:00` : preferences.quietHoursStart,
    quietHoursEnd: preferences.quietHoursEnd && preferences.quietHoursEnd.length === 5 ? `${preferences.quietHoursEnd}:00` : preferences.quietHoursEnd,
    notificationStyleOverride: preferences.notificationStyleOverride,
    funnyNotificationsEnabled: preferences.funnyNotificationsEnabled,
    competitiveNotificationsEnabled: preferences.competitiveNotificationsEnabled,
    pushEnabled: preferences.pushEnabled,
  }
}
