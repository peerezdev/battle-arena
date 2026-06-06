import type { Allocation } from './types'

// Canónico y estable: orden fijo de campos. Replicable en Rust (mismo string -> SHA-256).
function canonical(allocation: Allocation, salt: string): string {
  return `${allocation.apertura}|${allocation.choque}|${allocation.remate}|${salt}`
}

export async function hashAllocation(allocation: Allocation, salt: string): Promise<string> {
  const data = new TextEncoder().encode(canonical(allocation, salt))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
