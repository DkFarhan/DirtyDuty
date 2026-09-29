import type { AppState } from "./types"

/**
 * Mock data for UI development only. The store (see `store.tsx`) is the single
 * integration point — swap these seeds for calls to the Spring Boot backend
 * without touching any screen component.
 */
export const initialState: AppState = {
  currentUser: { id: "1", name: "Jahid", avatar: "J", isAdmin: true },
  household: {
    id: "1",
    name: "Apartment 305",
    members: [
      { id: "1", name: "Jahid", avatar: "J", isAdmin: true },
      { id: "2", name: "Ahmed", avatar: "A", isAdmin: false },
      { id: "3", name: "Rahim", avatar: "R", isAdmin: false },
    ],
  },
  chores: [
    { id: "1", name: "Clean Kitchen", assigneeId: "1", assigneeName: "Jahid", due: "Today, 6 PM", dueDay: "Today", status: "pending", priority: "high", icon: "🧹", frequency: "Weekly" },
    { id: "2", name: "Take Garbage Out", assigneeId: "2", assigneeName: "Ahmed", due: "Monday", dueDay: "Monday", status: "pending", priority: "medium", icon: "🗑️", frequency: "Weekly" },
    { id: "3", name: "Bathroom Cleaning", assigneeId: "3", assigneeName: "Rahim", due: "Wednesday", dueDay: "Wednesday", status: "pending", priority: "medium", icon: "🛁", frequency: "Weekly" },
    { id: "4", name: "Laundry", assigneeId: "1", assigneeName: "Jahid", due: "Friday", dueDay: "Friday", status: "pending", priority: "low", icon: "🧺", frequency: "Weekly" },
    { id: "5", name: "Mop the Floor", assigneeId: "2", assigneeName: "Ahmed", due: "Saturday", dueDay: "Saturday", status: "pending", priority: "low", icon: "🫧", frequency: "Weekly" },
    { id: "6", name: "Vacuum Living Room", assigneeId: "2", assigneeName: "Ahmed", due: "Last Monday", dueDay: "Last Monday", status: "completed", priority: "low", icon: "🌀", frequency: "Weekly" },
    { id: "7", name: "Dishes", assigneeId: "1", assigneeName: "Jahid", due: "Yesterday", dueDay: "Yesterday", status: "completed", priority: "high", icon: "🍽️", frequency: "Daily" },
    { id: "8", name: "Take Out Recycling", assigneeId: "3", assigneeName: "Rahim", due: "Last Thursday", dueDay: "Last Thursday", status: "completed", priority: "medium", icon: "♻️", frequency: "Weekly" },
  ],
}
