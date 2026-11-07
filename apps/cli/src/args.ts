// Minimal argv parsing for the dev CLI. Flags listed in BOOLEAN_FLAGS stand alone; any other
// `--name` takes the next argument as its value. Everything else is positional.
const BOOLEAN_FLAGS = new Set(["--force", "--again"])

const positionalArgs: Array<string> = []
const options = new Map<string, string>()
const flags = new Set<string>()

const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!
  if (!arg.startsWith("--")) positionalArgs.push(arg)
  else if (BOOLEAN_FLAGS.has(arg)) flags.add(arg)
  else options.set(arg, argv[++i] ?? "")
}

export const positionals: ReadonlyArray<string> = positionalArgs
export const flag = (name: string): boolean => flags.has(name)
export const option = (name: string): string | undefined => options.get(name)
