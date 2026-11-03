"use client"

import { apiUrl } from "@/lib/auth/api"

export function GoogleSignInButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.location.assign(apiUrl("/api/auth/oauth2/authorization/google"))}
      className={
        className ??
        "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-[15px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
      }
    >
      <span aria-hidden="true" className="google-sign-in-icon">
        G
      </span>
      <span className="google-sign-in-label">Continue with Google</span>
    </button>
  )
}
