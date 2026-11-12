/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional: Firebase Realtime Database URL for live air-quality readings */
  readonly VITE_FIREBASE_DB_URL?: string
  /** Optional: path of the node the device writes, e.g. devices/respai-01/latest */
  readonly VITE_FIREBASE_PATH?: string
}
