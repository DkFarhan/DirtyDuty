"use client"

import { useState } from "react"
import { useChoreSync } from "@/lib/chore-sync/store"
import { useHouseholds } from "@/lib/household/household-context"
import { ProductLogo } from "@/components/brand/product-logo"
import { ChevronLeftIcon } from "../icons"
import { Info } from "lucide-react"
import styles from "./setup-screens.module.css"

export function CreateHouseholdScreen() {
  const { navigate } = useChoreSync()
  const { create, queueCreatedHouseholdInvite } = useHouseholds()
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (submitting || !name.trim()) return
    if (desc.length > 2000) {
      setError("Household description must be at most 2000 characters.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const created = await create({
        name: name.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        description: desc.trim() || null,
      })
      queueCreatedHouseholdInvite(created)
      navigate("dashboard")
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to create household. Please try again.",
      )
      setSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topBar}>
          <button className={styles.backButton} onClick={() => navigate("welcome")} type="button">
            <ChevronLeftIcon className="h-5 w-5" />
            <span>Back</span>
          </button>
        </header>
        <section className={styles.formContent}>
          <div className={styles.formHeading}>
            <ProductLogo className={styles.logo} themeAware />
            <p className={styles.eyebrow}>Make it your own</p>
            <h1 className={styles.title}>Create Household</h1>
            <p className={styles.description}>
              Give your home a name and invite your housemates to build a smoother routine together.
            </p>
          </div>
          <div className={styles.formCard}>
            <div className={styles.fieldStack}>
              <label className={styles.field} htmlFor="household-name">
                <span>
                  Household Name{" "}
                  <span aria-hidden="true" className={styles.optional}>
                    *
                  </span>
                </span>
                <input
                  autoComplete="off"
                  className={styles.input}
                  id="household-name"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Apartment 305"
                  value={name}
                />
              </label>
              <label className={styles.field} htmlFor="household-desc">
                <span>
                  Description <span className={styles.optional}>(optional)</span>
                </span>
                <textarea
                  className={styles.textarea}
                  id="household-desc"
                  onChange={(event) => {
                    setDesc(event.target.value)
                    setError(null)
                  }}
                  placeholder="A short description of your household..."
                  rows={3}
                  value={desc}
                />
              </label>
            </div>
            <div className={styles.infoNote}>
              <Info aria-hidden="true" size={18} />
              <p>
                After creating your household, you&apos;ll get a unique invite code to share with
                housemates.
              </p>
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button
              className={styles.primaryButton}
              disabled={submitting || !name.trim()}
              onClick={() => void handleCreate()}
              type="button"
            >
              {submitting ? "Creating..." : "Create Household"}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
