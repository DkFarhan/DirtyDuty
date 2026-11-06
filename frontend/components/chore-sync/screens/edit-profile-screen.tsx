"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import { profileApi, type Profile } from "@/lib/profile/api"
import { Avatar } from "../primitives"
import type { Theme } from "@/components/theme/theme-provider"
import { ProfileDestinationHeader, ProfileDestinationView } from "./profile-screen-view"
import styles from "./profile-screen-view.module.css"

export function EditProfileScreen({ theme = "light" }: { theme?: Exclude<Theme, "system"> }) {
  const { navigate, setCurrentUser, state } = useChoreSync()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError("")
    try {
      const result = await profileApi.get()
      setProfile(result)
      setDisplayName(result.displayName)
      setStatus("loaded")
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to load your profile. Please try again.",
      )
      setStatus("error")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!profile || busy || !displayName.trim()) return
    setBusy(true)
    setError("")
    setSaved(false)
    try {
      const updated = await profileApi.update({ displayName: displayName.trim() })
      setProfile(updated)
      setDisplayName(updated.displayName)
      setCurrentUser({
        ...state.currentUser,
        name: updated.displayName,
        avatar: updated.displayName.trim().slice(0, 1).toUpperCase() || state.currentUser.avatar,
      })
      setSaved(true)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Unable to save your profile. Please try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProfileDestinationView destination="edit-profile" theme={theme}>
      {
        <ProfileDestinationHeader
          eyebrow="YOUR DETAILS"
          title="Edit profile"
          back={() => navigate("profile")}
          theme={theme}
        />
      }
      <main className={styles.editProfileMain}>
        {status === "loading" && (
          <div
            aria-label="Loading profile"
            className="h-52 animate-pulse rounded-2xl bg-white dark:bg-slate-900"
          />
        )}
        {status === "error" && (
          <div className="rounded-2xl bg-white p-5 text-center dark:bg-slate-900">
            <p role="alert" className="text-sm text-slate-600 dark:text-slate-300">
              {error}
            </p>
            <button
              className="mt-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold dark:border-slate-700"
              onClick={() => void load()}
              type="button"
            >
              Try again
            </button>
          </div>
        )}
        {status === "loaded" && profile && (
          <div className={styles.editProfileContent}>
            <div className={styles.editProfileAvatarRow}>
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="Profile avatar"
                  className={styles.editProfileAvatarImage}
                  src={profile.avatarUrl}
                />
              ) : (
                <Avatar
                  initial={displayName.trim().slice(0, 1).toUpperCase() || "?"}
                  className={styles.editProfileAvatar}
                />
              )}
              <p>Avatar uploads are coming soon. Your initial appears in the meantime.</p>
            </div>
            <div className={styles.editProfileIntro}>
              <h2>The name everyone sees.</h2>
              <p>Update your display name across your shared home.</p>
            </div>
            <div className={styles.editProfileFields}>
              <label>
                Display name
                <input
                  aria-label="Display name"
                  autoComplete="name"
                  maxLength={100}
                  onChange={(event) => {
                    setDisplayName(event.target.value)
                    setSaved(false)
                  }}
                  value={displayName}
                />
              </label>
              <label>
                Email address
                <input aria-label="Email address" readOnly value={profile.email} />
              </label>
              <p className={styles.editProfileReadOnly}>Email is read-only.</p>
              <button
                className={styles.editProfileSave}
                disabled={busy || !displayName.trim()}
                onClick={() => void save()}
                type="button"
              >
                {busy ? "Saving…" : "Save profile"}
              </button>
              {saved && (
                <p role="status" className={styles.editProfileStatus}>
                  Profile updated.
                </p>
              )}
              {error && (
                <p role="alert" className={styles.editProfileError}>
                  {error}
                </p>
              )}
              <p className={styles.editProfileNote}>
                Changes appear in your household after saving.
              </p>
            </div>
          </div>
        )}
      </main>
    </ProfileDestinationView>
  )
}
