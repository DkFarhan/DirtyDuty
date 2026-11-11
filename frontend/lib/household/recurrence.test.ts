import { describe, expect, it } from "vitest"
import {
  buildRecurrenceRule,
  defaultRecurrence,
  describeMonths,
  describeRecurrence,
  describeRecurrenceRule,
  parseRecurrenceRule,
} from "./recurrence"

const START = "2026-11-12"

describe("recurrence rules", () => {
  it.each([
    "FREQ=ONCE",
    "FREQ=DAILY",
    "FREQ=DAILY;INTERVAL=3",
    "FREQ=WEEKLY;BYDAY=MO",
    "FREQ=WEEKLY;BYDAY=MO,TH,SU",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR",
    "FREQ=WEEKLY;INTERVAL=52;BYDAY=SA",
    "FREQ=MONTHLY;BYMONTHDAY=15",
    "FREQ=MONTHLY;BYMONTHDAY=31",
    "FREQ=MONTHLY;BYMONTHDAY=-1",
    "FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU",
    "FREQ=MONTHLY;BYDAY=-1FR",
    "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14",
    "FREQ=YEARLY;INTERVAL=2;BYMONTH=2;BYMONTHDAY=29",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;BYMONTH=1,2,3,11,12;COUNT=10",
    "FREQ=DAILY;BYMONTH=12;COUNT=3",
    "FREQ=MONTHLY;BYMONTHDAY=1;BYMONTH=11,12;COUNT=10",
  ])("round-trips %s exactly", (rule) => {
    const parsed = parseRecurrenceRule(rule, START)
    expect(parsed).not.toBeNull()
    expect(buildRecurrenceRule(parsed!)).toBe(rule)
  })

  it("normalizes legacy weekday order and all-year seasonality without changing meaning", () => {
    expect(buildRecurrenceRule(parseRecurrenceRule("FREQ=WEEKLY;BYDAY=TH,MO", START)!)).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TH",
    )
    expect(
      buildRecurrenceRule(
        parseRecurrenceRule("FREQ=DAILY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12", START)!,
      ),
    ).toBe("FREQ=DAILY")
  })

  it("reads the legacy custom every-N-weeks rule as weekly with an interval", () => {
    expect(parseRecurrenceRule("FREQ=WEEKLY;INTERVAL=3;BYDAY=WE", START)).toMatchObject({
      frequency: "WEEKLY",
      interval: 3,
      weekdays: ["WE"],
    })
  })

  it.each([
    "",
    "FREQ=HOURLY",
    "FREQ=DAILY;UNTIL=20270101",
    "FREQ=DAILY;BYSETPOS=1",
    "FREQ=WEEKLY",
    "FREQ=WEEKLY;BYDAY=MO,MO",
    "FREQ=MONTHLY;BYDAY=5MO",
    "FREQ=MONTHLY;BYMONTHDAY=1;BYDAY=1MO",
    "FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31",
    "FREQ=YEARLY;BYMONTH=1,2;BYMONTHDAY=1",
    "FREQ=DAILY;INTERVAL=400",
    "FREQ=DAILY;COUNT=1000",
    "FREQ=ONCE;COUNT=1",
  ])("treats %s as a custom schedule it cannot edit", (rule) => {
    expect(parseRecurrenceRule(rule, START)).toBeNull()
  })

  it("derives defaults from the start date", () => {
    expect(defaultRecurrence("2027-01-29")).toMatchObject({
      frequency: "WEEKLY",
      interval: 1,
      weekdays: ["FR"],
      monthDay: 29,
      ordinal: -1,
      ordinalWeekday: "FR",
      yearMonth: 1,
      yearDay: 29,
    })
  })
})

describe("recurrence summaries", () => {
  it.each([
    ["FREQ=ONCE", "One time"],
    ["FREQ=DAILY", "Daily"],
    ["FREQ=DAILY;INTERVAL=3", "Every 3 days"],
    ["FREQ=WEEKLY;BYDAY=MO", "Weekly on Mon"],
    ["FREQ=WEEKLY;BYDAY=MO,TH", "Weekly on Mon and Thu"],
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU", "Weekly on every day"],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,TH", "Every 2 weeks on Mon, Wed and Thu"],
    [
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;BYMONTH=1,2,3,11,12;COUNT=10",
      "Every 2 weeks on Mon and Thu, Nov to Mar, 10 times",
    ],
    ["FREQ=MONTHLY;BYMONTHDAY=1", "Monthly on the 1st"],
    ["FREQ=MONTHLY;BYMONTHDAY=22", "Monthly on the 22nd"],
    ["FREQ=MONTHLY;BYMONTHDAY=-1", "Monthly on the last day"],
    ["FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU", "Every 2 months on the 2nd Tuesday"],
    ["FREQ=MONTHLY;BYDAY=-1FR", "Monthly on the last Friday"],
    ["FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14", "Yearly on Mar 14"],
    ["FREQ=DAILY;BYMONTH=6,8", "Daily, Jun and Aug"],
    ["FREQ=DAILY;COUNT=1", "Daily, once"],
    ["FREQ=DAILY;INTERVAL=400", "Custom schedule"],
  ])("describes %s as %s", (rule, summary) => {
    expect(describeRecurrenceRule(rule)).toBe(summary)
  })

  it("leaves out the day list while no weekday is chosen", () => {
    const weekly = { ...parseRecurrenceRule("FREQ=WEEKLY;BYDAY=MO", START)!, weekdays: [] }
    expect(describeRecurrence(weekly)).toBe("Weekly")
  })

  it("adds the end date when there is no count", () => {
    expect(describeRecurrence(parseRecurrenceRule("FREQ=DAILY", START)!, "2027-12-31")).toBe(
      "Daily, until Dec 31, 2027",
    )
  })

  it("collapses consecutive months, including across the new year", () => {
    expect(describeMonths([11, 12, 1, 2, 3])).toBe("Nov to Mar")
    expect(describeMonths([4, 5, 6])).toBe("Apr to Jun")
    expect(describeMonths([11, 12])).toBe("Nov and Dec")
    expect(describeMonths([1, 3, 6])).toBe("Jan, Mar and Jun")
    expect(describeMonths([])).toBe("")
  })
})
