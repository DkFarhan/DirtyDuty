"use client"

import { useEffect, useState } from "react"
import { getLegalDocumentUrl, getLegalReturnScreen } from "@/lib/chore-sync/legal-navigation"

type LegalDocumentLinkProps = {
  path: "/terms" | "/privacy"
  className: string
  children: React.ReactNode
}

export function LegalDocumentLink({ path, className, children }: LegalDocumentLinkProps) {
  const [href, setHref] = useState<string>(path)

  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo")
    const returnScreen = getLegalReturnScreen(returnTo)
    if (returnScreen) setHref(getLegalDocumentUrl(path, returnScreen))
  }, [path])

  return (
    <a className={className} href={href}>
      {children}
    </a>
  )
}
