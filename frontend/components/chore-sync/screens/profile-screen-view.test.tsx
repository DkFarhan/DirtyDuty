// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Profile } from "@/lib/profile/api"
import { ProfileScreenView } from "./profile-screen-view"

const profile: Profile = {
  id: "profile-1",
  displayName: "Riley Chen",
  email: "riley@example.test",
  avatarUrl: null,
  householdName: "Cedar House",
  assigned: 4,
  completed: 3,
  completionRate: 75,
}

describe("ProfileScreenView", () => {
  afterEach(cleanup)

  it("renders account details and preserves the profile destinations and primary navigation", () => {
    const onEdit = vi.fn()
    const onNotifications = vi.fn()
    const onNavigate = vi.fn()
    const onPrimaryNavigate = vi.fn()

    render(
      <ProfileScreenView
        error=""
        initials="R"
        isSubmitting={false}
        notificationError=""
        onEdit={onEdit}
        onNavigate={onNavigate}
        onNotifications={onNotifications}
        onPrimaryNavigate={onPrimaryNavigate}
        onRetryNotifications={vi.fn()}
        onRetryProfile={vi.fn()}
        onSignOut={vi.fn()}
        profile={profile}
        theme="dark"
        unreadCount={2}
      />,
    )

    expect(screen.getByText("Riley Chen")).toBeTruthy()
    expect(screen.getByText("riley@example.test")).toBeTruthy()
    expect(screen.getByText("Cedar House")).toBeTruthy()
    expect(screen.getByText("Rewards & streaks")).toBeTruthy()
    expect(screen.getByText("Points, badges & household leaderboards")).toBeTruthy()
    expect(
      document.querySelector('img[src="/profile-redesign/icons/identity-rim-dark.svg"]'),
    ).toBeTruthy()
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy()
    expect(document.querySelector("[data-profile-redesign]")?.className).toContain("dark")

    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }))
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }))
    fireEvent.click(screen.getByRole("button", { name: /Privacy & Security/ }))
    fireEvent.click(screen.getByRole("button", { name: /Appearance/ }))
    fireEvent.click(screen.getByRole("button", { name: /Help & Support/ }))
    fireEvent.click(screen.getByRole("button", { name: "Home" }))

    expect(onEdit).toHaveBeenCalledOnce()
    expect(onNotifications).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenNthCalledWith(1, "privacy-security")
    expect(onNavigate).toHaveBeenNthCalledWith(2, "appearance")
    expect(onNavigate).toHaveBeenNthCalledWith(3, "help-support")
    expect(onPrimaryNavigate).toHaveBeenCalledWith("dashboard")
  })

  it("keeps retry and sign-out controls available for their controller actions", () => {
    const onRetryProfile = vi.fn()
    const onRetryNotifications = vi.fn()
    const onSignOut = vi.fn()
    render(
      <ProfileScreenView
        error="Profile request failed"
        initials="R"
        isSubmitting={false}
        notificationError="Notification count failed"
        onEdit={vi.fn()}
        onNavigate={vi.fn()}
        onNotifications={vi.fn()}
        onPrimaryNavigate={vi.fn()}
        onRetryNotifications={onRetryNotifications}
        onRetryProfile={onRetryProfile}
        onSignOut={onSignOut}
        profile={null}
        theme="light"
        unreadCount={0}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))

    expect(onRetryProfile).toHaveBeenCalledOnce()
    expect(onRetryNotifications).toHaveBeenCalledOnce()
    expect(onSignOut).toHaveBeenCalledOnce()
  })
})
