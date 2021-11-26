interface LatestSongResponse {
  next: string
  data: Array<Data>
}

interface Data {
  id: string
  type: string
  href: string
  attributes: Attributes
}

interface AppleMusicSong {
  artistName: string
  name: string
  durationInMillis: number
}
