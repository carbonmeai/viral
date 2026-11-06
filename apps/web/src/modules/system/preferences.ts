import { Atom } from "effect/reactivity"

// Choices this viewer makes for themselves, kept in localStorage. They work without it (a private window, a
// blocked store): the default is used and nothing is saved.
const persisted = <A extends string>(key: string, allowed: ReadonlyArray<A>, fallback: A) => {
  const read = (): A => {
    try {
      const value = localStorage.getItem(key)
      return allowed.find((a) => a === value) ?? fallback
    } catch {
      return fallback
    }
  }
  return Atom.writable(
    () => read(),
    (ctx, value: A) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // nothing to keep it in; the choice lasts until reload
      }
      ctx.setSelf(value)
    }
  ).pipe(Atom.keepAlive)
}

export type Theme = "system" | "dark" | "light"
export type Mode = "simple" | "detailed"

export const themeAtom = persisted<Theme>("viral.theme", ["system", "dark", "light"], "system")
// Detailed shows the numbers behind each item (approach, length, source); it's the default.
export const modeAtom = persisted<Mode>("viral.mode", ["simple", "detailed"], "detailed")
