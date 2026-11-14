import type { PlaygroundExample } from "./hello-world";

export const rat: PlaygroundExample = {
  id: "rat",
  title: "Exact Fractions with //",
  description: "Write a fraction with `//`, take one apart in a pattern, and let a decimal enter it.",
  source: `module Rationals

-- \`top // bottom\` writes a fraction: an exact Rat, always in lowest terms.
let half = 1 // 2
let third = 1 // 3
let fiveSixths = half + third
let threeHalves = half / third

Debug.log("1/2 + 1/3 = \${fiveSixths}")
Debug.log("1/2 / 1/3 = \${threeHalves}")
Debug.log("Does 10/12 = 5/6? \${10 // 12 == 5 // 6}")

-- The same spelling takes a fraction apart, into its lowest terms.
let fraction = 6 // 10
let top // bottom = fraction

Debug.log("top = \${top}")
Debug.log("bottom = \${bottom}")

let describe(fraction: Rat) = match fraction
    0 // _ => "zero"
    n // 1 => "the whole number \${n}"
    n // d => "\${n} over \${d}"

Debug.log("fraction: \${describe(fraction)}")

-- A decimal enters a fraction exactly, wherever a Rat is the home.
let price = 1.50d
let share: Rat = price
Debug.log("1.50d is \${share}, and a third of it is \${price * 1 // 3}")

-- Rounding to a whole number gives a BigInt.
Debug.log("5/2 rounds to \${(5 // 2).round()}, and its floor is \${(5 // 2).floor()}")
`,
  specificationReferences: [
    "spec/rat.md",
    "spec/operators-logic-precedence.md",
    "spec/pattern-matching.md",
    "spec/integer-widening.md",
    "spec/integral-constraint.md",
    "spec/division-remainder.md",
  ],
};
