import type { PlaygroundExample } from "./hello-world";

export const modules: PlaygroundExample = {
  id: "modules-as-files",
  title: "Modules as Files",
  description: "Use a second virtual file through the Playground's module/end module notation.",
  source: `// A real Hexagon module is a file. In a project, this would be Numbers.hex.
// module/end module is only a Playground wrapper that creates that virtual file.
module Numbers
export let answer: Int = 21
export let double(value: Int): Int = value * 2
end module Numbers

// The Playground makes the virtual file available through its module alias.
// Contents stay at column one so moving code to or from a file needs no reindent.
console.log(Numbers.double(Numbers.answer))
`,
  specificationReferences: ["spec/modules.md"],
};
