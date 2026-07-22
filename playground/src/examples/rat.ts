import type { PlaygroundExample } from "./hello-world";

export const rat: PlaygroundExample = {
  id: "rat",
  title: "Exact Fractions with Rat",
  description: "Use the fundamental exact Rat module supplied by the Playground.",
  source: `// Rat is the real opaque stdlib type, backed by canonical BigInt pairs.
// Rat.create pins these bare literals to BigInt; emitted JavaScript uses n.
let half = Rat.create(1, 2)
let third = Rat.create(1, 3)
let fiveSixths = half + third
let tenTwelfths = Rat.create(10, 12)

console.log("1/2 + 1/3 = \${fiveSixths}")
console.log("Normalized equality: \${tenTwelfths == fiveSixths}")
`,
  specificationReferences: [
    "spec/rat.md",
    "spec/integral-constraint.md",
    "spec/division-remainder.md",
  ],
};
