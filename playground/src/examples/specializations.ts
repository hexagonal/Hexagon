import type { PlaygroundExample } from "./hello-world";

export const specializations: PlaygroundExample = {
  id: "fundamental-specializations",
  title: "Fundamental Specializations",
  description:
    "Inspect direct Num editions, then use contextual Int widening to buy some bananas.",
  source: `// The declared boundary keeps the inferred type: <a: Num> (a, a) -> a
let plus<a: Num>(x: a, y: a) = x + y

// Open the JS View menu to inspect each generated edition.
console.log(plus(20, 22))
// The integer literal 20 is instantiated as Float by the other argument.
console.log(plus(20, 1.5))
console.log(plus(10n, 20n))

// Defaulting establishes Int; the decimal establishes Float.
let count = 3
let cost = 1.50
let total = count * cost
console.log(total)
`,
  specificationReferences: [
    "spec/ffi-zero-cost-fundamental-exports.md",
    "spec/numeric-literals.md",
  ],
};
