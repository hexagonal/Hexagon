import type { PlaygroundExample } from "./hello-world";

export const sequences: PlaygroundExample = {
  id: "sequences",
  title: "Infinite Sequences",
  description:
    "Build an interruptible Seq(Int), then map, filter, and take from its JavaScript generator.",
  source: `// Seq.iterate is infinite unless a consumer such as Seq.take stops it.
let numbers: Seq(Int) = Seq.iterate(1, number => number + 1)

// Method syntax reads naturally for subject-first Seq companion functions.
let selected =
  numbers
    .filter(number => number > 3)
    .map(number => number * 10)
    .take(5)

// The same independent functions can be called explicitly and piped.
let selected2 =
  numbers
  |> Seq.filter(number => number > 3)
  |> Seq.map(number => number * 10)
  |> Seq.take(5)

// Open the complete JS view: Seq is implemented by a replayable function* generator.
for number in selected
  console.log(number)
`,
  specificationReferences: ["spec/loops-ranges-iteration.md"],
};
