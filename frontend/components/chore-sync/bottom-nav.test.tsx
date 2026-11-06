// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BottomNav, type NavKey } from "./bottom-nav"
import styles from "./bottom-nav.module.css"

afterEach(cleanup)

describe("BottomNav", () => {
  it("uses the same redesigned icon geometry across destinations and explicit themes", () => {
    let referenceGeometry: string[] | undefined

    for (const theme of ["light", "dark"] as const) {
      for (const active of ["dashboard", "my-chores", "household", "profile"] as NavKey[]) {
        const { container, unmount } = render(
          <BottomNav
            active={active}
            ariaLabel="Preview navigation"
            navigate={vi.fn()}
            theme={theme}
          />,
        )
        const navigation = screen.getByRole("navigation", { name: "Preview navigation" })
        expect(navigation.getAttribute("data-theme")).toBe(theme)
        expect(
          navigation.querySelector(`.${styles.activeIsland}`)?.getAttribute("data-active"),
        ).toBe(active)
        expect(screen.getAllByRole("button")).toHaveLength(4)
        expect(
          screen
            .getByRole("button", {
              name:
                active === "dashboard"
                  ? "Home"
                  : active === "my-chores"
                    ? "My Chores"
                    : active === "household"
                      ? "Household"
                      : "Profile",
            })
            .getAttribute("aria-current"),
        ).toBe("page")

        const geometry = [...container.querySelectorAll("svg")].map((icon) =>
          [...icon.querySelectorAll("path")].map((path) => path.getAttribute("d")).join("|"),
        )
        referenceGeometry ??= geometry
        expect(geometry).toEqual(referenceGeometry)
        for (const path of container.querySelectorAll("path")) {
          expect(path.getAttribute("stroke")).toBe("currentColor")
          expect(path.getAttribute("stroke-width")).toBe("1.75")
        }
        unmount()
      }
    }
  })

  it("preserves navigation callback mapping and the primary navigation name by default", () => {
    const navigate = vi.fn()
    render(<BottomNav active="dashboard" navigate={navigate} />)

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "My Chores" }))
    expect(navigate).toHaveBeenCalledWith("my-chores")
    expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page")
  })
})
