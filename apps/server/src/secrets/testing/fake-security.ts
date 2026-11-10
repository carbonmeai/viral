import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// A fake macOS `security` in `dir`: the Keychain is one file per account (item-<account>), and every command line
// it was given is logged to argv.log (stdin commands to stdin.log), so a test can check a key never appears in the
// arguments. Returns the command's path.
export const writeFakeSecurity = (dir: string) => {
  const security = join(dir, "security")
  writeFileSync(security, `#!/bin/sh
D="${dir}"
echo "$*" >> "$D/argv.log"
if [ "$1" = "find-generic-password" ]; then
  [ -f "$D/item-$5" ] || exit 44
  cat "$D/item-$5"; exit 0
fi
if [ "$1" = "-i" ]; then
  read -r line
  echo "$line" >> "$D/stdin.log"
  set -- $line
  if [ "$1" = "add-generic-password" ]; then printf "%s" "$8" > "$D/item-$6"; exit 0; fi
  if [ "$1" = "delete-generic-password" ]; then rm -f "$D/item-$5"; exit 0; fi
fi
exit 1
`)
  chmodSync(security, 0o755)
  return security
}
