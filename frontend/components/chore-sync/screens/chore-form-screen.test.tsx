// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  dashboard: vi.fn(),
  archive: vi.fn(),
  navigate: vi.fn(),
  invalidate: vi.fn(),
  createCategory: vi.fn(),
  role: "OWNER",
  screen: "create-chore",
  editingChoreId: null as string | null,
  choreDraft: null as {
    title: string
    once?: { date: string; time: string }
    returnTo: string
  } | null,
}))

vi.mock("@/lib/chore-sync/store", () => ({
  useChoreSync: () => ({
    state: { currentUser: { id: "user-1" } },
    screen: mocks.screen,
    navigate: mocks.navigate,
    editingChoreId: mocks.editingChoreId,
    choreDraft: mocks.choreDraft,
    clearChoreDraft: vi.fn(),
  }),
}))

vi.mock("@/lib/household/household-context", () => ({
  useHouseholds: () => ({
    activeHousehold: {
      id: "home-1",
      name: "Real household",
      timezone: "America/Halifax",
      currentUserRole: mocks.role,
    },
  }),
}))

vi.mock("@/lib/household/chores", () => ({
  categoryIcon: () => "🧹",
  choreApi: {
    options: mocks.options,
    create: mocks.create,
    update: mocks.update,
    get: mocks.get,
    dashboard: mocks.dashboard,
    archive: mocks.archive,
  },
  categoryApi: { create: mocks.createCategory },
}))

vi.mock("@/lib/data-sync/data-sync-context", () => ({
  householdChoreResource: (id: string) => `${id}:chores`,
  useDataSync: () => ({ invalidate: mocks.invalidate }),
}))

import { ApiError } from "@/lib/auth/api"
import { ChoreFormScreen } from "./chore-form-screen"

const category = (id: string, name: string) => ({
  id,
  name,
  iconKey: name.toLowerCase(),
  sortOrder: 0,
  createdAt: "2026-10-01T00:00:00Z",
  choreCount: 0,
})
const threeMembers = [
  { userId: "user-1", displayName: "Farhan" },
  { userId: "user-2", displayName: "Rubayet" },
  { userId: "user-3", displayName: "Abubakar" },
]

function optionsWith(activeMembers = threeMembers) {
  return {
    categories: [category("cat-kitchen", "Kitchen"), category("cat-trash", "Trash")],
    activeMembers,
  }
}

