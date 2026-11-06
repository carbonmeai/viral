import { MusicTrack, MusicTrackId, Rights } from "@viral/contracts"
import { Console, Effect, Path, Schema } from "effect"
import { option, positionals } from "./args.ts"
import { Client } from "./client.ts"
import { show } from "./show.ts"

export const MUSIC_USAGE = `  music add <file> [--title <title>] [--rights owned|licensed]
  music rights <id> <unconfirmed|owned|licensed>
  music analyse <id>                     (measure tempo, drop and loudness again; adding a track already does)
  music beat <id> <bpm> <drop-seconds>   (set tempo and drop yourself; analysis never overwrites these)
  music list | show <id> | remove <id>`

const decodeRights = Schema.decodeUnknownEffect(Rights)

const describe = (track: MusicTrack) => {
  const beat = track.bpm === null
    ? track.analyzedAt === null ? "not analysed yet" : "no clear beat"
    : `${track.bpm} bpm, ${track.dropS === null ? "no drop" : `drop ${track.dropS}s`}${track.beatSource === "manual" ? " (set by you)" : ""}`
  const loudness = track.loudnessLufs === null ? "" : `, ${track.loudnessLufs} LUFS`
  const analysis = `${beat}${loudness}`
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
    case "analyse":
      return yield* Console.log(describe(yield* client.AnalyseMusicTrack({ id: MusicTrackId.make(arg ?? "") })))
    case "beat": {
      const bpm = Number(value)
      const drop = Number(positionals[4])
      if (!(bpm > 0) || !(drop >= 0)) return yield* Console.error(MUSIC_USAGE)
      return yield* Console.log(describe(yield* client.SetMusicTrackBeat({ id: MusicTrackId.make(arg ?? ""), bpm, dropS: drop })))
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
