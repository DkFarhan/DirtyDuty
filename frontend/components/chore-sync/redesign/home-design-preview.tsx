"use client"

import { useEffect, useMemo, useState } from "react"
import {
  HomeScreenView,
  type HomeNavigationDestination,
  type HomeScreenViewModel,
  type HomeVisualTheme,
} from "./home-screen-view"
import { homePreviewFixture } from "./home-preview-fixtures"
import styles from "./home-design-preview.module.css"

export function HomeDesignPreview() {
  const [theme, setTheme] = useState<HomeVisualTheme>("dark")
  const [captureMode, setCaptureMode] = useState(false)
  const [activeDestination, setActiveDestination] = useState<HomeNavigationDestination>("home")
  const [completedChoreIds, setCompletedChoreIds] = useState<string[]>([])
  const [status, setStatus] = useState<HomeScreenViewModel["status"]>("loaded")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("theme") === "light") setTheme("light")
    setCaptureMode(params.get("capture") === "1")
  }, [])

  const viewModel = useMemo<HomeScreenViewModel>(() => {
    const attentionChore =
      homePreviewFixture.attentionChore &&
      !completedChoreIds.includes(homePreviewFixture.attentionChore.id)
        ? homePreviewFixture.attentionChore
        : null
    return {
      ...homePreviewFixture,
      status,
      attentionChore,
    }
  }, [completedChoreIds, status])

  const handleCompleteChore = (choreId: string) => {
    setCompletedChoreIds((ids) => (ids.includes(choreId) ? ids : [...ids, choreId]))
  }

  return (
    <div className={styles.previewRoot}>
      {!captureMode && (
        <div aria-label="Home design preview controls" className={styles.previewControls}>
          <button aria-pressed={theme === "dark"} onClick={() => setTheme("dark")} type="button">
            Dark
          </button>
          <button aria-pressed={theme === "light"} onClick={() => setTheme("light")} type="button">
            Light
          </button>
        </div>
      )}
      <HomeScreenView
        activeDestination={activeDestination}
        onCompleteChore={handleCompleteChore}
        onNavigate={setActiveDestination}
        onOpenNotifications={() => setActiveDestination("profile")}
        onRetry={() => setStatus("loaded")}
        theme={theme}
        viewModel={viewModel}
      />
    </div>
  )
}
