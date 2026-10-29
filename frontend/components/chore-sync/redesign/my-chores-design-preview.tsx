"use client"

import { useEffect, useRef, useState } from "react"
import type { HomeNavigationDestination, HomeVisualTheme } from "./home-screen-view"
import {
  createMyChoresScenario,
  myChoresPreviewFixture,
  type MyChoresPreviewScenario,
} from "./my-chores-preview-fixtures"
import {
  MyChoresScreenView,
  type MyChoreCompletedViewModel,
  type MyChoresTab,
  type MyChoresViewModel,
} from "./my-chores-screen-view"
import styles from "./my-chores-design-preview.module.css"

const scenarios: MyChoresPreviewScenario[] = [
  "upcoming",
  "completed",
  "empty-upcoming",
  "empty-completed",
  "loading",
  "error",
  "refresh-error",
  "pending",
]

function isScenario(value: string | null): value is MyChoresPreviewScenario {
  return value !== null && scenarios.includes(value as MyChoresPreviewScenario)
}

export function MyChoresDesignPreview() {
  const [theme, setTheme] = useState<HomeVisualTheme>("dark")
  const [tab, setTab] = useState<MyChoresTab>("upcoming")
  const [captureMode, setCaptureMode] = useState(false)
  const [scenario, setScenario] = useState<MyChoresPreviewScenario>("upcoming")
  const [viewModel, setViewModel] = useState<MyChoresViewModel>(myChoresPreviewFixture)
  const [activeDestination, setActiveDestination] = useState<HomeNavigationDestination>("my-chores")
  const completionTimers = useRef(new Map<string, number>())

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("theme") === "light") setTheme("light")
    if (params.get("tab") === "completed") setTab("completed")
    setCaptureMode(params.get("capture") === "1")
    const initialScenario = params.get("state")
    if (isScenario(initialScenario)) {
      setScenario(initialScenario)
      setViewModel(createMyChoresScenario(initialScenario))
      if (initialScenario === "completed" || initialScenario === "empty-completed") {
        setTab("completed")
      }
    }

    return () => {
      for (const timer of completionTimers.current.values()) window.clearTimeout(timer)
      completionTimers.current.clear()
    }
  }, [])

  const selectScenario = (nextScenario: MyChoresPreviewScenario) => {
    for (const timer of completionTimers.current.values()) window.clearTimeout(timer)
    completionTimers.current.clear()
    setScenario(nextScenario)
    setViewModel(createMyChoresScenario(nextScenario))
    if (nextScenario === "completed" || nextScenario === "empty-completed") {
      setTab("completed")
    } else if (nextScenario !== "loading" && nextScenario !== "error") {
      setTab("upcoming")
    }
  }

  const completeChore = (choreId: string) => {
    setViewModel((current) => {
      if (current.status !== "loaded" || current.completingIds.includes(choreId)) return current
      return { ...current, completingIds: [...current.completingIds, choreId] }
    })

    const timer = window.setTimeout(() => {
      setViewModel((current) => {
        const chore =
          current.attentionChore?.id === choreId
            ? current.attentionChore
            : current.upcomingChores.find((item) => item.id === choreId)
        if (!chore) {
          return {
            ...current,
            completingIds: current.completingIds.filter((id) => id !== choreId),
          }
        }

        const completedChore: MyChoreCompletedViewModel = {
          id: chore.id,
          title: chore.title,
          category: chore.category,
          dateLabel: chore.dateLabel,
          durationLabel: chore.durationLabel,
          assignedTo: chore.assignedTo,
          completedBy: "You",
        }
        return {
          ...current,
          attentionChore: current.attentionChore?.id === choreId ? null : current.attentionChore,
          upcomingChores: current.upcomingChores.filter((item) => item.id !== choreId),
          completedChores: [...current.completedChores, completedChore],
          completedHeading: `${current.completedChores.length + 1} things, taken care of.`,
          completingIds: current.completingIds.filter((id) => id !== choreId),
        }
      })
      completionTimers.current.delete(choreId)
    }, 850)
    completionTimers.current.set(choreId, timer)
  }

  return (
    <div className={styles.previewRoot}>
      {!captureMode && (
        <div aria-label="My Chores design preview controls" className={styles.previewControls}>
          <div aria-label="Preview theme" className={styles.themeControls}>
            <button aria-pressed={theme === "dark"} onClick={() => setTheme("dark")} type="button">
              Dark
            </button>
            <button
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
              type="button"
            >
              Light
            </button>
          </div>
          <label>
            <span className={styles.visuallyHidden}>Preview state</span>
            <select
              aria-label="Preview state"
              onChange={(event) =>
                selectScenario(event.currentTarget.value as MyChoresPreviewScenario)
              }
              value={scenario}
            >
              {scenarios.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <MyChoresScreenView
        activeDestination={activeDestination}
        onCompleteChore={completeChore}
        onNavigate={setActiveDestination}
        onRetry={() => {
          setScenario("upcoming")
          setViewModel(myChoresPreviewFixture)
        }}
        onSelectTab={setTab}
        tab={tab}
        theme={theme}
        viewModel={viewModel}
      />
    </div>
  )
}
