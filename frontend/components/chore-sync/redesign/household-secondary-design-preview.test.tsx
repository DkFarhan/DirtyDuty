// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { HouseholdSecondaryDesignPreview } from "./household-secondary-design-preview"

afterEach(cleanup)

describe("Household secondary design proposals", () => {
  it("shows existing notification and active-invitation context in Settings", () => {
    render(<HouseholdSecondaryDesignPreview screen="household-settings" />)

    expect(screen.getByText(/shared household default.*personal style/i)).toBeTruthy()
    expect(screen.getByText("Created Oct 28, 2026")).toBeTruthy()
    expect(screen.getByText("Expires Nov 4, 2026")).toBeTruthy()
    expect(screen.getByText("Role on join · MEMBER")).toBeTruthy()
    expect(screen.getAllByText("ACTIVE")).toHaveLength(2)
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(2)
  })

  it("keeps details fields and the remaining form sections in workflow order for create and edit", () => {
    render(<HouseholdSecondaryDesignPreview screen="chore-form" />)

    const assertWorkflow = () => {
      const main = screen.getByRole("main")
      const sectionHeadings = within(main)
        .getAllByRole("heading", { level: 2 })
        .slice(1)
        .map((heading) => heading.textContent)
      expect(sectionHeadings).toEqual([
        "Name the routine",
        "Who takes this on?",
        "When should it happen?",
        "Set a helpful baseline",
      ])

      const fields = [
        screen.getByLabelText("Category"),
        screen.getByRole("button", { name: "Change" }),
        screen.getByLabelText("Chore name"),
        screen.getByLabelText("Description Optional"),
      ]
      for (let index = 0; index < fields.length - 1; index += 1) {
        expect(
          fields[index].compareDocumentPosition(fields[index + 1]) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
      }

      const effortSection = screen
        .getByRole("heading", { name: "Set a helpful baseline" })
        .closest("section")
      if (!(effortSection instanceof HTMLElement)) {
        throw new Error("Expected an Effort and Priority section.")
      }
      expect(within(effortSection).getByLabelText("Effort level")).toBeTruthy()
      expect(within(effortSection).getByLabelText("Priority")).toBeTruthy()
    }

    expect(screen.getByRole("heading", { name: "Create a chore" })).toBeTruthy()
    assertWorkflow()

    fireEvent.change(screen.getByLabelText("Form mode"), { target: { value: "edit" } })

    expect(screen.getByRole("heading", { name: "Edit a chore" })).toBeTruthy()
    assertWorkflow()
  })
})
