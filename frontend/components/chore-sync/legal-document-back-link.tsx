"use client"

import { useEffect, useState } from "react"
import { getLegalReturnUrl } from "@/lib/chore-sync/legal-navigation"

export function LegalDocumentBackLink() {
  const [href, setHref] = useState("/")

  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo")
    setHref(getLegalReturnUrl(returnTo))
  }, [])

  return (
    <a
      aria-label="Back to DirtyDuty"
      className="flex min-h-10 items-center rounded-lg text-sm font-semibold text-slate-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-slate-300 dark:hover:text-teal-300"
      href={href}
    >
      <span aria-hidden="true" className="mr-1 text-lg">
        ‹
      </span>
      Back
    </a>
  )
}
