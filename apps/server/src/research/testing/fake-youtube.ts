import { join } from "node:path"

// The fake yt-dlp the research tests run instead of YouTube (VIRAL_YT_DLP or YouTube.layerWith).
export const FAKE_YT_DLP = join(import.meta.dirname, "fake-yt-dlp.ts")
