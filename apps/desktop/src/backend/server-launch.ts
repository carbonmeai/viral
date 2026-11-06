// How the desktop app starts the Viral server, kept free of Electron so it can be tested.

export interface LaunchInput {
  readonly packaged: boolean
  // Electron's own binary; packaged builds run the server on it as plain Node
  readonly execPath: string
  // the app's Resources folder (packaged) holding server/ and web/
  readonly resourcesPath: string
  // the repository root (development)
  readonly repoRoot: string
  readonly port: number
  // the PATH the app was started with
  readonly path: string
  // the app's own process id: the server stops when this process is gone
  readonly parentPid: number
}

export interface Launch {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env: Record<string, string>
}

// Packaged: Electron-as-Node runs the bundled server. Tools (ffmpeg, uv, yt-dlp) aren't bundled: the server
// puts its own tools folder first on the PATH and downloads what's missing.
// Development: node runs the server's TypeScript straight from the repo, with the repo's .env.
export const serverLaunch = (input: LaunchInput): Launch =>
  input.packaged
    ? {
      command: input.execPath,
      args: [`${input.resourcesPath}/server/main.mjs`],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        VIRAL_PORT: String(input.port),
        VIRAL_PARENT_PID: String(input.parentPid),
        PATH: input.path
      }
    }
    : {
      command: "node",
      args: ["--env-file-if-exists=.env", "apps/server/src/main.ts"],
      env: { VIRAL_PORT: String(input.port), VIRAL_PARENT_PID: String(input.parentPid), PATH: input.path }
    }

// Waits between restarts after the server exits: 0.5s, 1s, 2s … up to 10s.
export const restartDelayMs = (attempt: number) => Math.min(10_000, 500 * 2 ** Math.max(0, attempt))

// The app's content security policy: its own files, and the local server for data, frames, audio and video.
export const contentSecurityPolicy = (scheme: string, server: string) => {
  const ws = server.replace(/^http/, "ws")
  return [
    "default-src 'self'",
    "script-src 'self'",
    `connect-src 'self' ${server} ${ws}`,
    `img-src 'self' ${scheme}: data: blob: ${server}`,
    `media-src 'self' ${scheme}: blob: ${server}`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' ${scheme}: data:`,
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'"
  ].join("; ")
}

// Only the app's own pages may be shown in the window; anything else is refused.
export const isAppUrl = (url: string, appOrigins: ReadonlyArray<string>) => {
  try {
    // URL.origin is "null" for custom schemes like viral://, so compare scheme and host
    const parsed = new URL(url)
    return appOrigins.includes(`${parsed.protocol}//${parsed.host}`)
  } catch {
    return false
  }
}
