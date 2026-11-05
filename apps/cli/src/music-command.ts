import { MusicTrack, MusicTrackId, Rights } from "@viral/contracts"
import { Console, Effect, Path, Schema } from "effect"
import { option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { show } from "./show.ts"

export const MUSIC_USAGE = `  music add <file> [--title <title>] [--rights owned|licensed]
  music rights <id> <unconfirmed|owned|licensed>
  music list | show <id> | remove <id>`

const decodeRights = Schema.decodeUnknownEffect(Rights)

const describe = (track: MusicTrack) => {
  const analysis = track.bpm === null ? "not analysed" : `${track.bpm} bpm, drop ${track.dropS}s`
  return `${track.id}  ${track.rights.padEnd(11)} ${track.title}  (${analysis})`
}

export const musicCommand = Effect.fn("musicCommand")(function*() {
  const client = yield* Client
  const path = yield* Path.Path
  const [, sub = "list", arg, value] = positionals

  switch (sub) {
    case "add": {
      if (arg === undefined) return yield* Console.error(MUSIC_USAGE)
      const track = yield* client.AddMusicTrack({
        file: path.resolve(arg),
        title: option("--title") ?? null,
        rights: yield* decodeRights(option("--rights") ?? "unconfirmed")
      })
      return yield* Console.log(describe(track))
    }
    case "rights":
      return yield* Console.log(describe(yield* client.SetMusicTrackRights({
        id: MusicTrackId.make(arg ?? ""),
        rights: yield* decodeRights(value)
      })))
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
