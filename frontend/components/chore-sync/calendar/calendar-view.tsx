"use client"

import { useRef, type CSSProperties } from "react"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  UsersRound,
} from "lucide-react"
import {
  addState,
  dayDots,
  filterUndated,
  initial,
  itemTime,
  itemsByDay,
  memberColor,
  MONTH_WEEKDAY_INITIALS,
  monthGrid,
  peopleLabel,
  personCounts,
  rangeFor,
  selectedDayHeading,
  undatedSubtitle,
  weekDates,
  weekdayName,
  type CalendarDTO,
  type CalendarFilter,
  type CalendarItem,
  type CalendarMember,
  type CalendarView as View,
} from "@/lib/household/calendar"
import { useDialogFocus } from "../use-dialog-focus"
import styles from "./calendar-view.module.css"

export type CalendarStatus = "loading" | "loaded" | "error"

export interface CalendarViewProps {
  theme: "dark" | "light"
  view: View
  /** Any date in the week or month shown. */
  anchor: string
  /** Today in the household's time zone. */
  today: string
  timeZone: string
  calendar: CalendarDTO | null
  status: CalendarStatus
  error?: string | null
  filter: CalendarFilter
  /** The Month view's chosen day. */
  selectedDay: string
  filterOpen: boolean
  onViewChange: (view: View) => void
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  showToday: boolean
  rangeLabel: string
  onOpenFilter: () => void
  onCloseFilter: () => void
  onFilterChange: (filter: CalendarFilter) => void
  onSelectDay: (date: string) => void
  /** Opens the action sheet for a stored occurrence. */
  onOpenItem: (id: string) => void
  /** "+" on a day (owners and admins). */
  onAdd: (date: string) => void
  onRetry: () => void
}

/** The household calendar's body: controls, Week (C2) or Month (C3), and No set date. */
export function CalendarView(props: CalendarViewProps) {
  const { calendar, filter, view } = props
  const members = calendar?.members ?? []
  const filterMember = members.find((member) => member.userId === filter)
  return (
    <div className={`${styles.calendar} ${styles[props.theme]}`} data-calendar-view={view}>
      <div className={styles.controls}>
        <div aria-label="Calendar view" className={styles.segment} role="tablist">
          {(["week", "month"] as const).map((value) => (
            <button
              aria-selected={view === value}
              className={styles.segmentTab}
              key={value}
              onClick={() => props.onViewChange(value)}
              role="tab"
              type="button"
            >
              {value === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
        <button
          aria-haspopup="dialog"
          aria-label={`Show chores for: ${filterMember ? filterMember.displayName : "Everyone"}`}
          className={styles.filterButton}
          onClick={props.onOpenFilter}
          type="button"
        >
          {filterMember ? (
            <MemberAvatar members={members} person={filterMember} size="small" />
          ) : (
            <UsersRound aria-hidden="true" size={14} />
          )}
          <span>{filterMember ? firstWord(filterMember.displayName) : "Everyone"}</span>
          <ChevronDown aria-hidden="true" size={14} />
        </button>
      </div>

      <div className={styles.range}>
        <button
          aria-label={view === "week" ? "Previous week" : "Previous month"}
          className={styles.rangeArrow}
          onClick={props.onPrev}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </button>
        <div className={styles.rangeLabel}>
          <h2 aria-live="polite">{props.rangeLabel}</h2>
          {props.showToday && (
            <button className={styles.todayButton} onClick={props.onToday} type="button">
              Today
            </button>
          )}
        </div>
        <button
          aria-label={view === "week" ? "Next week" : "Next month"}
          className={styles.rangeArrow}
          onClick={props.onNext}
          type="button"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>

      {props.status === "error" && (
        <div className={`${styles.card} ${styles.errorCard}`} role="alert">
          <p>{props.error ?? "The calendar couldn't be loaded. Please try again."}</p>
          <button onClick={props.onRetry} type="button">
            Retry
          </button>
        </div>
      )}
      {props.status === "loading" && !calendar && (
        <div aria-label="Loading the calendar" className={`${styles.card} ${styles.skeleton}`} />
      )}
      {calendar && props.status !== "error" && (
        <div aria-busy={props.status === "loading"} className={styles.body}>
          {view === "week" ? <WeekBody {...props} calendar={calendar} /> : null}
          {view === "month" ? <MonthBody {...props} calendar={calendar} /> : null}
          <Undated {...props} calendar={calendar} />
        </div>
      )}

      {props.filterOpen && (
        <FilterSheet
          filter={filter}
          members={members}
          onChoose={props.onFilterChange}
          onClose={props.onCloseFilter}
          theme={props.theme}
        />
      )}
    </div>
  )
}

/** The member colour token for a dot or avatar (set as --member). */
function tint(color: string) {
  return { "--member": `var(--member-${color})` } as CSSProperties
}

function firstWord(name: string) {
  return name.trim().split(/\s+/)[0] ?? name
}

type BodyProps = CalendarViewProps & { calendar: CalendarDTO }

// ---- Week (C2) -----------------------------------------------------------------------------------

function WeekBody(props: BodyProps) {
  const { calendar, filter, today } = props
  const byDay = itemsByDay(calendar, filter)
  const pills = personCounts(calendar, filter)
  const monday = rangeFor("week", props.anchor).from
  return (
    <>
      {pills.length > 0 && (
        <section
          aria-labelledby="calendar-by-person"
          className={`${styles.card} ${styles.byPerson}`}
        >
          <h3 className={styles.sectionLabel} id="calendar-by-person">
            {monday === rangeFor("week", today).from
              ? "This week, by person"
              : "That week, by person"}
          </h3>
          <ul className={styles.pills}>
            {pills.map(({ member, count }) => (
              <li
                aria-label={`${member.displayName}: ${count}`}
                className={styles.pill}
                key={member.userId}
              >
                <MemberAvatar members={calendar.members} person={member} size="small" />
                <span>{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Week" className={`${styles.card} ${styles.week}`}>
        {weekDates(monday).map((date) => {
          const items = byDay.get(date) ?? []
          const add = addState(calendar.viewerRole, date, today)
          return (
            <div
              aria-label={`${weekdayName(date)} ${Number(date.slice(8))}`}
              className={styles.dayRow}
              data-date={date}
              data-empty={items.length === 0 || undefined}
              data-today={date === today || undefined}
              key={date}
              role="group"
            >
              <div className={styles.dayLabel}>
                <span>{weekdayName(date)}</span>
                <span>{Number(date.slice(8))}</span>
              </div>
              {items.length > 0 ? (
                <ul className={styles.lines}>
                  {items.map((item, index) => (
                    <ChoreLine
                      item={item}
                      key={item.id ?? `${item.choreId}-${index}`}
                      members={calendar.members}
                      onOpen={props.onOpenItem}
                      timeZone={props.timeZone}
                    />
                  ))}
                </ul>
              ) : (
                <span className={styles.lines} />
              )}
              {add !== "hidden" && (
                <button
                  aria-label={`Add a chore on ${weekdayName(date)} ${Number(date.slice(8))}`}
                  className={styles.addButton}
                  disabled={add === "disabled"}
                  onClick={() => props.onAdd(date)}
                  type="button"
                >
                  <Plus aria-hidden="true" size={15} />
                </button>
              )}
            </div>
          )
        })}
      </section>
    </>
  )
}

/** One compact chore line: avatar(s), title, and the time or a tick when done. */
function ChoreLine({
  item,
  members,
  timeZone,
  onOpen,
}: {
  item: CalendarItem
  members: CalendarMember[]
  timeZone: string
  onOpen: (id: string) => void
}) {
  const done = item.status === "COMPLETED"
  const time = itemTime(item, timeZone)
  const content = (
    <>
      <span className={styles.avatars}>
        {item.assignees.length === 0 ? (
          <span
            aria-hidden="true"
            className={`${styles.avatar} ${styles.avatarSmall}`}
            data-color="neutral"
            style={tint("neutral")}
            data-projected={item.projected || undefined}
          >
            ?
          </span>
        ) : (
          item.assignees
            .slice(0, 3)
            .map((person) => (
              <MemberAvatar
                key={person.userId}
                members={members}
                person={person}
                projected={item.projected}
                size="small"
              />
            ))
        )}
      </span>
      <span className={styles.lineTitle}>{item.title}</span>
      {done ? (
        <Check aria-label="Done" className={styles.tick} size={13} strokeWidth={2.6} />
      ) : time ? (
        <span className={styles.lineTime}>{time}</span>
      ) : null}
    </>
  )
  const label = `${item.title}, ${peopleLabel(item)}${done ? ", done" : time ? `, ${time}` : ""}${
    item.projected ? ", planned" : ""
  }`
  return (
    <li
      className={styles.line}
      data-done={done || undefined}
      data-projected={item.projected || undefined}
    >
      {item.id ? (
        <button
          aria-label={label}
          className={styles.lineButton}
          onClick={() => onOpen(item.id as string)}
          type="button"
        >
          {content}
        </button>
      ) : (
        <span className={styles.lineButton} title={label}>
          {content}
          <span className={styles.srOnly}>
            {item.toBeDecided ? ", to be decided" : ""}, planned
          </span>
        </span>
      )}
    </li>
  )
}

function MemberAvatar({
  members,
  person,
  size,
  projected,
}: {
  members: CalendarMember[]
  person: { userId: string; displayName: string }
  size: "small"
  projected?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.avatar} ${size === "small" ? styles.avatarSmall : ""}`}
      data-color={memberColor(members, person.userId)}
      style={tint(memberColor(members, person.userId))}
      data-projected={projected || undefined}
      title={person.displayName}
    >
      {initial(person.displayName)}
    </span>
  )
}

// ---- Month (C3) ----------------------------------------------------------------------------------

function MonthBody(props: BodyProps) {
  const { calendar, filter, today, selectedDay } = props
  const byDay = itemsByDay(calendar, filter)
  const weeks = monthGrid(props.anchor)
  const selectedItems = byDay.get(selectedDay) ?? []
  const add = addState(calendar.viewerRole, selectedDay, today)
  return (
    <>
      <section aria-label="Month" className={`${styles.card} ${styles.month}`}>
        <div aria-hidden="true" className={styles.monthWeekdays}>
          {MONTH_WEEKDAY_INITIALS.map((letter, index) => (
            <span key={index}>{letter}</span>
          ))}
        </div>
        <div className={styles.monthGrid} role="grid">
          {weeks.map((week, row) => (
            <div className={styles.monthWeek} key={row} role="row">
              {week.map((date, column) => {
                if (!date) {
                  return <span className={styles.monthBlank} key={column} role="gridcell" />
                }
                const items = byDay.get(date) ?? []
                const { dots, more } = dayDots(items, calendar.members)
                return (
                  <span aria-selected={date === selectedDay} key={date} role="gridcell">
                    <button
                      aria-label={`${weekdayName(date)} ${Number(date.slice(8))}, ${items.length} ${
                        items.length === 1 ? "chore" : "chores"
                      }`}
                      className={styles.monthDay}
                      data-selected={date === selectedDay || undefined}
                      data-date={date}
                      data-today={date === today || undefined}
                      onClick={() => props.onSelectDay(date)}
                      type="button"
                    >
                      <span>{Number(date.slice(8))}</span>
                      <span aria-hidden="true" className={styles.dots}>
                        {dots.map((dot, index) => (
                          <i
                            className={styles.dot}
                            data-color={dot.color}
                            style={tint(dot.color)}
                            data-projected={dot.projected || undefined}
                            key={index}
                          />
                        ))}
                        {more > 0 && <b className={styles.more}>+{more}</b>}
                      </span>
                    </button>
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </section>
      <div className={styles.legend}>
        <span>
          <i className={styles.dot} data-color="teal" style={tint("teal")} /> Confirmed
        </span>
        <span>
          <i className={styles.dot} data-color="teal" style={tint("teal")} data-projected />{" "}
          Projected
        </span>
        <span className={styles.legendNote}>Dots = who</span>
      </div>
      <div className={styles.sectionHeading}>
        <h3 className={styles.sectionLabel}>{selectedDayHeading(selectedDay, today)}</h3>
        {add !== "hidden" && (
          <button
            aria-label={`Add a chore on ${selectedDayHeading(selectedDay, today).toLowerCase()}`}
            className={styles.addButton}
            disabled={add === "disabled"}
            onClick={() => props.onAdd(selectedDay)}
            type="button"
          >
            <Plus aria-hidden="true" size={15} />
          </button>
        )}
      </div>
      <section aria-label="Chores on the chosen day" className={`${styles.card} ${styles.dayList}`}>
        {selectedItems.length > 0 ? (
          <ul className={styles.lines}>
            {selectedItems.map((item, index) => (
              <ChoreLine
                item={item}
                key={item.id ?? `${item.choreId}-${index}`}
                members={calendar.members}
                onOpen={props.onOpenItem}
                timeZone={props.timeZone}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.quiet}>Nothing planned.</p>
        )}
      </section>
    </>
  )
}

// ---- No set date ---------------------------------------------------------------------------------

function Undated(props: BodyProps) {
  const items = filterUndated(props.calendar.undated, props.filter)
  if (items.length === 0) return null
  return (
    <section aria-labelledby="calendar-undated">
      <h3 className={`${styles.sectionLabel} ${styles.outsideLabel}`} id="calendar-undated">
        No set date
      </h3>
      <ul className={`${styles.card} ${styles.undated}`}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              className={styles.undatedRow}
              onClick={() => props.onOpenItem(item.id)}
              type="button"
            >
              <span aria-hidden="true" className={styles.undatedTile}>
                <Clock3 size={14} />
              </span>
              <span className={styles.undatedText}>
                <strong>{item.title}</strong>
                <small>{undatedSubtitle(item)}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---- Filter sheet --------------------------------------------------------------------------------

function FilterSheet({
  filter,
  members,
  theme,
  onChoose,
  onClose,
}: {
  filter: CalendarFilter
  members: CalendarMember[]
  theme: "dark" | "light"
  onChoose: (filter: CalendarFilter) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLElement | null>(null)
  useDialogFocus(ref, true, onClose)
  const options: { value: CalendarFilter; label: string; member?: CalendarMember }[] = [
    { value: "everyone", label: "Everyone" },
    ...members.map((member) => ({ value: member.userId, label: member.displayName, member })),
  ]
  return (
    <div
      className={`${styles.backdrop} ${styles[theme]}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      role="presentation"
    >
      <section
        aria-labelledby="calendar-filter-title"
        aria-modal="true"
        className={styles.sheet}
        ref={ref}
        role="dialog"
      >
        <span aria-hidden="true" className={styles.grabber} />
        <h2 id="calendar-filter-title">Show chores for</h2>
        <ul>
          {options.map((option) => (
            <li key={option.value}>
              <button
                aria-pressed={filter === option.value}
                className={styles.sheetOption}
                onClick={() => onChoose(option.value)}
                type="button"
              >
                {option.member ? (
                  <span
                    aria-hidden="true"
                    className={`${styles.avatar} ${styles.avatarLarge}`}
                    data-color={memberColor(members, option.member.userId)}
                    style={tint(memberColor(members, option.member.userId))}
                  >
                    {initial(option.member.displayName)}
                  </span>
                ) : (
                  <span aria-hidden="true" className={styles.everyoneIcon}>
                    <UsersRound size={16} />
                  </span>
                )}
                <span>{option.label}</span>
                {filter === option.value && <Check aria-hidden="true" size={16} />}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
