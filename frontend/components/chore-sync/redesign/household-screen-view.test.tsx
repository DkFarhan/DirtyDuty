// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createHouseholdPreviewFixture } from "./household-preview-fixtures"
import { HouseholdScreenView, type HouseholdScreenViewProps } from "./household-screen-view"
import styles from "./household-screen-view.module.css"

function renderHouseholdView(
  role: "owner-3" | "admin-3" | "member-3" = "admin-3",
  overrides: Partial<HouseholdScreenViewProps> = {},
) {
  const fixture = createHouseholdPreviewFixture(role)
  const onMemberAction = vi.fn()
  const props: HouseholdScreenViewProps = {
    activeDestination: "household",
    busyMemberId: null,
    confirmText: "",
    leaveBusy: false,
    leaveError: null,
    leaveFlow: "closed",
    memberActionError: null,
    onBackToSuccessorSelection: vi.fn(),
    onChangeConfirmText: vi.fn(),
    onCloseLeave: vi.fn(),
    onCloseMemberAction: vi.fn(),
    onConfirmLeave: vi.fn(),
    onConfirmMemberAction: vi.fn(),
    onContinueOwnerLeave: vi.fn(),
    onHouseholdSettings: vi.fn(),
    onManageChores: vi.fn(),
    onMemberAction,
    onNavigate: vi.fn(),
    onOpenInvite: vi.fn(),
    onOpenLeave: vi.fn(),
    onRetry: vi.fn(),
    onSelectSuccessor: vi.fn(),
    onToggleMemberMenu: vi.fn(),
    openMemberMenuId: null,
    pendingMemberAction: null,
    selectedNewOwnerId: "",
    theme: "dark",
    viewModel: fixture.viewModel,
    ...overrides,
  }
  const view = render(<HouseholdScreenView {...props} />)
  return { onMemberAction, props, view }
}

afterEach(() => cleanup())

