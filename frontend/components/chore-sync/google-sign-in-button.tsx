"use client"

import { apiUrl } from "@/lib/auth/api"

export function GoogleSignInButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.assign(apiUrl("/api/auth/oauth2/authorization/google"))}
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-[15px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className="bg-gradient-to-br from-blue-600 via-green-600 to-amber-500 bg-clip-text text-lg font-black text-transparent"
      >
        G
      </span>
      <span>Continue with Google</span>
    </button>
  )
}
