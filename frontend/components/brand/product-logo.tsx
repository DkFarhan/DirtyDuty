import Image from "next/image"

type ProductLogoProps = {
  variant?: "horizontal" | "mark"
  className?: string
  decorative?: boolean
  themeAware?: boolean
}

export function ProductLogo({
  variant = "horizontal",
  className,
  decorative = false,
  themeAware = false,
}: ProductLogoProps) {
  const isHorizontal = variant === "horizontal"

  if (isHorizontal && themeAware) {
    return (
      <span className="auth-logo-surface auth-logo-theme-aware">
        <Image
          alt={decorative ? "" : "DirtyDuty"}
          aria-hidden={decorative || undefined}
          className={`${className ?? ""} auth-logo-theme-light`}
          height={200}
          priority
          src="/brand/dirtyduty-logo-horizontal.svg"
          width={542}
        />
        <Image
          alt=""
          aria-hidden="true"
          className={`${className ?? ""} auth-logo-theme-dark`}
          height={200}
          priority
          src="/brand/dirtyduty-logo-horizontal-dark.svg"
          width={542}
        />
      </span>
    )
  }

  const image = (
    <Image
      alt={decorative ? "" : "DirtyDuty"}
      aria-hidden={decorative || undefined}
      className={className}
      height={isHorizontal ? 200 : 260}
      priority
      src={isHorizontal ? "/brand/dirtyduty-logo-horizontal.svg" : "/brand/dirtyduty-mark.svg"}
      width={isHorizontal ? 542 : 320}
    />
  )

  return isHorizontal ? <span className="auth-logo-surface">{image}</span> : image
}
