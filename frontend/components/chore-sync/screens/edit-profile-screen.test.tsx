// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EditProfileScreen } from "./edit-profile-screen"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setCurrentUser: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({
    navigate: mocks.navigate,
    setCurrentUser: mocks.setCurrentUser,
    state: { currentUser: { id: "user-1", name: "Riley Chen", avatar: "R", isAdmin: false } },
  }),
}))

vi.mock("@/lib/profile/api", () => ({
  profileApi: {
    get: mocks.get,
    update: mocks.update,
  },
}))

const profile = {
  id: "user-1",
  displayName: "Riley Chen",
  email: "riley@example.test",
  avatarUrl: null,
  householdName: "Cedar House",
  assigned: 4,
  completed: 3,
  completionRate: 75,
}

describe("EditProfileScreen", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.get.mockResolvedValue(profile)
  })

  afterEach(cleanup)

  it("uses the current form in dark mode and saves the updated profile", async () => {
    mocks.update.mockResolvedValue({ ...profile, displayName: "Sam Chen" })
    render(<EditProfileScreen theme="dark" />)

    expect(await screen.findByText("YOUR DETAILS")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Edit profile", level: 1 })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "The name everyone sees." })).toBeTruthy()
    expect(screen.getByText("Update your display name across your shared home.")).toBeTruthy()
    expect(
      screen.getByText("Avatar uploads are coming soon. Your initial appears in the meantime."),
    ).toBeTruthy()
    expect(screen.getByText("Email is read-only.")).toBeTruthy()
    expect(screen.getByText("Changes appear in your household after saving.")).toBeTruthy()
    const displayNameInput = screen.getByRole("textbox", { name: "Display name" })
    expect(displayNameInput.closest("section")).toBeNull()

    fireEvent.change(displayNameInput, { target: { value: "  Sam Chen  " } })
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }))

    expect((await screen.findByRole("status")).textContent).toBe("Profile updated.")
    expect(mocks.update).toHaveBeenCalledWith({ displayName: "Sam Chen" })
    expect(mocks.setCurrentUser).toHaveBeenCalledWith({
      id: "user-1",
      name: "Sam Chen",
      avatar: "S",
      isAdmin: false,
    })
  })
})
