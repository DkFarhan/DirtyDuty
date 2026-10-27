# Home in Sync landing-page review

This is an **unmerged, review-only feature branch**. Existing / chore application and PWA routing stay intact.

## Preview
- `/landing` is a review-only landing page. The `/` application route and PWA configuration remain unchanged.
- Desktop uses the approved flattened desktop artwork with accessible position-based navigation links. Mobile uses the approved mobile artwork with live HTML copy and CTAs.
- Sign-in returns to `/`; get-started links open `/join`, which uses the existing registration flow. Marketing anchors lead to the corresponding landing-page sections.
- Four checked-in media assets are present under `frontend/public/landing/media/`: desktop MP4/WebP (1672 × 941 poster) and mobile MP4/WebP (390 × 480 poster).
- At runtime only the video for the current viewport is mounted. It attempts muted inline playback; the matching WebP remains visible if playback is rejected, and videos are not mounted when reduced motion is requested.
- The local `/join` route loaded, but its authentication API calls could not be exercised because the backend on port 8080 was unavailable.

## Review status
The artwork and overall hero design are approved and should not be replaced or redesigned. The desktop artwork includes baked-in copy, so its accessible links remain position-based and should be rechecked if that asset or its crop changes.

The local review verified HTTP responses for all four media assets and inspected `/landing` at 390 × 844, 430 × 932, 1440 × 900, and 1920 × 1080. Browser testing does not replace manual review on iPhone Safari and desktop Safari/Chrome, especially for autoplay policy, keyboard focus, and constrained-connection behavior.

Do not switch `/` to the marketing site or change the PWA manifest, service worker, backend, or production configuration as part of this feature.
