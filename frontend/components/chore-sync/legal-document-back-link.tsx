"use client"

import { useEffect, useState } from "react"
import { getLegalReturnContext, getLegalReturnUrl } from "@/lib/chore-sync/legal-navigation"

const backActionClassName =
  "flex min-h-11 items-center rounded-lg text-sm font-semibold text-slate-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-slate-300 dark:hover:text-teal-300"

export function LegalDocumentBackLink() {
  const [href, setHref] = useState<string | null>(null)
  const [signupReturn, setSignupReturn] = useState(false)

  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo")
    const returnContext = getLegalReturnContext(returnTo)
    if (returnContext === "register") {
      setSignupReturn(true)
      return
    }
    setHref(getLegalReturnUrl(returnTo))
  }, [])

  if (signupReturn) {
    return (
      <div>
        <button className={backActionClassName} onClick={() => window.close()} type="button">
          <span aria-hidden="true" className="mr-1 text-lg">
            ‹
          </span>
          Back
        </button>
      </div>
    )
  }

  if (href === null) {
    return (
      <span aria-hidden="true" className={backActionClassName}>
        <span className="mr-1 text-lg">‹</span>
        Back
      </span>
    )
  }

  return (
    <a aria-label="Back to DirtyDuty" className={backActionClassName} href={href}>
      <span aria-hidden="true" className="mr-1 text-lg">
        ‹
      </span>
      Back
    </a>
  )
}
