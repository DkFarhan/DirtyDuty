import { Libre_Baskerville } from "next/font/google"
import { notFound } from "next/navigation"
import { HouseholdSecondaryDesignPreview } from "@/components/chore-sync/redesign/household-secondary-design-preview"
import { isDesignPreviewEnabled } from "../preview-access"

export const dynamic = "force-dynamic"

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-libre-baskerville",
})

export default function ChoreFormDesignPreviewPage() {
  if (!isDesignPreviewEnabled()) notFound()
  return (
    <div className={libreBaskerville.variable}>
      <HouseholdSecondaryDesignPreview screen="chore-form" />
    </div>
  )
}
