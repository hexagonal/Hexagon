import type { PlaygroundExample } from "./hello-world";

export const rat: PlaygroundExample = {
  id: "rat",
  title: "Exact Fractions with Rat",
  description: "Import the standard library's exact rational module.",
  source: `module Rationals

import Rat

let half = (1, 2)rat
let third = (1, 3)rat
let fiveSixths = half + third
let threeHalves = half / third

Debug.log("1/2 + 1/3 = \${fiveSixths}")
Debug.log("1/2 / 1/3 = \${threeHalves}")
Debug.log("Does 10/12 = 5/6? \${(10, 12)rat == (5, 6)rat}")

let fraction = (6, 10)rat
let (top, bottom)rat = fraction

Debug.log("top = \${top}")
Debug.log("bottom = \${bottom}")

let describe(fraction: Rat) = match fraction
    (0, _)rat => "zero"
    (_, 1)rat => "integer"
    (n, d)rat => "\${n}/\${d}"

Debug.log("fraction: \${describe(fraction)}")
`,
  specificationReferences: [
    "spec/rat.md",
    "spec/pattern-declarations.md",
    "spec/integral-constraint.md",
    "spec/division-remainder.md",
  ],
};
