/** Returns an error message if the username is invalid, or null if valid. */
export function validateUsername(name: string): string | null {
  if (name.length < 3) return 'Username must be at least 3 characters.'
  if (name.length > 20) return 'Username must be at most 20 characters.'
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Only letters, numbers and underscore are allowed.'
  return null
}
