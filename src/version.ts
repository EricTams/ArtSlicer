/**
 * What the home screen shows, so a deploy can be confirmed from the sofa.
 *
 * Two halves, because they answer different questions. The version counts up
 * by one per commit, which is the number to read out or compare at a glance;
 * the build is the exact commit behind it, for when a glance is not enough.
 *
 * Counted rather than written down, because a version somebody has to remember
 * to bump is a version that sits still through the pushes where it mattered.
 */
export const APP_VERSION = `0.${String(__BUILD_NUMBER__).padStart(3, '0')}`

/** Short commit of the build, or `dev` when built outside a git checkout. */
export const BUILD_SHA = __BUILD_SHA__
