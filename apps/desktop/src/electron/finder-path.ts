import { isAbsolute, relative, resolve } from "node:path"

// Whether `target` is the Viral library or inside it, so the page can only reveal its own files in Finder.
export const isInsideLibrary = (library: string, target: string) => {
  const rel = relative(resolve(library), resolve(target))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}
