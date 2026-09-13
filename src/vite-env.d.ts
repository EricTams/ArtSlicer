/// <reference types="vite/client" />

/** Short commit of the build, injected by vite.config.ts. */
declare const __BUILD_SHA__: string

/** Commits since versioning began, injected by vite.config.ts. */
declare const __BUILD_NUMBER__: number

interface ImportMetaEnv {
  /** Comma-separated TURN URLs. Empty or unset builds run STUN-only. */
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
}
