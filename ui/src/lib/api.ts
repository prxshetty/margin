// VITE_API_BASE lets an isolated instance (the E2E suite) point the UI at its
// own backend. Normal use leaves it unset and talks to the local API on :8000.
export const API_BASE: string = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000'
