"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

export type Theme = "light" | "dark" | "system"

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const THEME_STORAGE_KEY = "dirtyduty-theme"
const ThemeContext = createContext<ThemeContextValue | null>(null)

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system"
}

function systemPrefersDark() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  )
}

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark())
  const root = document.documentElement
  root.classList.toggle("dark", dark)
  root.classList.toggle("light", !dark)
  root.dataset.theme = dark ? "dark" : "light"
  root.style.colorScheme = dark ? "dark" : "light"
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = dark ? "#181a20" : "#0d9488"
  })
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system")
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isTheme(savedTheme)) setThemeState(savedTheme)
    setInitialized(true)

    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isTheme(event.newValue)) {
        setThemeState(event.newValue)
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  useEffect(() => {
    if (!initialized) return
    applyTheme(theme)
    if (theme !== "system" || typeof window.matchMedia !== "function") return

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onColorSchemeChange = () => applyTheme("system")
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onColorSchemeChange)
      return () => media.removeEventListener("change", onColorSchemeChange)
    }

    media.addListener(onColorSchemeChange)
    return () => media.removeListener(onColorSchemeChange)
  }, [initialized, theme])

  const setTheme = useCallback((nextTheme: Theme) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    setThemeState(nextTheme)
  }, [])

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used within a ThemeProvider.")
  return context
}

export const themeStorageKey = THEME_STORAGE_KEY
