import { describe, expect, it } from 'vitest'
import { workspaceNameError } from './workspaceName'

describe('workspaceNameError', () => {
  it('accepts an ordinary folder name', () => {
    expect(workspaceNameError('my-new-novel')).toBeNull()
    expect(workspaceNameError('  my-new-novel  ')).toBeNull()
  })

  it('requires a name', () => {
    expect(workspaceNameError('')).toBe('Enter a name for the new workspace.')
    expect(workspaceNameError('   ')).toBe('Enter a name for the new workspace.')
  })

  it('rejects dot traversal names', () => {
    expect(workspaceNameError('.')).toBe('Use a folder name, not "." or "..".')
    expect(workspaceNameError('..')).toBe('Use a folder name, not "." or "..".')
  })

  it('rejects separators and dot-prefixed folders', () => {
    expect(workspaceNameError('novels/first')).toBe('Use a single folder name without path separators.')
    expect(workspaceNameError('novels\\first')).toBe('Use a single folder name without path separators.')
    expect(workspaceNameError('../first')).toBe('Use a single folder name without path separators.')
    expect(workspaceNameError('.hidden')).toBe('Folder names cannot start with a dot.')
  })
})