describe("Household screen presentation", () => {
  it("shows owner controls only for other eligible members", () => {
    const ownerFixture = createHouseholdPreviewFixture("owner-menu")
    const { onMemberAction } = renderHouseholdView("owner-3", {
      openMemberMenuId: "preview-member",
      viewModel: ownerFixture.viewModel,
    })

    fireEvent.click(screen.getByRole("button", { name: "Promote to admin" }))

    expect(onMemberAction).toHaveBeenCalledWith(
      "promote",
      expect.objectContaining({ userId: "preview-member", role: "MEMBER" }),
    )
    expect(screen.queryByRole("button", { name: "Actions for Farhan Habib" })).toBeNull()
  })

  it("limits admins to ordinary-member removal and hides all member controls from members", () => {
    const adminFixture = createHouseholdPreviewFixture("admin-3")
    const admin = renderHouseholdView("admin-3", {
      openMemberMenuId: "preview-member",
      viewModel: adminFixture.viewModel,
    })
    expect(screen.getByRole("button", { name: "Remove from household" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Promote to admin" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Transfer ownership" })).toBeNull()

    cleanup()
    const memberFixture = createHouseholdPreviewFixture("member-3")
    renderHouseholdView("member-3", { viewModel: memberFixture.viewModel })
    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull()
    expect(screen.queryByRole("heading", { name: "Manage household" })).toBeNull()
    expect(screen.getByRole("button", { name: "Leave household" })).toBeTruthy()
    expect(admin.onMemberAction).not.toHaveBeenCalled()
  })

  it("keeps stale members visible alongside refresh errors and exposes retry", () => {
    const fixture = createHouseholdPreviewFixture("refresh-error")
    const onRetry = vi.fn()
    renderHouseholdView("admin-3", {
      onRetry,
      viewModel: fixture.viewModel,
    })

    expect(screen.getAllByRole("heading", { name: "Farhan Habib" })).toHaveLength(2)
    expect(screen.getByRole("alert").textContent).toContain("current list is still available")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("announces invitation errors in the dedicated alert notice", () => {
    renderHouseholdView("admin-3", {
      previewInvite: {
        status: "error",
        errorMessage: "No code was generated. Try again.",
      },
      onGeneratePreviewInvite: vi.fn(),
      onClosePreviewInvite: vi.fn(),
    })

    const alert = screen.getByRole("alert")
    expect(alert.className).toContain(styles.inviteErrorNotice)
    expect(alert.textContent).toContain("No code was generated. Try again.")
  })

  it("renders distinct loading, initial-error, and empty states", () => {
    const loading = createHouseholdPreviewFixture("loading")
    const { props } = renderHouseholdView("admin-3", { viewModel: loading.viewModel })
    expect(screen.getByLabelText("Loading household members")).toBeTruthy()

    cleanup()
    const error = createHouseholdPreviewFixture("error")
    renderHouseholdView("admin-3", { viewModel: error.viewModel })
    expect(screen.getByRole("alert").textContent).toContain("Unable to load household members")

    cleanup()
    const empty = createHouseholdPreviewFixture("owner-0")
    renderHouseholdView("owner-3", { viewModel: empty.viewModel })
    expect(screen.getByText("No household members found.")).toBeTruthy()
    expect(props.onRetry).not.toHaveBeenCalled()
  })

  it("uses the approved successor-selection presentation without submitting", () => {
    const onContinueOwnerLeave = vi.fn()
    const onSelectSuccessor = vi.fn()
    renderHouseholdView("owner-3", {
      leaveFlow: "owner-select",
      onContinueOwnerLeave,
      onSelectSuccessor,
    })

    expect(screen.getByRole("heading", { name: "Pass the keys." })).toBeTruthy()
    expect(
      screen.getByText(
        "Choose another active member to take ownership. You will leave 1501 in the next step.",
      ),
    ).toBeTruthy()
    expect(screen.getByText("New owner")).toBeTruthy()
    const continueButton = screen.getByRole("button", { name: "Continue" })
    expect(continueButton.hasAttribute("disabled")).toBe(true)

    fireEvent.click(screen.getByRole("radio", { name: /Salman/ }))
    expect(onSelectSuccessor).toHaveBeenCalledWith("preview-admin")
    expect(onContinueOwnerLeave).not.toHaveBeenCalled()
  })

  it("contains dialog focus, supports Escape, and restores focus to the leave trigger", () => {
    const { props, view } = renderHouseholdView("member-3")
    const leaveTrigger = screen.getByRole("button", { name: "Leave household" })

    fireEvent.click(leaveTrigger)
    view.rerender(<HouseholdScreenView {...props} leaveFlow="member-confirm" />)

    const dialog = screen.getByRole("dialog", { name: "Leave 1501?" })
    expect(dialog).toBeTruthy()
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Close leave household" }),
    )

    const closeButton = within(dialog).getByRole("button", { name: "Close leave household" })
    const leaveButton = within(dialog).getByRole("button", { name: "Leave household" })
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(leaveButton)
    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(closeButton)

    fireEvent.keyDown(document, { key: "Escape" })
    expect(props.onCloseLeave).toHaveBeenCalledOnce()
    view.rerender(<HouseholdScreenView {...props} leaveFlow="closed" />)
    expect(document.activeElement).toBe(leaveTrigger)
  })

  it("returns focus to the member action trigger after dismissing its dialog", () => {
    const fixture = createHouseholdPreviewFixture("admin-3")
    const member = fixture.viewModel.members.find((item) => item.userId === "preview-member")
    if (!member) throw new Error("Expected fixture member")

    const { props, view } = renderHouseholdView("admin-3", {
      openMemberMenuId: member.userId,
      viewModel: fixture.viewModel,
    })
    const removeButton = screen.getByRole("button", { name: "Remove from household" })
    removeButton.focus()
    fireEvent.click(removeButton)
    view.rerender(
      <HouseholdScreenView
        {...props}
        openMemberMenuId={null}
        pendingMemberAction={{ action: "remove", member }}
      />,
    )

    const dialog = screen.getByRole("dialog", { name: /Remove Farhan Habib from/ })
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Close member action" }),
    )
    fireEvent.keyDown(document, { key: "Escape" })
    view.rerender(<HouseholdScreenView {...props} openMemberMenuId={null} />)

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Actions for Farhan Habib" }),
    )
  })
})
