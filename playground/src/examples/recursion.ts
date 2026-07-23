import type { PlaygroundExample } from "./hello-world";

export const recursion: PlaygroundExample = {
  id: "recursion",
  title: "Recursive Functions",
  description: "An annotated recursive function evaluated at module top level.",
  source: `// fun introduces a directly recursive binding.
fun factorial(n: Int) =
    if n <= 1
    then 1
    else n * factorial(n - 1)

console.log("6! =", factorial(6))
`,
  specificationReferences: ["spec/functions.md"],
};
