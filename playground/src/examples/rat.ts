import type { PlaygroundExample } from "./hello-world";

export const rat: PlaygroundExample = {
  id: "rat",
  title: "Exact Fractions with Rat",
  description: "Use the fundamental exact Rat module supplied by the Playground.",
  source: `// Rat is the real opaque stdlib type, backed by canonical BigInt pairs.
let half = Rat.create(1n, 2n)
let third = Rat.create(1n, 3n)
let fiveSixths = half + third

console.log("1/2 + 1/3 = \${fiveSixths}")
console.log("Normalized equality: \${Rat.create(10n, 12n) == fiveSixths}")
`,
  specificationReferences: [
    "spec/rat.md",
    "spec/integral-constraint.md",
    "spec/division-remainder.md",
  ],
};
