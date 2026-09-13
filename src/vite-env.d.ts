/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Comma-separated TURN URLs. Empty or unset builds run STUN-only. */
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
}
