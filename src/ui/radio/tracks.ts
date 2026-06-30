// Radio track list. URLs are external (CDN). Swap these placeholders for the
// real song URLs — no other file needs to change.
export type Track = {
  id: string
  title: string
  artist: string
  url: string
}

export const TRACKS: Track[] = [
  { id: 'neon-drive', title: 'Neon Drive', artist: 'TBD', url: 'https://cdn.example.com/neon-drive.mp3' },
  { id: 'cyber-run', title: 'Cyber Run', artist: 'TBD', url: 'https://cdn.example.com/cyber-run.mp3' },
  { id: 'synth-city', title: 'Synth City', artist: 'TBD', url: 'https://cdn.example.com/synth-city.mp3' },
]
