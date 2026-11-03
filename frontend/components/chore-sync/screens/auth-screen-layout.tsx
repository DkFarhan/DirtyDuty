"use client"

import type { ReactNode } from "react"
import { ProductLogo } from "@/components/brand/product-logo"
import { ChevronLeftIcon } from "../icons"
import styles from "./auth-screens.module.css"

type AuthScreenLayoutProps = {
  eyebrow: string
  title: string
  description: string
  onBack?: () => void
  backLabel?: string
  centeredBrand?: boolean
  footer?: ReactNode
  children: ReactNode
}

export function AuthScreenLayout({
  eyebrow,
  title,
  description,
  onBack,
  backLabel = "Back to sign in",
  centeredBrand = false,
  footer,
  children,
}: AuthScreenLayoutProps) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topBar}>
          {onBack ? (
            <button className={styles.backButton} onClick={onBack} type="button">
              <ChevronLeftIcon aria-hidden="true" className={styles.backIcon} />
              <span>{backLabel}</span>
            </button>
          ) : (
            <span aria-hidden="true" className={styles.topBarSpace} />
          )}
        </div>
        <header className={`${styles.brand} ${centeredBrand ? styles.centeredBrand : ""}`}>
          <ProductLogo className={styles.logo} themeAware />
          <p className={styles.brandPhrase}>Keep your home running smoothly</p>
        </header>
        <section aria-labelledby="auth-screen-title" className={styles.intro}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title} id="auth-screen-title">
            {title}
          </h1>
          <p className={styles.description}>{description}</p>
        </section>
        <section aria-labelledby="auth-screen-title" className={styles.card}>
          {children}
        </section>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </main>
  )
}
