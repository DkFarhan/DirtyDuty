import Image from "next/image"

type ProductLogoProps = {
  variant?: "horizontal" | "mark"
  className?: string
  decorative?: boolean
}

export function ProductLogo({
  variant = "horizontal",
  className,
  decorative = false,
}: ProductLogoProps) {
  const isHorizontal = variant === "horizontal"

  return (
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
}
