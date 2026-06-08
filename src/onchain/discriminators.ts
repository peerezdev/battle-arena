import idl from './idl/battle_arena.json'

type IdlIx = { name: string; discriminator: number[] }

export function discriminator(name: string): Buffer {
  const ix = (idl as { instructions: IdlIx[] }).instructions.find((i: IdlIx) => i.name === name)
  if (!ix || !ix.discriminator) throw new Error(`sin discriminador para ${name}`)
  return Buffer.from(ix.discriminator)
}
