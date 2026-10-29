import type { MyChoreUpcomingViewModel, MyChoresViewModel } from "./my-chores-screen-view"

export const upcomingChoresFixture: MyChoreUpcomingViewModel[] = [
  {
    id: "preview-kitchen-floor",
    title: "Kitchen Floor",
    category: "Kitchen",
    dateLabel: "Fri, Oct 30  ·  6:00 PM",
    durationLabel: "About 30 min",
    assignedTo: "You",
    categoryIcon: 1,
    priority: true,
  },
  {
    id: "preview-trash",
    title: "Trash",
    category: "Trash",
    dateLabel: "Mon, Nov 2  ·  6:00 PM",
    durationLabel: "About 5 min",
    assignedTo: "You",
    categoryIcon: 2,
  },
  {
    id: "preview-laundry",
    title: "Laundry",
    category: "Laundry",
    dateLabel: "Tue, Nov 3  ·  7:00 PM",
    durationLabel: "About 35 min",
    assignedTo: "You, Sam",
    categoryIcon: 3,
  },
  {
    id: "preview-dishes",
    title: "Dishes",
    category: "Kitchen",
    dateLabel: "Wed, Nov 4  ·  6:00 PM",
    durationLabel: "About 20 min",
    assignedTo: "You",
    categoryIcon: 4,
  },
  {
    id: "preview-vacuum-living-room",
    title: "Vacuum Living Room",
    category: "Living Room",
    dateLabel: "Thu, Nov 5  ·  5:00 PM",
    durationLabel: "About 25 min",
    assignedTo: "You",
    categoryIcon: 5,
  },
  {
    id: "preview-bathroom-mirror",
    title: "Bathroom Mirror",
    category: "Bathroom",
    dateLabel: "Fri, Nov 6  ·  6:00 PM",
    durationLabel: "About 10 min",
    assignedTo: "You",
    categoryIcon: 6,
  },
  {
    id: "preview-recycling",
    title: "Recycling",
    category: "Trash",
    dateLabel: "Sat, Nov 7  ·  9:00 AM",
    durationLabel: "About 10 min",
    assignedTo: "You, Sam",
    categoryIcon: 2,
  },
  {
    id: "preview-dust-shelves",
    title: "Dust Shelves",
    category: "Living Room",
    dateLabel: "Sun, Nov 8  ·  2:00 PM",
    durationLabel: "About 20 min",
    assignedTo: "You",
    categoryIcon: 5,
  },
  {
    id: "preview-mop-entryway",
    title: "Mop Entryway",
    category: "Floor",
    dateLabel: "Mon, Nov 9  ·  6:00 PM",
    durationLabel: "About 15 min",
    assignedTo: "You",
    categoryIcon: 1,
  },
]

export const attentionChoreFixture: MyChoreUpcomingViewModel = {
  id: "preview-washroom",
  title: "Washroom",
  category: "Bathroom",
  dateLabel: "Mon, Oct 26  ·  6:00 PM",
  durationLabel: "About 60 min",
  assignedTo: "You, Sam",
  categoryIcon: 6,
  overdue: true,
}

export const completedChoresFixture = [
  {
    id: "preview-completed-garbage-1",
    title: "Garbage",
    category: "Trash",
    dateLabel: "Fri, Oct 23 · 9:00 AM",
    durationLabel: "About 5 min",
    assignedTo: "You",
    completedBy: "Salman",
  },
  {
    id: "preview-completed-garbage-2",
    title: "Garbage",
    category: "Trash",
    dateLabel: "Sun, Oct 25 · 9:00 AM",
    durationLabel: "About 5 min",
    assignedTo: "You",
    completedBy: "Salman",
  },
  {
    id: "preview-completed-trash",
    title: "Trash",
    category: "Trash",
    dateLabel: "Mon, Oct 26 · 6:00 PM",
    durationLabel: "About 5 min",
    assignedTo: "You",
    completedBy: "Salman",
  },
]

export const myChoresPreviewFixture: MyChoresViewModel = {
  status: "loaded",
  attentionChore: attentionChoreFixture,
  upcomingChores: upcomingChoresFixture,
  completedChores: completedChoresFixture,
  completedHeading: "Three things, taken care of.",
  completingIds: [],
}

export type MyChoresPreviewScenario =
  | "upcoming"
  | "completed"
  | "empty-upcoming"
  | "empty-completed"
  | "loading"
  | "error"
  | "refresh-error"
  | "pending"

export function createMyChoresScenario(scenario: MyChoresPreviewScenario): MyChoresViewModel {
  switch (scenario) {
    case "empty-upcoming":
      return {
        ...myChoresPreviewFixture,
        attentionChore: null,
        upcomingChores: [],
      }
    case "empty-completed":
      return {
        ...myChoresPreviewFixture,
        completedChores: [],
      }
    case "loading":
      return {
        ...myChoresPreviewFixture,
        status: "loading",
      }
    case "error":
      return {
        ...myChoresPreviewFixture,
        status: "error",
        errorMessage: "Your list is temporarily unavailable. Please try again.",
      }
    case "refresh-error":
      return {
        ...myChoresPreviewFixture,
        refreshError: "Unable to refresh your chores. Your current list is still available.",
      }
    case "pending":
      return {
        ...myChoresPreviewFixture,
        completingIds: ["preview-kitchen-floor"],
      }
    case "completed":
    case "upcoming":
    default:
      return myChoresPreviewFixture
  }
}
