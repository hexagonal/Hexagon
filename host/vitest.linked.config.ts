/**
 * The same suite, with every workspace root reached through a symlink.
 *
 * A project directory settles by its canonical path while a client keeps
 * sending the folder it was given, and where those differ every file has two
 * names. Whether a run's temporary directory is canonical is a property of the
 * machine — `/var/folders/…` on macOS, `/tmp` on a Linux runner — so a single
 * run silently covers only one of the two, and which one is nobody's choice.
 * This config picks the other on purpose (`src/test-roots.ts` reads the
 * variable), and `npm test` runs both.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { env: { HEXAGON_TEST_LINKED_ROOT: "1" } },
});
