export function workspaceNameError(value: string): string | null {
  const name = value.trim()
  if (!name) {
    return 'Enter a name for the new workspace.'
  }
  if (name === '.' || name === '..') {
    return 'Use a folder name, not "." or "..".'
  }
  if (name.includes('/') || name.includes('\\')) {
    return 'Use a single folder name without path separators.'
  }
  if (name.startsWith('.')) {
    return 'Folder names cannot start with a dot.'
  }
  return null
}
