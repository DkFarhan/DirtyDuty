# Home in Sync landing-page review

This is an **unmerged, review-only feature branch**. Existing / chore application and PWA routing stay intact.

## Preview
- /landing: desktop Original 01 animated artwork and separately rendered mobile text/buttons.
- /join: existing AppShell registration flow, no duplicated authentication.
- All marketing nav anchors lead to content below, while sign-in returns to the existing application at /.
- H.264 loop uses muted autoplay playsInline, static WebP as fallback, CSS reduced-motion override.

## Required media before testing
Copy the four binary files from the accompanying downloadable `DirtyDuty_Landing_FirstScreen_Implementation.zip` into `frontend/public/landing/media/` on this branch:
- hero-desktop.mp4
- hero-desktop.webp
- hero-mobile.mp4
- hero-mobile.webp

The GitHub text connector cannot attach local binary files. **Until those four files are committed, this route will not display the artwork.**

## Not production-ready
The desktop cinematic video/poster includes baked-in UI copy and links. The position-based links in this version are a temporary review mechanism, **not a final semantic and responsive solution**. The next step is a clean, art-only desktop asset and fully live desktop HTML typography/navigation; keep original look identical. Mobile already has live text.

Do not switch / to the marketing site or change the PWA manifest in this PR. Do not merge before reviewing iPhone Safari, desktop Safari/Chrome, overflow at intermediate widths, video loop/autoplay, keyboard focus, reduced motion, and assets loaded over a constrained connection.

After assets are committed, run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` in frontend and test `/landing`. No full repo dependency build was run in the chat environment.
