import type { PlaygroundExample } from "./hello-world";

export const recursion: PlaygroundExample = {
  id: "recursion",
  title: "Recursive Functions",
  description: "An annotated recursive function evaluated at module top level.",
  source: `module Main

// fun introduces a directly recursive binding.
fun factorial(n: Int) =
    if n <= 1 then
        1
    else
        n * factorial(n - 1)

Debug.log("6! = \${factorial(6)}")
`,
  specificationReferences: ["spec/functions.md"],
};
