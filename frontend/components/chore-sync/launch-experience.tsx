"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/lib/auth/auth-context"
import { useHouseholds } from "@/lib/household/household-context"
import styles from "./launch-experience.module.css"

const MINIMUM_SPLASH_DURATION = 900
const SPLASH_EXIT_DURATION = 180

export function LaunchSplash({ exiting = false }: { exiting?: boolean }) {
  return (
    <div
      aria-label="Starting DirtyDuty"
      className={`${styles.splash} ${exiting ? styles.exiting : ""}`}
      role="status"
    >
      <div aria-hidden="true" className={styles.referenceStage}>
        <div className={styles.logoContainer}>
          {/* Keep the exported SVG layers unoptimized so their Figma geometry remains exact. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className={`${styles.markLayer} ${styles.darkMark}`}
            src="/brand/dirtyduty-splash-mark-dark.svg"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className={`${styles.markLayer} ${styles.greenMark}`}
            src="/brand/dirtyduty-splash-mark-green.svg"
          />
        </div>
        {/* The status label already announces the brand; these artwork images are decorative. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" className={styles.wordmark} src="/brand/dirtyduty-splash-wordmark.svg" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" className={styles.tagline} src="/brand/dirtyduty-splash-tagline.svg" />
      </div>
    </div>
  )
}

export function LaunchExperience({
  children,
  isReady,
}: {
  children: React.ReactNode
  isReady: boolean
}) {
  const [minimumDurationElapsed, setMinimumDurationElapsed] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setMinimumDurationElapsed(true),
      MINIMUM_SPLASH_DURATION,
    )
    return () => window.clearTimeout(timeout)
  }, [])

  useEffect(() => {
    if (!isReady || !minimumDurationElapsed || isExiting || isComplete) return
    setIsExiting(true)
  }, [isComplete, isExiting, isReady, minimumDurationElapsed])

  useEffect(() => {
    if (!isExiting || isComplete) return
    const timeout = window.setTimeout(() => setIsComplete(true), SPLASH_EXIT_DURATION)
    return () => window.clearTimeout(timeout)
  }, [isComplete, isExiting])

  return (
    <>
      <div
        aria-hidden={!isComplete}
        className={isComplete ? undefined : styles.concealedApp}
        inert={!isComplete}
      >
        {children}
      </div>
      {!isComplete && <LaunchSplash exiting={isExiting} />}
    </>
  )
}

export function AppLaunchGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const { status: householdStatus } = useHouseholds()
  const isReady = !isLoading && (!isAuthenticated || householdStatus !== "loading")

  return <LaunchExperience isReady={isReady}>{children}</LaunchExperience>
}
