"use client"

import type { ReactNode } from "react"
import type { Profile } from "@/lib/profile/api"
import type { Theme } from "@/components/theme/theme-provider"
import type { Screen } from "@/lib/chore-sync/types"
import { BottomNav } from "../bottom-nav"
import styles from "./profile-screen-view.module.css"

type ProfileRoute =
  "profile" | "edit-profile" | "appearance" | "notifications" | "privacy-security" | "help-support"

export function ProfileDestinationView({
  destination,
  theme,
  redesigned,
  legacyClassName,
  children,
}: {
  destination: Exclude<ProfileRoute, "profile">
  theme: Exclude<Theme, "system">
  redesigned: boolean
  legacyClassName: string
  children: ReactNode
}) {
  return (
    <div
      className={redesigned ? `${styles.route} ${styles[theme]}` : legacyClassName}
      data-destination={redesigned ? destination : undefined}
      data-profile-redesign={redesigned ? "" : undefined}
    >
      {children}
    </div>
  )
}

export function ProfileDestinationHeader({
  eyebrow,
  title,
  subtitle,
  back,
  action,
  theme,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  back: () => void
  action?: ReactNode
  theme: Exclude<Theme, "system">
}) {
  return (
    <header className={styles.destinationHeader}>
      <div className={styles.destinationHeadingGroup}>
        {eyebrow && <p className={styles.destinationEyebrow}>{eyebrow}</p>}
        <div className={styles.destinationTitleRow}>
          <button aria-label="Back" className={styles.backButton} onClick={back} type="button">
            <ProfileAsset className={styles.backIcon} name="header-chevron" theme={theme} />
          </button>
          <div className={styles.destinationTitle}>
            <h1>{title}</h1>
          </div>
        </div>
        {(subtitle || action) && (
          <div className={styles.destinationMetaRow}>
            {subtitle && <p className={styles.destinationSubtitle}>{subtitle}</p>}
            {action}
          </div>
        )}
      </div>
    </header>
  )
}

export interface ProfileScreenViewProps {
  profile: Profile | null
  initials: string
  unreadCount: number
  isSubmitting: boolean
  error: string
  notificationError: string
  theme: Exclude<Theme, "system">
  onEdit: () => void
  onNotifications: () => void
  onNavigate: (destination: Exclude<ProfileRoute, "profile">) => void
  onRetryProfile: () => void
  onRetryNotifications: () => void
  onSignOut: () => void
  onPrimaryNavigate: (destination: Screen) => void
}

const preferences = [
  {
    title: "Notifications",
    icon: "settings-notifications",
    destination: "notifications" as const,
    tone: "notifications",
  },
  {
    title: "Privacy & Security",
    icon: "settings-privacy",
    destination: "privacy-security" as const,
    tone: "privacySecurity",
  },
  {
    title: "Appearance",
    icon: "settings-appearance",
    destination: "appearance" as const,
    tone: "appearance",
  },
] as const

type ProfileAssetName =
  | "header-chevron"
  | "identity-rim"
  | "identity-house"
  | "identity-edit"
  | "settings-notifications"
  | "settings-privacy"
  | "settings-appearance"
  | "settings-chevron"
  | "rewards-haze"
  | "rewards-medal"
  | "support"
  | "support-chevron"
  | "sign-out"

function ProfileAsset({
  name,
  theme,
  className,
}: {
  name: ProfileAssetName
  theme: Exclude<Theme, "system">
  className?: string
}) {
  // These are static, approved Figma assets served from the local public directory.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      aria-hidden="true"
      className={className}
      src={`/profile-redesign/icons/${name}-${theme}.svg`}
    />
  )
}

