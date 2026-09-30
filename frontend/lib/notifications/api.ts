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
  choreRemindersEnabled: boolean
  choreCompletionEnabled: boolean
  householdUpdatesEnabled: boolean
  quietHoursStart: string | null
  quietHoursEnd: string | null
  funnyNotificationsEnabled: boolean
  pushEnabled: boolean
}

export const notificationApi = {
  list: () => api.get<Notification[]>("/api/notifications"),
  unreadCount: () => api.get<{ count: number }>("/api/notifications/unread-count"),
  markRead: (id: string) => api.patch<void>(`/api/notifications/${encodeURIComponent(id)}/read`),
  markAllRead: () => api.patch<void>("/api/notifications/read-all"),
  preferences: async () => normalizePreferences(await api.get<NotificationPreferences>("/api/notifications/preferences")),
  updatePreferences: async (preferences: NotificationPreferences) =>
    normalizePreferences(await api.put<NotificationPreferences>("/api/notifications/preferences", serializePreferences(preferences))),
}

function normalizePreferences(preferences: NotificationPreferences): NotificationPreferences {
  return {
    ...preferences,
    quietHoursStart: preferences.quietHoursStart?.slice(0, 5) ?? null,
    quietHoursEnd: preferences.quietHoursEnd?.slice(0, 5) ?? null,
  }
}

function serializePreferences(preferences: NotificationPreferences): NotificationPreferences {
  return {
    ...preferences,
    quietHoursStart: preferences.quietHoursStart && preferences.quietHoursStart.length === 5 ? `${preferences.quietHoursStart}:00` : preferences.quietHoursStart,
    quietHoursEnd: preferences.quietHoursEnd && preferences.quietHoursEnd.length === 5 ? `${preferences.quietHoursEnd}:00` : preferences.quietHoursEnd,
  }
}
