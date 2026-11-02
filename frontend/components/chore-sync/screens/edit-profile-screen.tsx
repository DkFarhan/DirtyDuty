"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/auth/api"
import { useChoreSync } from "@/lib/chore-sync/store"
import { profileApi, type Profile } from "@/lib/profile/api"
import { Avatar } from "../primitives"
import { ChevronLeftIcon } from "../icons"
import type { Theme } from "@/components/theme/theme-provider"
import { ProfileDestinationHeader, ProfileDestinationView } from "./profile-screen-view"
import styles from "./profile-screen-view.module.css"

export function EditProfileScreen({
  redesigned = false,
  theme = "light",
}: {
  redesigned?: boolean
  theme?: Exclude<Theme, "system">
}) {
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
    <ProfileDestinationView
      destination="edit-profile"
      legacyClassName="min-h-screen bg-slate-50 pb-8 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      redesigned={redesigned}
      theme={theme}
    >
      {redesigned ? (
        <ProfileDestinationHeader
          eyebrow={theme === "light" ? "YOUR DETAILS" : undefined}
          title={theme === "light" ? "Edit profile" : "Edit Profile"}
          back={() => navigate("profile")}
          theme={theme}
        />
      ) : (
        <header className="flex items-center gap-3 border-b border-slate-100 bg-white px-5 pb-5 pt-12 dark:border-slate-800 dark:bg-slate-900">
          <button
            aria-label="Back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() => navigate("profile")}
            type="button"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <h1 className="font-display text-xl font-black">Edit Profile</h1>
        </header>
      )}
      <main
        className={
          redesigned
            ? theme === "light"
              ? styles.editProfileMain
              : styles.destinationMain
            : "px-4 pt-4"
        }
      >
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
        {status === "loaded" &&
          profile &&
          (theme === "light" && redesigned ? (
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
          ) : (
            <section className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-4">
                {profile.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt="Profile avatar"
                    className="h-14 w-14 rounded-2xl object-cover"
                    src={profile.avatarUrl}
                  />
                ) : (
                  <Avatar
                    initial={displayName.trim().slice(0, 1).toUpperCase() || "?"}
                    className="h-14 w-14 rounded-2xl text-2xl"
                  />
                )}
                <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Avatar uploads are coming soon. A placeholder is shown until then.
                </p>
              </div>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                Display name
                <input
                  aria-label="Display name"
                  autoComplete="name"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  maxLength={100}
                  onChange={(event) => {
                    setDisplayName(event.target.value)
                    setSaved(false)
                  }}
                  value={displayName}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                Email address <span className="text-[10px] font-normal">Read only</span>
                <input
                  aria-label="Email address"
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  readOnly
                  value={profile.email}
                />
              </label>
              <button
                className="w-full rounded-xl bg-teal-600 py-3.5 text-sm font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
                disabled={busy || !displayName.trim()}
                onClick={() => void save()}
                type="button"
              >
                {busy ? "Saving…" : "Save profile"}
              </button>
              {saved && (
                <p
                  role="status"
                  className="text-center text-sm font-medium text-teal-700 dark:text-teal-300"
                >
                  Profile updated.
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-rose-600">
                  {error}
                </p>
              )}
            </section>
          ))}
      </main>
    </ProfileDestinationView>
  )
}
