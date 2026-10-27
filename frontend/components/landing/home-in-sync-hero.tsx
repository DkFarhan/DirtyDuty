"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import styles from "./home-in-sync-hero.module.css"

const media = "/landing/media"

export function HomeInSyncHero() {
  const [activeVideo, setActiveVideo] = useState<"desktop" | "mobile" | null>(null)
  const [playingVideo, setPlayingVideo] = useState<"desktop" | "mobile" | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 760px)")
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updateActiveVideo = () => {
      setActiveVideo(reducedMotionQuery.matches ? null : mobileQuery.matches ? "mobile" : "desktop")
    }

    updateActiveVideo()
    mobileQuery.addEventListener("change", updateActiveVideo)
    reducedMotionQuery.addEventListener("change", updateActiveVideo)
    window.addEventListener("resize", updateActiveVideo)
    return () => {
      mobileQuery.removeEventListener("change", updateActiveVideo)
      reducedMotionQuery.removeEventListener("change", updateActiveVideo)
      window.removeEventListener("resize", updateActiveVideo)
    }
  }, [])

  useEffect(() => {
    setPlayingVideo(null)
    const video = videoRef.current
    if (!video || !activeVideo) return

    let cancelled = false
    video.muted = true
    video.defaultMuted = true
    void video.play().then(
      () => {
        if (!cancelled) setPlayingVideo(activeVideo)
      },
      () => {
        if (!cancelled) video.pause()
      },
    )
    return () => {
      cancelled = true
      video.pause()
    }
  }, [activeVideo])

  return (
    <main className={styles.page}>
      <section className={styles.hero} id="top" aria-labelledby="hero-title">
        <div className={styles.desktopArt} aria-hidden="true">
          <Image src={`${media}/hero-desktop.webp`} alt="" fill unoptimized sizes="100vw" />
          {activeVideo === "desktop" && (
            <video
              ref={videoRef}
              aria-hidden="true"
              data-playing={playingVideo === "desktop"}
              loop
              muted
              playsInline
              preload="none"
              poster={`${media}/hero-desktop.webp`}
              onError={() => setPlayingVideo(null)}
            >
              <source src={`${media}/hero-desktop.mp4`} type="video/mp4" />
            </video>
          )}
        </div>
        {/* Desktop art is an approved flattened concept. Hit regions are a temporary preview aid;
            replace embedded copy with accessible HTML before public launch. */}
        <nav className={styles.desktopHits} aria-label="Desktop marketing navigation">
          <a className={styles.brandHit} href="#top" aria-label="DirtyDuty home" />
          <a className={styles.howHit} href="#how-it-works" aria-label="How it works" />
          <a className={styles.storyHit} href="#our-story" aria-label="Our story" />
          <a className={styles.featuresHit} href="#features" aria-label="Features" />
          <a className={styles.faqHit} href="#faqs" aria-label="FAQs" />
          <Link className={styles.signHit} href="/" aria-label="Sign in" />
          <Link className={styles.startHit} href="/join" aria-label="Get started" />
          <Link className={styles.primaryHit} href="/join" aria-label="Get started for free" />
          <a className={styles.secondaryHit} href="#how-it-works" aria-label="See how it works" />
        </nav>
        <h1 id="hero-title" className={styles.srOnly}>
          Home, in sync.
        </h1>
        <header className={styles.mobileNav}>
          <a className={styles.brand} href="#top">
            dirty<span>duty</span>
          </a>
          <nav aria-label="Mobile marketing navigation">
            <Link href="/">Sign in</Link>
            <Link className={styles.smallButton} href="/join">
              Get started →
            </Link>
          </nav>
        </header>
        <div className={styles.mobileContent}>
          <p className={styles.eyebrow}>SHARED HOMES. HAPPIER DAYS.</p>
          <p className={styles.mobileTitle} aria-hidden="true">
            HOME,<span>IN SYNC.</span>
          </p>
          <p className={styles.description}>
            A simple way to share chores, keep things fair, and make more time for what really
            matters.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/join">
              Get started for free →
            </Link>
            <a className={styles.secondary} href="#how-it-works">
              See how it works
            </a>
          </div>
        </div>
        <div className={styles.mobileArt} aria-hidden="true">
          <Image
            src={`${media}/hero-mobile.webp`}
            alt=""
            fill
            unoptimized
            sizes="(max-width: 760px) 100vw, 390px"
          />
          {activeVideo === "mobile" && (
            <video
              ref={videoRef}
              aria-hidden="true"
              data-playing={playingVideo === "mobile"}
              loop
              muted
              playsInline
              preload="none"
              poster={`${media}/hero-mobile.webp`}
              onError={() => setPlayingVideo(null)}
            >
              <source src={`${media}/hero-mobile.mp4`} type="video/mp4" />
            </video>
          )}
        </div>
        <span className={styles.scroll}>SCROLL TO EXPLORE</span>
      </section>
      <section className={styles.details} id="how-it-works">
        <p className={styles.eyebrow}>THE IDEA</p>
        <h2>Less chasing. More living.</h2>
        <p>
          Bring your household together, share chores, and keep responsibilities visible to
          everyone.
        </p>
        <div id="features">
          <Link href="/join">Try DirtyDuty for free →</Link>
        </div>
      </section>
      <section className={styles.details} id="our-story">
        <h2>Made for shared homes.</h2>
        <p>From roommates to families, clarity helps everyone pitch in.</p>
      </section>
      <section className={styles.details} id="faqs">
        <h2>Good to know.</h2>
        <p>DirtyDuty is free to use and works in your mobile browser.</p>
      </section>
    </main>
  )
}
