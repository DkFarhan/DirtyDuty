"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Check, Smartphone, UsersRound } from "lucide-react"
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
        <div className={styles.desktopCanvas}>
          <div className={styles.desktopMedia} aria-hidden="true">
            <Image src={`${media}/hero-desktop.webp`} alt="" fill unoptimized sizes="100vw" />
            {activeVideo === "desktop" && (
              <video
                ref={videoRef}
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
          <header className={styles.header}>
            <a className={styles.brand} href="#top" aria-label="DirtyDuty home">
              dirty<span>duty</span>
            </a>
            <nav className={styles.primaryNav} aria-label="Main navigation">
              <a href="#how-it-works">How it works</a>
              <a href="#our-story">Our story</a>
              <a href="#features">Features</a>
              <a href="#faqs">FAQs</a>
            </nav>
            <nav className={styles.accountNav} aria-label="Account navigation">
              <Link href="/">Sign in</Link>
              <Link className={styles.topCta} href="/join">
                Get started <span aria-hidden="true">→</span>
              </Link>
            </nav>
          </header>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>SHARED HOMES. HAPPIER DAYS.</p>
            <h1 className={styles.title} id="hero-title">
              HOME,<span>IN SYNC.</span>
            </h1>
            <p className={styles.description}>
              A simple way to share chores, keep things fair,
              <br className={styles.desktopBreak} />
              and make more time for what really matters.
            </p>
            <div className={styles.actions}>
              <Link className={`${styles.button} ${styles.primary}`} href="/join">
                Get started for free <span aria-hidden="true">→</span>
              </Link>
              <a className={`${styles.button} ${styles.secondary}`} href="#how-it-works">
                <span className={styles.secondaryIcon} aria-hidden="true">
                  ↗
                </span>
                See how it works
              </a>
            </div>
            <ul className={styles.proofPoints} aria-label="DirtyDuty at a glance">
              <li>
                <Check aria-hidden="true" />
                <span>Free to use</span>
              </li>
              <li>
                <UsersRound aria-hidden="true" />
                <span>
                  Perfect for
                  <br />
                  roommates and families
                </span>
              </li>
              <li>
                <Smartphone aria-hidden="true" />
                <span>
                  Works on
                  <br />
                  all devices (PWA)
                </span>
              </li>
            </ul>
          </div>
          <div className={styles.scroll}>
            <span className={styles.scrollMark} aria-hidden="true">
              ◌
            </span>
            <span>SCROLL TO EXPLORE</span>
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
      </section>
      <section className={styles.details} id="how-it-works">
        <p className={styles.detailsEyebrow}>THE IDEA</p>
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
