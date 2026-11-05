import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// Fixtures synced by `bun run fixtures:sync`; tests skip when they are missing.
export const CANDY_DIR = join(homedir(), ".viral/fixtures/candy")
export const hasCandyFixture = existsSync(CANDY_DIR)
export const readCandyJson = (file: string): unknown => JSON.parse(readFileSync(join(CANDY_DIR, file), "utf8"))