export function ProfileScreenView({
  profile,
  initials,
  unreadCount,
  isSubmitting,
  error,
  notificationError,
  theme,
  onEdit,
  onNotifications,
  onNavigate,
  onRetryProfile,
  onRetryNotifications,
  onSignOut,
  onPrimaryNavigate,
}: ProfileScreenViewProps) {
  return (
    <div className={`${styles.route} ${styles.profile} ${styles[theme]}`} data-profile-redesign>
      <header className={styles.profileHeader}>
        <div className={styles.profileReflection}>
          <ProfileAsset className={styles.reflectionAsset} name="identity-rim" theme={theme} />
        </div>
        <p className={styles.accountEyebrow}>YOUR ACCOUNT</p>
        <div className={styles.identity}>
          <div className={styles.avatar}>
            {profile?.avatarUrl ? (
              // External avatar URLs are displayed only when provided by the profile API.
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={profile.avatarUrl} />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div className={styles.identityCopy}>
            <h1>{profile?.displayName ?? "Loading profile…"}</h1>
            <p>{profile?.email ?? " "}</p>
            {profile?.householdName && (
              <p className={styles.householdName}>
                <ProfileAsset name="identity-house" theme={theme} />
                <span>{profile.householdName}</span>
              </p>
            )}
          </div>
          <button
            aria-label="Edit profile"
            className={styles.editButton}
            onClick={onEdit}
            type="button"
          >
            <ProfileAsset name="identity-edit" theme={theme} />
          </button>
        </div>
      </header>

      <main className={styles.profileContent}>
        {error && (
          <div className={styles.errorNotice}>
            <p role="alert">{error}</p>
            <button onClick={onRetryProfile} type="button">
              Try again
            </button>
          </div>
        )}
        {notificationError && (
          <div className={styles.warningNotice}>
            <p role="alert">{notificationError}</p>
            <button onClick={onRetryNotifications} type="button">
              Retry
            </button>
          </div>
        )}

        <div className={styles.profileGrid}>
          <section aria-labelledby="preferences-heading" className={styles.preferencesCard}>
            <h2 id="preferences-heading">Settings</h2>
            {preferences.map(({ title, icon, destination, tone }) => (
              <button
                className={styles.preferenceRow}
                key={destination}
                onClick={
                  destination === "notifications" ? onNotifications : () => onNavigate(destination)
                }
                type="button"
              >
                <span className={`${styles.preferenceIcon} ${styles[tone]}`}>
                  <ProfileAsset name={icon} theme={theme} />
                </span>
                <span className={styles.preferenceTitle}>{title}</span>
                {destination === "notifications" && unreadCount > 0 && (
                  <span aria-label={`${unreadCount} unread`} className={styles.unreadBadge}>
                    {unreadCount}
                  </span>
                )}
                <ProfileAsset
                  className={styles.chevronAsset}
                  name="settings-chevron"
                  theme={theme}
                />
              </button>
            ))}
          </section>

          <div className={styles.profileSupport}>
            <section aria-label="Rewards and streaks coming soon" className={styles.rewardsCard}>
              <div className={styles.rewardsHaze}>
                <ProfileAsset
                  className={styles.rewardsHazeAsset}
                  name="rewards-haze"
                  theme={theme}
                />
              </div>
              <ProfileAsset className={styles.rewardsMedal} name="rewards-medal" theme={theme} />
              <div className={styles.rewardsHeading}>
                <div>
                  <p className={styles.comingSoon}>COMING SOON</p>
                  <h2>Rewards &amp; streaks</h2>
                </div>
              </div>
              <p>Points, badges &amp; household leaderboards</p>
            </section>

            <button
              className={styles.helpButton}
              onClick={() => onNavigate("help-support")}
              type="button"
            >
              <ProfileAsset className={styles.helpIconAsset} name="support" theme={theme} />
              <span>Help &amp; Support</span>
              <ProfileAsset className={styles.chevronAsset} name="support-chevron" theme={theme} />
            </button>

            <button
              className={styles.signOutButton}
              disabled={isSubmitting}
              onClick={onSignOut}
              type="button"
            >
              <ProfileAsset name="sign-out" theme={theme} />
              {isSubmitting ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>

        <footer className={styles.footer}>
          <p>Developed by Farhan Habib</p>
          <p>© 2026 DirtyDuty</p>
        </footer>
      </main>
      <BottomNav active="profile" navigate={onPrimaryNavigate} />
    </div>
  )
}
