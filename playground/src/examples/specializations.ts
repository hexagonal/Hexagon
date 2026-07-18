import type { PlaygroundExample } from "./hello-world";

export const specializations: PlaygroundExample = {
  id: "fundamental-specializations",
  title: "Fundamental Specializations",
  description:
    "Infer one Num-polymorphic function, then inspect its direct Int, Float, and BigInt editions.",
  source: `// The inferred type is: <a: Num> (a, a) -> a
let plus(x, y) = x + y

// Open the JS View menu to inspect each generated edition.
console.log(plus(20, 22))
console.log(plus(1.5, 2.25))
console.log(plus(10n, 20n))
`,
  specificationReferences: ["spec/ffi-zero-cost-fundamental-exports.md"],
};
