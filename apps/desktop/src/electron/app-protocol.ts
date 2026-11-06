import { net, protocol } from "electron"
import { join, normalize, relative, isAbsolute } from "node:path"
import { pathToFileURL } from "node:url"
import { contentSecurityPolicy } from "../backend/server-launch.ts"

export const APP_SCHEME = "viral"
export const APP_ORIGIN = `${APP_SCHEME}://app`

// Must run before the app is ready: viral:// behaves like a secure, standard origin.
export const registerAppSchemePrivileges = () =>
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }
  ])

// Serves the built UI (Resources/web) at viral://app/, with the app's content security policy on every
// response. Paths can't leave the web folder.
export const serveAppProtocol = (webRoot: string, serverUrl: string) =>
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    const wanted = normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname))
    const file = join(webRoot, wanted)
    const inside = relative(webRoot, file)
    if (inside.startsWith("..") || isAbsolute(inside)) return new Response("Not Found", { status: 404 })
    const response = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(response.headers)
    headers.set("Content-Security-Policy", contentSecurityPolicy(APP_SCHEME, serverUrl))
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })
