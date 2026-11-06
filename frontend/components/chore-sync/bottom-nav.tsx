"use client"

import styles from "./bottom-nav.module.css"

export type NavKey = "dashboard" | "my-chores" | "household" | "profile"
export type BottomNavigationTheme = "light" | "dark"

interface BottomNavProps {
  active: NavKey
  navigate: (screen: NavKey) => void
  theme?: BottomNavigationTheme
  ariaLabel?: string
}

const tabs: Array<{ id: NavKey; label: string }> = [
  { id: "dashboard", label: "Home" },
  { id: "my-chores", label: "My Chores" },
  { id: "household", label: "Household" },
  { id: "profile", label: "Profile" },
]

function NavigationIcon({ destination }: { destination: NavKey }) {
  switch (destination) {
    case "dashboard":
      return (
        <svg aria-hidden="true" className={styles.icon} fill="none" viewBox="0 0 23 23">
          <path
            d="M3.35417 9.87083L11.5 3.35417L19.6458 9.87083V19.6458H3.35417V9.87083Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
          <path
            d="M8.625 19.6458V12.9375H14.375V19.6458"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        </svg>
      )
    case "my-chores":
      return (
        <svg aria-hidden="true" className={styles.icon} fill="none" viewBox="0 0 23 23">
          <path
            d="M3.35417 5.55833L4.98333 7.1875L7.475 4.3125"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
          <path
            d="M10.8292 6.22917H19.7417"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
          <path
            d="M3.35417 11.5L4.98333 13.1292L7.475 10.2542"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
          <path
            d="M10.8292 12.1708H19.7417"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
          <path
            d="M3.83333 18.2083H7.1875M10.8292 18.2083H19.7417"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        </svg>
      )
    case "household":
      return (
        <svg aria-hidden="true" className={styles.icon} fill="none" viewBox="0 0 23 23">
          <path
            d="M11.6917 7.66667C11.6917 9.36034 10.3187 10.7333 8.625 10.7333C6.93133 10.7333 5.55833 9.36034 5.55833 7.66667C5.55833 5.97299 6.93133 4.6 8.625 4.6C10.3187 4.6 11.6917 5.97299 11.6917 7.66667Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
          <path
            d="M2.68333 19.1667V17.4417C2.68333 14.375 5.07917 12.65 8.625 12.65C12.1708 12.65 14.5667 14.375 14.5667 17.4417V19.1667"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
          <path
            d="M16.2917 5.175C16.8379 5.37375 17.3111 5.73343 17.6488 6.2066C17.9865 6.67977 18.1729 7.24419 18.1832 7.82541C18.1936 8.40663 18.0276 8.97735 17.707 9.46227C17.3864 9.94719 16.9263 10.3235 16.3875 10.5417"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
          <path
            d="M16.3875 12.9375C18.975 13.1292 20.3167 14.4708 20.3167 17.0583V19.1667"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        </svg>
      )
    case "profile":
      return (
        <svg aria-hidden="true" className={styles.icon} fill="none" viewBox="0 0 23 23">
          <path
            d="M14.8542 7.7625C14.8542 9.61496 13.3525 11.1167 11.5 11.1167C9.64754 11.1167 8.14583 9.61496 8.14583 7.7625C8.14583 5.91005 9.64754 4.40833 11.5 4.40833C13.3525 4.40833 14.8542 5.91005 14.8542 7.7625Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
          <path
            d="M4.50417 19.3583V18.4C4.50417 15.2375 7.28333 12.9375 11.5 12.9375C15.7167 12.9375 18.4958 15.2375 18.4958 18.4V19.3583"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        </svg>
      )
  }
}

export function BottomNav({
  active,
  navigate,
  theme,
  ariaLabel = "Primary navigation",
}: BottomNavProps) {
  return (
    <nav aria-label={ariaLabel} className={styles.navigation} data-theme={theme}>
      <div className={styles.capsule}>
        <span aria-hidden="true" className={styles.activeIsland} data-active={active} />
        <div className={styles.items}>
          {tabs.map(({ id, label }) => {
            const isActive = id === active
            return (
              <button
                key={id}
                onClick={() => navigate(id)}
                aria-current={isActive ? "page" : undefined}
                aria-label={label}
                className={styles.item}
                type="button"
              >
                <NavigationIcon destination={id} />
                <span className={styles.label}>{label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
