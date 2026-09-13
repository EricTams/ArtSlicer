/**
 * What the home screen shows, so a deploy can be confirmed from the sofa.
 *
 * Two halves, because they answer different questions. The version is a
 * milestone and moves when it is worth saying something has changed; the build
 * is whatever commit produced the bundle in front of you, and moves by itself.
 * Without the second, a version somebody forgot to bump quietly says the old
 * build is still live when it is not.
 */
export const APP_VERSION = '0.007'

/** Short commit of the build, or `dev` when built outside a git checkout. */
export const BUILD_SHA = __BUILD_SHA__
