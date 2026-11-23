"use client"

import { useState, type ReactNode } from "react"
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Scale,
  Shuffle,
  UserRound,
  UsersRound,
} from "lucide-react"
import {
  allowsGroups,
  eachTimeRange,
  ordinalDay,
  specificLabel,
  withField,
  withParticipants,
  type Member,
  type QuickValues,
  type WhoChoice,
} from "@/lib/household/chore-quick-form"
import { Avatar, FormSheet, Stepper, type FormTheme } from "./form-sheet"
import styles from "./chore-form.module.css"

type Panel = "main" | "people" | "someone"

function nameFor(member: Member, viewerId: string) {
  return member.userId === viewerId ? `${member.displayName} (you)` : member.displayName
}

/** Segments for up to this many "Each time" values; a stepper beyond that. */
const MAX_SEGMENTS = 5

/**
 * "Who does it?": Just me, Take turns (with a people-and-order picker), Balanced, Specific people,
 * or Mix it up. Only combinations the backend accepts are offered: "When it's needed" chores rotate
 * or have one fixed person, and only calendar kinds have more than one person each time.
 */
export function WhoSheet({
  values,
  members,
  viewerId,
  removedMembers,
  theme,
  onChange,
  onClose,
  returnFocusTo,
}: {
  values: QuickValues
  members: Member[]
  viewerId: string
  removedMembers: number
  theme: FormTheme
  onChange: (values: QuickValues) => void
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}) {
  const [panel, setPanel] = useState<Panel>("main")
  const [peopleError, setPeopleError] = useState<string | null>(null)
  const asNeeded = values.often === "AS_NEEDED"
  const groups = allowsGroups(values.often)
  const active = new Set(members.map((member) => member.userId))
  const people = values.participants.filter((userId) => active.has(userId))
  const specific =
    values.who === "SOMEONE" ? values.specificPeople.filter((userId) => active.has(userId)) : []
  const memberById = (userId: string) => members.find((member) => member.userId === userId)

  const set = (who: WhoChoice, patch: Partial<QuickValues> = {}) =>
    onChange(withField(values, "who", { who, ...patch }))
  const choose = (who: WhoChoice) => {
    if (who === "ME") set("ME", { peopleNeeded: 1 })
    else if (who === "SOMEONE") {
      setPeopleError(null)
      setPanel("someone")
    } else {
      // A rotation or random pool starts with everyone if nobody is chosen yet.
      const pool = people.length > 0 ? people : members.map((member) => member.userId)
      set(who, { participants: pool, peopleNeeded: values.who === who ? values.peopleNeeded : 1 })
    }
  }

  if (panel === "people") {
    const ordered = [
      ...people,
      ...members.map((member) => member.userId).filter((userId) => !people.includes(userId)),
    ]
    const rotation = values.who === "TURNS"
    const balanced = values.who === "BALANCED"
    const toggle = (userId: string) => {
      const selected = people.includes(userId)
      if (selected && people.length <= 1) {
        setPeopleError("Keep at least one person.")
        return
      }
      setPeopleError(null)
      onChange(
        withParticipants(
          values,
          selected ? people.filter((id) => id !== userId) : [...people, userId],
          members,
        ),
      )
    }
    const move = (index: number, by: -1 | 1) => {
      const next = [...people]
      const [item] = next.splice(index, 1)
      next.splice(index + by, 0, item)
      set(values.who, { participants: next })
    }
    return (
      <FormSheet
        footer={
          <button className={styles.sheetPrimary} onClick={() => setPanel("main")} type="button">
            Done
          </button>
        }
        intro={
          rotation
            ? "Tick everyone who takes a turn. The order is who goes first."
            : balanced
              ? "Tick everyone it can go to."
              : "Tick everyone it can be picked from."
        }
        key={panel}
        onBack={() => setPanel("main")}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
        theme={theme}
        title={rotation ? "Who takes turns?" : balanced ? "Who's included?" : "Who can be picked?"}
      >
        <div aria-label={rotation ? "Rotation order" : "People"} role="group">
          {ordered.map((userId) => {
            const member = memberById(userId)
            if (!member) return null
            const index = people.indexOf(userId)
            const selected = index >= 0
            return (
              <div className={styles.memberRow} key={userId}>
                <button
                  aria-checked={selected}
                  className={styles.memberToggle}
                  onClick={() => toggle(userId)}
                  role="checkbox"
                  type="button"
                >
                  <span aria-hidden="true" className={styles.checkbox}>
                    {selected && <Check size={14} strokeWidth={3} />}
                  </span>
                  <span>
                    {nameFor(member, viewerId)}
                    {rotation && selected && (
                      <span className={styles.order}> · {ordinalDay(index + 1)}</span>
                    )}
                  </span>
                </button>
                {rotation && (
                  <>
                    <button
                      aria-label={`Move ${member.displayName} up`}
                      className={styles.moveButton}
                      disabled={!selected || index === 0}
                      onClick={() => move(index, -1)}
                      type="button"
                    >
                      <ArrowUp aria-hidden="true" size={17} />
                    </button>
                    <button
                      aria-label={`Move ${member.displayName} down`}
                      className={styles.moveButton}
                      disabled={!selected || index === people.length - 1}
                      onClick={() => move(index, 1)}
                      type="button"
                    >
                      <ArrowDown aria-hidden="true" size={17} />
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
        {peopleError && (
          <p className={styles.sheetError} role="alert">
            {peopleError}
          </p>
        )}
      </FormSheet>
    )
  }

  if (panel === "someone" && groups) {
    const toggle = (userId: string) => {
      const selected = specific.includes(userId)
      if (selected && specific.length <= 1) {
        setPeopleError("Keep at least one person.")
        return
      }
      setPeopleError(null)
      set("SOMEONE", {
        specificPeople: selected ? specific.filter((id) => id !== userId) : [...specific, userId],
      })
    }
    return (
      <FormSheet
        footer={
          <button className={styles.sheetPrimary} onClick={() => setPanel("main")} type="button">
            Done
          </button>
        }
        intro="Tick everyone who does it. They all do it together, every time."
        key={panel}
        onBack={() => setPanel("main")}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
        theme={theme}
        title="Who does it?"
      >
        <div aria-label="Household members" role="group">
          {members.map((member) => {
            const checked = specific.includes(member.userId)
            return (
              <div
                className={styles.memberRow}
                key={member.userId}
                style={{ gridTemplateColumns: "1fr" }}
              >
                <button
                  aria-checked={checked}
                  className={styles.memberToggle}
                  onClick={() => toggle(member.userId)}
                  role="checkbox"
                  type="button"
                >
                  <span aria-hidden="true" className={styles.checkbox}>
                    {checked && <Check size={14} strokeWidth={3} />}
                  </span>
                  {nameFor(member, viewerId)}
                </button>
              </div>
            )
          })}
        </div>
        {peopleError && (
          <p className={styles.sheetError} role="alert">
            {peopleError}
          </p>
        )}
      </FormSheet>
    )
  }

  if (panel === "someone") {
    return (
      <FormSheet
        intro="Always the same person. Chores done after they're done or when needed have one person."
        key={panel}
        onBack={() => setPanel("main")}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
        theme={theme}
        title="Who does it?"
      >
        <div aria-label="Household members" role="radiogroup">
          {members.map((member) => {
            const checked = specific[0] === member.userId
            return (
              <div
                className={styles.memberRow}
                key={member.userId}
                style={{ gridTemplateColumns: "1fr" }}
              >
                <button
                  aria-checked={checked}
                  className={styles.memberToggle}
                  onClick={() => {
                    set("SOMEONE", { specificPeople: [member.userId] })
                    setPanel("main")
                  }}
                  role="radio"
                  type="button"
                >
                  <span aria-hidden="true" className={styles.radio}>
                    {checked && <Check size={13} strokeWidth={3} />}
                  </span>
                  {nameFor(member, viewerId)}
                </button>
              </div>
            )
          })}
        </div>
      </FormSheet>
    )
  }

  const maxEach = eachTimeRange(values, members)
  const each = Math.min(Math.max(1, values.peopleNeeded), maxEach)
  const setEach = (peopleNeeded: number) => set(values.who, { peopleNeeded })
  const eachTime =
    groups && maxEach >= 2 ? (
      <div className={styles.eachTime}>
        <p className={styles.panelLabel} id="who-each-time">
          Each time
        </p>
        {maxEach <= MAX_SEGMENTS ? (
          <div
            aria-labelledby="who-each-time"
            className={styles.segmented}
            role="group"
            style={{ ["--segments" as string]: maxEach }}
          >
            {Array.from({ length: maxEach }, (_, index) => index + 1).map((count) => (
              <button
                aria-label={count === 1 ? "1 person" : `${count} people`}
                aria-pressed={each === count}
                className={styles.segment}
                key={count}
                onClick={() => setEach(count)}
                type="button"
              >
                {count}
              </button>
            ))}
          </div>
        ) : (
          <Stepper
            canDecrease={each > 1}
            canIncrease={each < maxEach}
            label="Each time"
            onDecrease={() => setEach(each - 1)}
            onIncrease={() => setEach(each + 1)}
            unit={each === 1 ? "person" : "people"}
            value={each}
          />
        )}
      </div>
    ) : null

  const peopleSummary = (
    <div className={styles.optionPanel}>
      <div className={styles.people}>
        <span className={styles.avatars}>
          {people.slice(0, 4).map((userId) => (
            <Avatar
              index={members.findIndex((member) => member.userId === userId)}
              key={userId}
              name={memberById(userId)?.displayName ?? "?"}
            />
          ))}
        </span>
        <span className={styles.peopleNames}>
          {people.length === 0
            ? "Nobody yet"
            : people
                .map((userId) =>
                  userId === viewerId ? "You" : (memberById(userId)?.displayName ?? "Someone"),
                )
                .join(", ")}
        </span>
        <button className={styles.linkButton} onClick={() => setPanel("people")} type="button">
          Change
        </button>
      </div>
      {eachTime}
    </div>
  )

  const options: {
    value: WhoChoice
    title: string
    hint: string
    icon: ReactNode
    disabled?: boolean
    chevron?: boolean
  }[] = [
    { value: "ME", title: "Just me", hint: "Always you", icon: <UserRound size={18} /> },
    {
      value: "TURNS",
      title: "Take turns",
      hint:
        values.often === "AS_NEEDED" || values.often === "AFTER_COMPLETION"
          ? "Whoever has done it least goes next"
          : "Everyone gets a fair turn, in order",
      icon: <UsersRound size={18} />,
    },
    {
      value: "BALANCED",
      title: "Balanced",
      hint: asNeeded
        ? "Not available for chores done when needed"
        : "Whoever has done the least work lately",
      icon: <Scale size={18} />,
      disabled: asNeeded,
    },
    {
      value: "SOMEONE",
      title: "Specific people",
      hint:
        specific.length > 0
          ? specificLabel(values, members, viewerId)
          : groups
            ? "The same people every time"
            : "Always the same person",
      icon: <UserRound size={18} />,
      chevron: true,
    },
    {
      value: "RANDOM",
      title: "Mix it up",
      hint: asNeeded ? "Not available for chores done when needed" : "Picked at random each time",
      icon: <Shuffle size={18} />,
      disabled: asNeeded,
    },
  ]

  return (
    <FormSheet
      footer={
        <button className={styles.sheetPrimary} onClick={onClose} type="button">
          Done
        </button>
      }
      key="main"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      theme={theme}
      title="Who does it?"
    >
      {removedMembers > 0 && (
        <p className={styles.sheetNote}>
          {removedMembers === 1
            ? "1 person who is no longer in the household was taken off this chore."
            : `${removedMembers} people who are no longer in the household were taken off this chore.`}
        </p>
      )}
      <ul aria-label="Who does it" className={styles.options}>
        {options.map((option) => {
          const selected = values.who === option.value
          return (
            <li
              className={styles.optionItem}
              data-selected={selected && !option.disabled}
              key={option.value}
            >
              <button
                aria-pressed={option.chevron ? undefined : selected}
                aria-haspopup={option.chevron ? "dialog" : undefined}
                className={styles.option}
                disabled={option.disabled}
                onClick={() => choose(option.value)}
                type="button"
              >
                <span aria-hidden="true" className={styles.optionTile}>
                  {option.icon}
                </span>
                <span>
                  <span className={styles.optionTitle}>{option.title}</span>
                  <span className={styles.optionHint}>{option.hint}</span>
                </span>
                <span className={styles.optionEnd}>
                  {option.chevron ? (
                    <>
                      {selected && (
                        <span aria-hidden="true" className={styles.radio}>
                          <Check size={14} strokeWidth={3} />
                        </span>
                      )}
                      <ChevronRight aria-hidden="true" size={18} />
                    </>
                  ) : (
                    <span aria-hidden="true" className={styles.radio}>
                      {selected && <Check size={14} strokeWidth={3} />}
                    </span>
                  )}
                </span>
              </button>
              {selected && option.value === "BALANCED" && !option.disabled && (
                <p className={styles.optionNote}>Uses each chore&apos;s effort (in More options)</p>
              )}
              {selected &&
                !option.disabled &&
                (option.value === "TURNS" ||
                  option.value === "BALANCED" ||
                  option.value === "RANDOM") &&
                peopleSummary}
            </li>
          )
        })}
      </ul>
    </FormSheet>
  )
}
