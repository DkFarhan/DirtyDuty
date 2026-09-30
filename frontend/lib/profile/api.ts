import { api } from "@/lib/auth/api"

export type Profile = {
  id: string
  displayName: string
  email: string
  avatarUrl: string | null
  householdName: string | null
  assigned: number
  completed: number
  completionRate: number
}

export type ProfileUpdate = Pick<Profile, "displayName">

export const profileApi = {
  get: () => api.get<Profile>("/api/profile"),
  update: (input: ProfileUpdate) => api.put<Profile>("/api/profile", input),
}
