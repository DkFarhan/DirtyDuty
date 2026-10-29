import { Libre_Baskerville } from "next/font/google"
import { notFound } from "next/navigation"
import { MyChoresDesignPreview } from "@/components/chore-sync/redesign/my-chores-design-preview"
import { isDesignPreviewEnabled } from "../preview-access"

export const dynamic = "force-dynamic"

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-libre-baskerville",
})

export default function MyChoresDesignPreviewPage() {
  if (!isDesignPreviewEnabled()) notFound()

  return (
    <div className={libreBaskerville.variable}>
      <MyChoresDesignPreview />
    </div>
  )
}
