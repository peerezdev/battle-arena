// Client-side commit-reveal verification. Mirrors backend provably_fair.seed_hash exactly:
// sha256(utf8(server_seed)) as lowercase hex. Lets anyone verify the revealed seed matches
// the committed hash without trusting the backend's commit_ok.
export async function seedHashHex(seed: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function verifyCommit(serverSeed: string, serverSeedHash: string): Promise<boolean> {
  return (await seedHashHex(serverSeed)) === serverSeedHash
}
