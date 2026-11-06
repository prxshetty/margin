interface ImportMetaEnv {
  /** Backend origin; defaults to http://127.0.0.1:8000 when unset. */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
