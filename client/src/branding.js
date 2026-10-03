/**
 * Event branding.
 *
 * ---------------------------------------------------------------------
 * Why this is configuration and not text in the components
 * ---------------------------------------------------------------------
 *
 * This quiz engine was built for Royal Rangers and is now used for
 * church media events by people who are not Royal Rangers. The old copy
 * was baked into four files, which meant every event either accepted
 * someone else's branding on a projector in front of a thousand people
 * or asked for a code edit minutes before doors opened.
 *
 * Every visible name now comes from here, so an event is a rebuild with
 * different environment variables rather than a change to the app.
 *
 * Defaults describe THIS event -- the Edo District Media Summit -- so a
 * build with no variables set still shows something correct rather than
 * falling back to the wrong organisation. Setting the variables
 * re-brands it for another event without touching a component.
 *
 * The arena name and the visuals are deliberately left alone. The gold-on-
 * navy look and the word OSCAR are the product; what changes is whose
 * event it is running.
 */

const env = import.meta.env ?? {};

export const BRANDING = {
  /** Shown on the player join screen. */
  eventName: env.VITE_EVENT_NAME ?? 'Edo District Media Summit',
  /** Sub-heading under the arena name. */
  tagline: env.VITE_EVENT_TAGLINE ?? 'Who will rule the arena?',
  /** Footer line on the landing page. */
  footnote:
    env.VITE_EVENT_FOOTNOTE ??
    'Free for every church in the district · works on any phone · designed for offline-ish networks',
  /** Small label on the host login screen. */
  hostLabel: env.VITE_HOST_LABEL ?? 'Media Summit Quiz Control',
  /** Browser tab / meta description. */
  title: env.VITE_BRAND_TITLE ?? 'OSCAR ARENA — Edo District Media Summit',
  description:
    env.VITE_BRAND_DESCRIPTION ??
    'OSCAR ARENA — Edo District Media Summit. Enter the game PIN to join.',
};
