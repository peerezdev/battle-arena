// Radio track list. URLs are external (CDN). Swap these placeholders for the
// real song URLs — no other file needs to change.
export type Track = {
  id: string
  title: string
  artist: string
  url: string
}

export const TRACKS: Track[] = [
  { id: 'blue-red', title: 'Blue Red Battle', artist: 'TBD', url: 'https://archive.org/download/route-24_202606/blue-red.m4a' },
  { id: 'lav-town', title: 'Lavender Town', artist: 'TBD', url: 'https://archive.org/download/route-24_202606/lavender-town.m4a' },
  { id: 'route-24', title: 'Route 24', artist: 'TBD', url: 'https://archive.org/download/route-24_202606/route-24.m4a' },
]
