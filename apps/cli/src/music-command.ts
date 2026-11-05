import { MusicTrack, MusicTrackId } from "@viral/contracts"
import { Console, Effect, Path } from "effect"
import { option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { show } from "./show.ts"

export const MUSIC_USAGE = `  music add <file> [--title <title>]
  music list | show <id> | remove <id>`

const describe = (track: MusicTrack) => {
  const analysis = track.bpm === null ? "not analysed" : `${track.bpm} bpm, drop ${track.dropS}s`
  return `${track.id}  ${track.title}  (${analysis})`
}

export const musicCommand = Effect.fn("musicCommand")(function*() {
  const client = yield* Client
  const path = yield* Path.Path
  const [, sub = "list", arg] = positionals

  switch (sub) {
    case "add": {
      if (arg === undefined) return yield* Console.error(MUSIC_USAGE)
      const track = yield* client.AddMusicTrack({ file: path.resolve(arg), title: option("--title") ?? null })
      return yield* Console.log(describe(track))
    }
    case "list":
      return yield* Effect.forEach(yield* client.ListMusicTracks(), (t) => Console.log(describe(t)), { discard: true })
    case "show":
      return yield* show(MusicTrack)(yield* client.GetMusicTrack({ id: MusicTrackId.make(arg ?? "") }))
    case "remove":
      return yield* Console.log(`removed: ${yield* client.RemoveMusicTrack({ id: MusicTrackId.make(arg ?? "") })}`)
    default:
      return yield* Console.error(MUSIC_USAGE)
  }
})
