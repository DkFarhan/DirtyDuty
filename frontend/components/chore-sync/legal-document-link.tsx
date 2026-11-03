"use client"

import { useEffect, useState } from "react"
import { getLegalDocumentUrl, getLegalReturnContext } from "@/lib/chore-sync/legal-navigation"

type LegalDocumentLinkProps = {
  path: "/terms" | "/privacy"
  className: string
  children: React.ReactNode
}

export function LegalDocumentLink({ path, className, children }: LegalDocumentLinkProps) {
  const [href, setHref] = useState<string>(path)

  useEffect(() => {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo")
    const returnContext = getLegalReturnContext(returnTo)
    if (returnContext) setHref(getLegalDocumentUrl(path, returnContext))
  }, [path])

  return (
    <a className={className} href={href}>
      {children}
    </a>
  )
}
