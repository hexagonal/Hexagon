import type { PlaygroundExample } from "./hello-world";

export const rat: PlaygroundExample = {
  id: "rat",
  title: "Exact Fractions with Rat",
  description: "Import the standard library's exact rational module.",
  source: `module Main

// Rat is an ordinary module, imported by name (Modules §3.1). Nothing about
// this line is the Playground's: it is what any .hex file writes.
import Rat

let half = Rat.create(1, 2)
let third = Rat.create(1, 3)
let fiveSixths = half + third
let threeHalves = half / third
let tenTwelfths = Rat.create(10, 12)

Debug.log("1/2 + 1/3 = \${fiveSixths}")
Debug.log("1/2 / 1/3 = \${threeHalves}")
Debug.log("Does 10/12 = 5/6? \${tenTwelfths == fiveSixths}")
`,
  specificationReferences: [
    "spec/rat.md",
    "spec/integral-constraint.md",
    "spec/division-remainder.md",
  ],
};
