// Shared Margin glyphs — one source for the bubble, slash menu, and any
// future surface. All currentColor so they tint with surrounding text.
// (Lucide covers generic UI chrome; these four are product vocabulary.)
interface BrandIconProps {
  className?: string
}

/** Cue — minimal double-quote mark ("reference this passage"). */
export function CueIcon({ className = 'w-3.5 h-3.5' }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`${className} shrink-0`} aria-hidden="true">
      <path d="M9.5 7C6.5 8.5 5 11 5 14v3h6v-6H7.8c.3-1.7 1.2-3 2.7-3.8L9.5 7zm9 0c-3 1.5-4.5 4-4.5 7v3h6v-6h-3.2c.3-1.7 1.2-3 2.7-3.8L18.5 7z" />
    </svg>
  )
}

/** Rewrite — magic-pen mark. Full-bleed and dense, so render it one step
 *  smaller than its siblings for equal optical height. */
export function RewriteIcon({ className = 'w-3 h-3' }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`${className} shrink-0`} aria-hidden="true">
      <path d="m4.713 7.128l-.246.566a.506.506 0 0 1-.934 0l-.246-.566a4.36 4.36 0 0 0-2.22-2.25l-.759-.339a.53.53 0 0 1 0-.963l.717-.319A4.37 4.37 0 0 0 3.276.931L3.53.32a.506.506 0 0 1 .942 0l.253.61a4.37 4.37 0 0 0 2.25 2.327l.718.32a.53.53 0 0 1 0 .962l-.76.338a4.36 4.36 0 0 0-2.219 2.251m1.621 8.687c.176-.582.373-1.159.605-1.782c2.056-5.527 5.48-8.951 11.074-9.818c-.513 1.143-.998 1.938-1.427 2.367l-1.001 1.002L14.172 9l1.456 1.454c-1.13 2.085-3.363 3.745-5.876 4.059c-1.317.165-2.459.607-3.418 1.303M18 9.997l-1-1l1.003-1.003Q19.502 6.493 21 1.997c-14.689 0-16.911 13.425-17.936 19.616L3 21.997h1.998q.999-5 5.002-5.5c4-.5 7-3.5 8-6.5" />
    </svg>
  )
}

/** Imagine — four-point diamond. */
export function ImagineIcon({ className = 'w-3.5 h-3.5' }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`${className} shrink-0`} aria-hidden="true">
      <path d="M12 2c.7 5.5 4.5 9.3 10 10-5.5.7-9.3 4.5-10 10-.7-5.5-4.5-9.3-10-10 5.5-.7 9.3-4.5 10-10z" />
    </svg>
  )
}

/** Upload — file tray with an up arrow (stroke 1.5 to match UI chrome). */
export function UploadIcon({ className = 'w-3.5 h-3.5' }: BrandIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className={`${className} shrink-0`}
      aria-hidden="true"
    >
      <path strokeMiterlimit={10} d="M12 3.212v12.026" />
      <path strokeLinejoin="round" d="M16.625 7.456L12.66 3.49a.937.937 0 0 0-1.318 0L7.375 7.456" />
      <path d="M2.75 13.85v4.625a2.312 2.312 0 0 0 2.313 2.313h13.875a2.312 2.312 0 0 0 2.312-2.313V13.85" />
    </svg>
  )
}
