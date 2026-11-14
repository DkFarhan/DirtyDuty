import { CheckCircle2, CircleAlert } from "lucide-react"
import type { CardFeedbackView } from "@/lib/household/card-feedback"
import styles from "./card-feedback.module.css"

/** A short message under the card whose action produced it. Errors are alerts, confirmations status. */
export function CardFeedbackMessage({
  feedback,
  theme,
  className,
}: {
  feedback?: CardFeedbackView
  theme: "light" | "dark"
  className?: string
}) {
  if (!feedback) return null
  const error = feedback.tone === "error"
  const Icon = error ? CircleAlert : CheckCircle2
  return (
    <p
      className={[
        styles.message,
        theme === "dark" ? styles.darkTheme : styles.lightTheme,
        error ? styles.error : styles.success,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-card-feedback={feedback.tone}
      role={error ? "alert" : "status"}
    >
      <Icon aria-hidden="true" size={15} />
      <span>{feedback.message}</span>
    </p>
  )
}
