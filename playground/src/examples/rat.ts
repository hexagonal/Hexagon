import type { PlaygroundExample } from "./hello-world";

export const rat: PlaygroundExample = {
  id: "rat",
  title: "Exact Fractions with Rat",
  description: "Use the fundamental exact Rat module supplied by the Playground.",
  source: `let half = Rat.create(1, 2)
let third = Rat.create(1, 3)
let fiveSixths = half + third
let threeHalves = half / third
let tenTwelfths = Rat.create(10, 12)

console.log("1/2 + 1/3 = \${fiveSixths}")
console.log("1/2 / 1/3 = \${threeHalves}")
console.log("Does 10/12 = 5/6? \${tenTwelfths == fiveSixths}")
`,
  specificationReferences: [
    "spec/rat.md",
    "spec/integral-constraint.md",
    "spec/division-remainder.md",
  ],
};
