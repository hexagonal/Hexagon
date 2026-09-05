import type { PlaygroundExample } from "./hello-world";

export const modules: PlaygroundExample = {
  id: "modules-as-files",
  title: "Two Modules in One File",
  description: "Declare several modules in one buffer, and import one from the other.",
  source: `// A module is a named declaration, not a file (Modules §2.1). A file may hold
// several, each closed by \`end module\` before the next one's header (§2.2).
module Numbers

export let answer: Int = 21
export let double(value: Int): Int = value * 2

end module Numbers

// Modules sharing a file are strangers: this one sees Numbers only because it
// imports it (§2.2), and the import names the module and carries no path (§3.1).
module Main

import Numbers

Debug.log("\${Numbers.double(Numbers.answer)}")
`,
  specificationReferences: ["spec/modules.md"],
};
