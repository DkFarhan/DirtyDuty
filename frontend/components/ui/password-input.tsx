"use client"

import { useState, type InputHTMLAttributes } from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">

type PasswordInputWithToggleStyle = PasswordInputProps & {
  toggleClassName?: string
}

export function PasswordInput({
  className,
  toggleClassName,
  ...props
}: PasswordInputWithToggleStyle) {
  const [visible, setVisible] = useState(false)
  const label = visible ? "Hide password" : "Show password"

  return (
    <div className="relative">
      <input {...props} className={cn(className, "pr-12")} type={visible ? "text" : "password"} />
      <button
        aria-label={label}
        aria-pressed={visible}
        className={cn(
          "absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
          toggleClassName ?? "text-slate-500 hover:text-slate-800 focus-visible:ring-teal-500",
        )}
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        {visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
      </button>
    </div>
  )
}
