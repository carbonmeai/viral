import { execFileSync } from "node:child_process"

// A synthetic clip (test pattern + tone) for tests that need a real video file.
export const makeTestVideo = (file: string, seconds: number) =>
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", file
  ])
