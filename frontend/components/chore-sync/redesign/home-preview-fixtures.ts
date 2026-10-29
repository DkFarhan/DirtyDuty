import type { HomeScreenViewModel } from "./home-screen-view"

export const homePreviewFixture: HomeScreenViewModel = {
  status: "loaded",
  displayName: "Alex",
  greeting: "Good evening,",
  dateLabel: "TUESDAY   ·   27 OCTOBER",
  householdName: "The Common Room",
  notificationCount: 18,
  householdWeek: {
    completedCount: 1,
    totalCount: 4,
  },
  personalWeek: {
    title: "Tiny rescue mission.",
    message: "You've got 1 overdue chore to knock out.",
    completedCount: 1,
    assignedCount: 3,
    dueTodayCount: 0,
    overdueCount: 1,
  },
  attentionChore: {
    id: "preview-washroom",
    title: "Washroom",
    category: "Bathroom",
    scheduledLabel: "Mon, Oct 26 · 6:00 PM",
    durationLabel: "About 60 min",
    assignedTo: "You, Sam",
  },
  todayChores: [],
  upcomingDateLabel: "FRIDAY   ·   OCT 30",
  upcomingChores: [
    { id: "preview-trash", title: "Trash", category: "Trash", timeLabel: "6:00 PM" },
    {
      id: "preview-kitchen-floor",
      title: "Kitchen Floor",
      category: "Kitchen",
      timeLabel: "6:00 PM",
    },
  ],
}

export function createEmptyHomePreviewFixture(): HomeScreenViewModel {
  return {
    ...homePreviewFixture,
    status: "loaded",
    attentionChore: null,
    todayChores: [],
    upcomingChores: [],
    personalWeek: {
      ...homePreviewFixture.personalWeek,
      message: "You're all caught up for now.",
      overdueCount: 0,
    },
  }
}
