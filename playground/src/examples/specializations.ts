import type { PlaygroundExample } from "./hello-world";

export const specializations: PlaygroundExample = {
  id: "fundamental-specializations",
  title: "Fundamental Specializations",
  description:
    "Inspect direct Num editions, then use contextual Int widening to buy some bananas.",
  source: `// The inferred type is: <a: Num> (a, a) -> a
let plus(x, y) = x + y

// Open the JS View menu to inspect each generated edition.
console.log(plus(20, 22))
// The integer literal 20 is instantiated as Float by the other argument.
console.log(plus(20, 1.5))
console.log(plus(10n, 20n))

// An established Int widens through Float.fromInt when Float is required.
let count: Int = 3
let cost: Float = 1.50
let total = count * cost
console.log(total)
`,
  specificationReferences: [
    "spec/ffi-zero-cost-fundamental-exports.md",
    "spec/numeric-literals.md",
  ],
};
