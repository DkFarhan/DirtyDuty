import { Libre_Baskerville } from "next/font/google"
import { notFound } from "next/navigation"
import { HouseholdDesignPreview } from "@/components/chore-sync/redesign/household-design-preview"
import { isDesignPreviewEnabled } from "../preview-access"

export const dynamic = "force-dynamic"

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-libre-baskerville",
})

export default function HouseholdDesignPreviewPage() {
  if (!isDesignPreviewEnabled()) notFound()

  return (
    <div className={libreBaskerville.variable}>
      <HouseholdDesignPreview />
    </div>
  )
}