const nameInput = () => screen.getByLabelText("What needs doing?") as HTMLInputElement
const createButton = () => screen.getByRole("button", { name: "Create chore" }) as HTMLButtonElement
const row = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}:`) })
const sentRequest = () => mocks.create.mock.calls[0][1]

async function renderForm() {
  render(<ChoreFormScreen theme="dark" />)
  // The first render also pays for importing the form, so allow it longer than the default.
  await screen.findByLabelText("What needs doing?", undefined, { timeout: 5_000 })
}

describe("ChoreFormScreen · quick create", () => {
  beforeEach(() => {
    // Saturday, November 14 2026, 9 AM in Halifax.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-14T13:00:00Z"))
    mocks.options.mockReset().mockResolvedValue(optionsWith())
    mocks.create.mockReset().mockResolvedValue({ id: "chore-new" })
    mocks.update.mockReset().mockResolvedValue({ id: "chore-1" })
    mocks.get.mockReset()
    mocks.dashboard.mockReset().mockResolvedValue({ today: [], thisWeek: [], overdue: [] })
    mocks.archive.mockReset().mockResolvedValue({})
    mocks.navigate.mockReset()
    mocks.invalidate.mockReset()
    mocks.createCategory.mockReset()
    mocks.role = "OWNER"
    mocks.screen = "create-chore"
    mocks.editingChoreId = null
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("shows the page shell with defaults and focuses the name", async () => {
    await renderForm()
    expect(screen.getByRole("heading", { name: "Create a chore" })).toBeTruthy()
    expect(screen.getByText("Real household")).toBeTruthy()
    expect(screen.getByText("Household · New routine")).toBeTruthy()
    expect(document.activeElement).toBe(nameInput())
    expect(row("How often").textContent).toContain("Every week · Sat")
    expect(row("Who").textContent).toContain("Take turns · everyone")
    expect(row("Category").textContent).toContain("From the name")
    expect(row("More options").textContent).toContain("Optional")
    expect(createButton().disabled).toBe(true)
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy()
  })

  it("creates a chore from a Popular chip with the suggestion's full setup", async () => {
    await renderForm()
    const popular = screen.getByRole("list", { name: "Popular" })
    expect(within(popular).getAllByRole("button")).toHaveLength(6)
    fireEvent.click(within(popular).getByRole("button", { name: "Take out garbage" }))

    expect(nameInput().value).toBe("Take out garbage")
    expect(screen.getByTestId("chore-summary").textContent).toBe(
      "When it's needed, at least 2 days after it was last done. Turns between you, Rubayet and Abubakar.",
    )
    expect(row("How often").textContent).toContain("When needed · 2 days")
    expect(row("Category").textContent).toContain("Trash")
    fireEvent.click(createButton())

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(mocks.create).toHaveBeenCalledWith("home-1", {
      title: "Take out garbage",
      description: null,
      categoryId: "cat-trash",
      defaultPriority: "NORMAL",
      difficulty: 2,
      estimatedMinutes: 5,
      requiresVerification: false,
      schedule: {
        recurrenceRule: null,
        timezone: "America/Halifax",
        startsOn: "2026-11-14",
        endsOn: null,
        dueTime: "20:00",
        assignmentStrategy: "ROUND_ROBIN",
        peopleNeeded: 1,
        fixedAssigneeUserId: null,
        participantUserIds: ["user-1", "user-2", "user-3"],
        everyone: true,
        rotationWeeks: null,
        kind: "AS_NEEDED",
        intervalCount: null,
        intervalUnit: null,
        backstopEnabled: true,
        backstopDays: 2,
      },
    })
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(mocks.navigate).toHaveBeenCalledWith("admin", "chores")
  })

  it("suggests matching chores while typing and fills everything from one", async () => {
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "garbage" } })

    const list = screen.getByRole("list", { name: "Suggestions" })
    const options = within(list).getAllByRole("button")
    expect(options).toHaveLength(3)
    expect(options[0].querySelector("strong")?.textContent).toBe("garbage")
    expect(screen.queryByTestId("chore-summary")).toBeNull()
    expect(screen.queryByRole("list", { name: "Popular" })).toBeNull()
    // The guess already follows the name.
    expect(row("Category").textContent).toContain("Trash")

    fireEvent.click(within(list).getByRole("button", { name: /^Use Clean garbage bin/ }))
    expect(nameInput().value).toBe("Clean garbage bin")
    expect(screen.queryByRole("list", { name: "Suggestions" })).toBeNull()
    expect(row("How often").textContent).toContain("Every month · 14th")

    // Editing the name afterwards keeps the setup.
    fireEvent.change(nameInput(), { target: { value: "Clean garbage bin outside" } })
    fireEvent.keyDown(nameInput(), { key: "Enter" })
    expect(row("How often").textContent).toContain("Every month · 14th")
    fireEvent.click(createButton())
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(sentRequest()).toMatchObject({
      title: "Clean garbage bin outside",
      schedule: { recurrenceRule: "FREQ=MONTHLY;BYMONTHDAY=14", kind: "CALENDAR" },
    })
  })

  it("keeps Create disabled for a name of only spaces and sends one request on a double tap", async () => {
    let resolve: (value: unknown) => void = () => {}
    mocks.create.mockReturnValue(new Promise((done) => (resolve = done)))
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "    " } })
    expect(createButton().disabled).toBe(true)

    fireEvent.change(nameInput(), { target: { value: "  Sweep the porch  " } })
    fireEvent.keyDown(nameInput(), { key: "Escape" })
    expect(screen.getByTestId("chore-summary").textContent).toBe(
      "Every week on Saturday by 6 PM. Turns between you, Rubayet and Abubakar.",
    )
    const button = createButton()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeTruthy()
    resolve({ id: "chore-new" })
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("admin", "chores"))
    expect(sentRequest()).toMatchObject({
      title: "Sweep the porch",
      categoryId: null,
      schedule: { recurrenceRule: "FREQ=WEEKLY;BYDAY=SA", dueTime: "18:00" },
    })
  })

  it("keeps the user's input and shows a failed save in the footer", async () => {
    mocks.create.mockRejectedValue(
      new ApiError("This schedule never produces a date.", 400, "validation"),
    )
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "Vacuum stairs" } })
    fireEvent.click(createButton())
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This schedule never produces a date.",
    )
    expect(nameInput().value).toBe("Vacuum stairs")
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(createButton().disabled).toBe(false)
  })

  it("opens How often with tap-once options and inline settings", async () => {
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "Water the plants" } })
    fireEvent.click(row("How often"))
    const sheet = screen.getByRole("dialog", { name: "How often?" })
    expect(
      within(sheet)
        .getByRole("button", { name: /Every week/ })
        .getAttribute("aria-pressed"),
    ).toBe("true")

    fireEvent.click(within(sheet).getByRole("button", { name: /Every few days, after it's done/ }))
    fireEvent.click(within(sheet).getByRole("button", { name: "More (Interval after it's done)" }))
    expect(
      within(sheet).getByRole("group", { name: "Interval after it's done" }).textContent,
    ).toContain("4days")
    fireEvent.click(within(sheet).getByRole("button", { name: /When it's needed/ }))
    // On create the time is for the first one only; later deadlines roll from each completion.
    expect(within(sheet).getByLabelText("First one due by")).toBeTruthy()
    expect(within(sheet).queryByLabelText("Next one due by")).toBeNull()
    fireEvent.click(within(sheet).getByRole("button", { name: "No deadline" }))
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }))

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(row("How often").textContent).toContain("When needed · No deadline")
    fireEvent.click(createButton())
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(sentRequest().schedule).toMatchObject({
      kind: "AS_NEEDED",
      backstopEnabled: false,
      backstopDays: null,
      dueTime: null,
    })
  })

  it("opens Custom… as a sub-view; back keeps the choice, Use this schedule applies it", async () => {
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "Recycling" } })
    fireEvent.click(row("How often"))
    fireEvent.click(screen.getByRole("button", { name: /Custom…/ }))
    const custom = screen.getByRole("dialog", { name: "Custom schedule" })
    expect(
      within(custom).getByRole("button", { name: "Saturday" }).getAttribute("aria-pressed"),
    ).toBe("true")
    fireEvent.click(within(custom).getByRole("button", { name: "Thursday" }))
    fireEvent.click(within(custom).getByRole("button", { name: "Back" }))

    // Back without applying leaves the schedule as it was.
    expect(screen.getByRole("dialog", { name: "How often?" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(row("How often").textContent).toContain("Every week · Sat")

    fireEvent.click(row("How often"))
    fireEvent.click(screen.getByRole("button", { name: /Custom…/ }))
    const again = screen.getByRole("dialog", { name: "Custom schedule" })
    fireEvent.click(within(again).getByRole("button", { name: "Monthly" }))
    fireEvent.click(within(again).getByRole("button", { name: "Weekday" }))
    fireEvent.change(within(again).getByLabelText("Which one"), { target: { value: "-1" } })
    fireEvent.change(within(again).getByLabelText("Weekday"), { target: { value: "FR" } })
    expect(within(again).getByTestId("custom-summary").textContent).toBe(
      "Monthly on the last Friday at 6 PM",
    )
    fireEvent.click(within(again).getByRole("button", { name: "Use this schedule" }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))

    expect(row("How often").textContent).toContain("Custom · Monthly on the last Friday")
    fireEvent.click(createButton())
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(sentRequest().schedule).toMatchObject({
      recurrenceRule: "FREQ=MONTHLY;BYDAY=-1FR",
      kind: "CALENDAR",
    })
  })

  it("chooses Week by week with a custom length and hides it for When it's needed", async () => {
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "Wash dishes" } })
    fireEvent.click(row("Who"))
    const sheet = screen.getByRole("dialog", { name: "Who does it?" })
    const option = within(sheet).getByRole("button", { name: /Week by week/ })
    expect(option.textContent).toContain("One person owns it for a week or two, then the next")
    fireEvent.click(option)
    expect(within(sheet).getByTestId("weeks-explanation").textContent).toBe(
      "One person for 2 weeks, then the nextGood when someone should own it: dishes, the kitchen, the bathroom. Switches on Mondays.",
    )
    expect(within(sheet).getByRole("button", { name: "Change" })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole("button", { name: "1 week" }))
    expect(within(sheet).getByTestId("weeks-explanation").textContent).toContain(
      "One person all week, then the next",
    )
    fireEvent.click(within(sheet).getByRole("button", { name: "Custom" }))
    fireEvent.click(within(sheet).getByRole("button", { name: "More (Each person has it for)" }))
    fireEvent.click(within(sheet).getByRole("button", { name: "More (Each person has it for)" }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(row("Who").textContent).toContain("Week by week · 3 weeks")
    expect(screen.getByTestId("chore-summary").textContent).toContain(
      "Week by week: each person has it for 3 weeks, between you, Rubayet and Abubakar.",
    )

    fireEvent.click(createButton())
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(sentRequest().schedule).toMatchObject({
      assignmentStrategy: "ROUND_ROBIN",
      peopleNeeded: 1,
      everyone: true,
      rotationWeeks: 3,
    })

    fireEvent.click(row("How often"))
    fireEvent.click(screen.getByRole("button", { name: /When it's needed/ }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(row("Who").textContent).toContain("Take turns · everyone")
    fireEvent.click(row("Who"))
    expect(
      within(screen.getByRole("dialog", { name: "Who does it?" })).queryByRole("button", {
        name: /Week by week/,
      }),
    ).toBeNull()
  })

  it("opens Who, changes the rotation order, and disables Mix it up for When it's needed", async () => {
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "Take out recycling" } })
    fireEvent.keyDown(nameInput(), { key: "Enter" })
    fireEvent.click(row("How often"))
    fireEvent.click(screen.getByRole("button", { name: /When it's needed/ }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))

    fireEvent.click(row("Who"))
    const sheet = screen.getByRole("dialog", { name: "Who does it?" })
    const mix = within(sheet).getByRole("button", { name: /Mix it up/ }) as HTMLButtonElement
    expect(mix.disabled).toBe(true)
    expect(mix.textContent).toContain("Not available for chores done when needed")

    fireEvent.click(within(sheet).getByRole("button", { name: "Change" }))
    const people = screen.getByRole("dialog", { name: "Who takes turns?" })
    fireEvent.click(within(people).getByRole("checkbox", { name: /Rubayet/ }))
    fireEvent.click(within(people).getByRole("button", { name: "Move Abubakar up" }))
    expect(within(people).getByRole("checkbox", { name: /Abubakar/ }).textContent).toContain("1st")
    fireEvent.click(within(people).getByRole("button", { name: "Done" }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))

    expect(row("Who").textContent).toContain("Take turns · 2 people")
    fireEvent.click(createButton())
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(sentRequest().schedule).toMatchObject({
      assignmentStrategy: "ROUND_ROBIN",
      participantUserIds: ["user-3", "user-1"],
    })
  })

  it("keeps at least one person in a rotation and picks one specific person", async () => {
    mocks.options.mockResolvedValue(optionsWith(threeMembers.slice(0, 2)))
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "Mow the lawn" } })
    fireEvent.click(row("Who"))
    fireEvent.click(screen.getByRole("button", { name: "Change" }))
    const people = screen.getByRole("dialog", { name: "Who takes turns?" })
    fireEvent.click(within(people).getByRole("checkbox", { name: /Farhan/ }))
    fireEvent.click(within(people).getByRole("checkbox", { name: /Rubayet/ }))
    expect(within(people).getByRole("alert").textContent).toBe("Keep at least one person.")
    expect(
      within(people)
        .getByRole("checkbox", { name: /Rubayet/ })
        .getAttribute("aria-checked"),
    ).toBe("true")

    fireEvent.click(within(people).getByRole("button", { name: "Back" }))
    fireEvent.click(screen.getByRole("button", { name: /Specific people/ }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Rubayet" }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(row("Who").textContent).toContain("Rubayet")
  })

  it("creates a rotation with two people each time", async () => {
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "Deep clean kitchen" } })
    fireEvent.click(row("Who"))
    const sheet = screen.getByRole("dialog", { name: "Who does it?" })
    const each = within(sheet).getByRole("group", { name: "Each time" })
    expect(within(each).getAllByRole("button")).toHaveLength(2)
    fireEvent.click(within(each).getByRole("button", { name: "2 people" }))
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }))
    expect(row("Who").textContent).toContain("Take turns · 2 at a time")
    expect(screen.getByText(/Two people each time/)).toBeTruthy()
    fireEvent.click(createButton())
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(sentRequest().schedule).toMatchObject({
      assignmentStrategy: "ROUND_ROBIN",
      peopleNeeded: 2,
      fixedAssigneeUserId: null,
      participantUserIds: ["user-1", "user-2", "user-3"],
    })
  })

  it("creates a chore two specific people do together", async () => {
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "Move the sofa" } })
    fireEvent.click(row("Who"))
    fireEvent.click(screen.getByRole("button", { name: /Specific people/ }))
    const people = screen.getByRole("dialog", { name: "Who does it?" })
    fireEvent.click(within(people).getByRole("checkbox", { name: /Farhan/ }))
    fireEvent.click(within(people).getByRole("checkbox", { name: "Rubayet" }))
    fireEvent.click(within(people).getByRole("button", { name: "Done" }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(row("Who").textContent).toContain("Farhan & Rubayet")
    fireEvent.click(createButton())
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(sentRequest().schedule).toMatchObject({
      assignmentStrategy: "FIXED",
      peopleNeeded: 2,
      fixedAssigneeUserId: null,
      participantUserIds: ["user-1", "user-2"],
    })
  })

  it("hides Each time for When it's needed", async () => {
    await renderForm()
    fireEvent.click(row("How often"))
    fireEvent.click(screen.getByRole("button", { name: /When it's needed/ }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    fireEvent.click(row("Who"))
    const sheet = screen.getByRole("dialog", { name: "Who does it?" })
    expect(
      within(sheet)
        .getByRole("button", { name: /Take turns/ })
        .getAttribute("aria-pressed"),
    ).toBe("true")
    expect(within(sheet).queryByRole("group", { name: "Each time" })).toBeNull()
  })

  it("defaults to Just me in a single-member household", async () => {
    mocks.options.mockResolvedValue(optionsWith(threeMembers.slice(0, 1)))
    await renderForm()
    expect(row("Who").textContent).toContain("Just me")
    fireEvent.click(screen.getByRole("button", { name: "Vacuum" }))
    expect(row("Who").textContent).toContain("Just me")
    fireEvent.click(createButton())
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(sentRequest().schedule).toMatchObject({
      assignmentStrategy: "FIXED",
      fixedAssigneeUserId: "user-1",
      participantUserIds: [],
    })
  })

  it("opens Category; a picked category is never overridden by the name", async () => {
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "Wash dishes" } })
    expect(row("Category").textContent).toContain("Kitchen")
    expect(row("Category").textContent).toContain("From the name")
    fireEvent.click(row("Category"))
    const sheet = screen.getByRole("dialog", { name: "Category" })
    expect(within(sheet).getByRole("button", { name: /None/ })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole("button", { name: /Trash/ }))

    expect(screen.queryByRole("dialog")).toBeNull()
    fireEvent.change(nameInput(), { target: { value: "Wash kitchen dishes" } })
    expect(row("Category").textContent).toContain("Trash")
    expect(row("Category").textContent).not.toContain("From the name")
  })

  it("expands More options and sends priority, effort, minutes, notes and the check", async () => {
    await renderForm()
    fireEvent.change(nameInput(), { target: { value: "Deep clean oven" } })
    fireEvent.click(row("More options"))
    expect(row("More options").getAttribute("aria-expanded")).toBe("true")
    const more = screen.getByRole("region", { name: "More options" })
    fireEvent.click(within(more).getByRole("button", { name: "High" }))
    fireEvent.click(within(more).getByRole("button", { name: "Effort 4: Heavy" }))
    fireEvent.click(within(more).getByRole("button", { name: "More (Takes about)" }))
    fireEvent.click(within(more).getByRole("button", { name: "More (Takes about)" }))
    fireEvent.change(within(more).getByLabelText("Notes"), { target: { value: "Gloves on" } })
    fireEvent.click(within(more).getByRole("switch", { name: /Ask for a quick check/ }))
    expect(row("More options").textContent).toContain("High · Heavy · 10 min")

    fireEvent.click(createButton())
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    expect(sentRequest()).toMatchObject({
      defaultPriority: "HIGH",
      difficulty: 4,
      estimatedMinutes: 10,
      description: "Gloves on",
      requiresVerification: true,
    })
  })

  it("asks before discarding a changed form", async () => {
    await renderForm()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(mocks.navigate).toHaveBeenCalledWith("admin", "chores")
    mocks.navigate.mockReset()

    fireEvent.change(nameInput(), { target: { value: "Something" } })
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(nameInput().value).toBe("Something")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(mocks.navigate).toHaveBeenCalledWith("admin", "chores")
  })

  describe("new category", () => {
    it("creates a category from the Category sheet and selects it", async () => {
      mocks.createCategory.mockResolvedValue(category("cat-pets", "Pets"))
      await renderForm()
      fireEvent.change(nameInput(), { target: { value: "Feed the cat" } })
      fireEvent.click(row("Category"))
      fireEvent.click(screen.getByRole("button", { name: /New category/ }))

      const dialog = screen.getByRole("dialog", { name: "New category" })
      fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Pets" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Pets" }))
      fireEvent.click(within(dialog).getByRole("button", { name: "Add category" }))

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
      expect(mocks.createCategory).toHaveBeenCalledWith("home-1", { name: "Pets", iconKey: "pets" })
      expect(row("Category").textContent).toContain("Pets")
      expect(nameInput().value).toBe("Feed the cat")
      expect(mocks.invalidate).toHaveBeenCalled()
      fireEvent.click(createButton())
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
      expect(sentRequest()).toMatchObject({ categoryId: "cat-pets" })
    })

    it("does not offer a new category to members", async () => {
      mocks.role = "MEMBER"
      await renderForm()
      fireEvent.click(row("Category"))
      expect(screen.queryByRole("button", { name: /New category/ })).toBeNull()
    })
  })

  describe("edit", () => {
    const savedChore = {
      id: "chore-1",
      householdId: "home-1",
      categoryId: "cat-trash",
      title: "Take out garbage",
      description: "Bags under the sink",
      defaultPriority: "NORMAL",
      difficulty: 2,
      estimatedMinutes: 5,
      requiresVerification: false,
      active: true,
      archivedAt: null,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      schedule: {
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;BYSETPOS=1",
        timezone: "America/Halifax",
        startsOn: "2026-10-05",
        endsOn: null,
        dueTime: "20:00:00",
        assignmentStrategy: "ROUND_ROBIN",
        peopleNeeded: 1,
        fixedAssigneeUserId: null,
        participantUserIds: ["user-1", "user-2", "user-gone"],
        active: true,
      },
    }

    beforeEach(() => {
      mocks.screen = "edit-chore"
      mocks.editingChoreId = "chore-1"
      mocks.get.mockResolvedValue(savedChore)
      mocks.dashboard.mockResolvedValue({
        today: [],
        thisWeek: [],
        overdue: [],
        householdJobs: [
          {
            id: "a-1",
            choreId: "chore-1",
            status: "PENDING",
            scheduledFor: "2026-11-16",
            dueAt: "2026-11-17T00:00:00Z",
            assignees: [{ userId: "user-2", displayName: "Rubayet" }],
            turn: { userId: "user-1", displayName: "Farhan" },
            lastDone: {
              at: "2026-11-13T12:00:00Z",
              byUserId: "user-2",
              byDisplayName: "Rubayet",
            },
          },
        ],
      })
    })

    it("prefills the form and hero, and sends a custom rule back unchanged", async () => {
      await renderForm()
      expect(screen.getByRole("heading", { name: "Edit a chore" })).toBeTruthy()
      expect(nameInput().value).toBe("Take out garbage")
      expect(document.activeElement).not.toBe(nameInput())
      expect(screen.getByRole("heading", { name: "Take out garbage" })).toBeTruthy()
      expect(await screen.findByText("Your turn")).toBeTruthy()
      expect(screen.getByText("Due Mon, Nov 16 by 8:00 PM")).toBeTruthy()
      expect(screen.getByText("Last done yesterday by Rubayet")).toBeTruthy()
      expect(screen.queryByRole("list", { name: "Popular" })).toBeNull()
      expect(row("How often").textContent).toContain("Custom")
      expect(row("Who").textContent).toContain("Take turns · 2 people")
      expect(screen.getByText(/Someone who left the household was taken off/)).toBeTruthy()
      expect(row("More options").textContent).toContain("Normal · Light · 5 min")
      expect(
        screen.getByText("Changes apply to upcoming chores. Completed ones stay as they are."),
      ).toBeTruthy()

      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
      expect(mocks.update).toHaveBeenCalledWith(
        "home-1",
        "chore-1",
        expect.objectContaining({
          title: "Take out garbage",
          description: "Bags under the sink",
          schedule: expect.objectContaining({
            recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;BYSETPOS=1",
            startsOn: "2026-10-05",
            dueTime: "20:00",
            participantUserIds: ["user-1", "user-2"],
          }),
        }),
      )
    })

    it("labels a When needed time as the next deadline when editing", async () => {
      mocks.get.mockResolvedValue({
        ...savedChore,
        schedule: {
          ...savedChore.schedule,
          kind: "AS_NEEDED",
          recurrenceRule: null,
          backstopDays: 2,
          intervalCount: null,
          intervalUnit: null,
          participantUserIds: ["user-1", "user-2"],
        },
      })
      await renderForm()
      expect(row("How often").textContent).toContain("When needed · 2 days")
      fireEvent.click(row("How often"))
      const sheet = screen.getByRole("dialog", { name: "How often?" })
      expect(within(sheet).getByLabelText("Next one due by")).toBeTruthy()
      expect(within(sheet).queryByLabelText("First one due by")).toBeNull()
    })

    it("prefills a two-person rotation and saves it unchanged", async () => {
      mocks.get.mockResolvedValue({
        ...savedChore,
        schedule: {
          ...savedChore.schedule,
          recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
          peopleNeeded: 2,
          participantUserIds: ["user-1", "user-2", "user-3"],
        },
      })
      await renderForm()
      expect(row("Who").textContent).toContain("Take turns · 2 at a time")
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1))
      expect(mocks.update.mock.calls[0][2].schedule).toMatchObject({
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
        assignmentStrategy: "ROUND_ROBIN",
        peopleNeeded: 2,
        fixedAssigneeUserId: null,
        participantUserIds: ["user-1", "user-2", "user-3"],
      })
    })

    it("archives after confirmation", async () => {
      await renderForm()
      fireEvent.click(screen.getByRole("button", { name: "Archive chore" }))
      const dialog = screen.getByRole("dialog", { name: "Archive chore?" })
      expect(dialog.textContent).toContain("Its history will be preserved.")
      fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }))
      await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith("home-1", "chore-1"))
      expect(mocks.navigate).toHaveBeenCalledWith("admin", "chores")
    })

    it("still edits when the hero details can't be loaded", async () => {
      mocks.dashboard.mockRejectedValue(new Error("offline"))
      mocks.get.mockResolvedValue({
        ...savedChore,
        schedule: { ...savedChore.schedule, recurrenceRule: "FREQ=DAILY" },
      })
      await renderForm()
      expect(row("How often").textContent).toContain("Every day")
      expect(screen.queryByText("Your turn")).toBeNull()
      expect(
        screen.getByText("Update the details together. Changes will apply to future turns."),
      ).toBeTruthy()
    })
  })
})
