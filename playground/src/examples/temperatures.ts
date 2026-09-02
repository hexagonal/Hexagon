import type { PlaygroundExample } from "./hello-world";

export const temperatures: PlaygroundExample = {
  id: "temperatures",
  title: "The Temperature Converter, Untrapped",
  description:
    "The classic C integer-division trap, and the three ways Hexagon refuses to fall into it.",
  source: `// The classic C trap: with integers, (f - 32) * 5 / 9 truncates 5 / 9 to 0,
// and every temperature "converts" to the same wrong answer — silently.
// In Hexagon, / always means division, and the written type is the
// arithmetic's home.

let toCelsius(f: Int): Float = (f - 32) * 5 / 9
let toFahrenheit(c: Int): Float = c * 9 / 5 + 32

Debug.log("212F = \${toCelsius(212)}C")
Debug.log("98F = \${toCelsius(98)}C")
Debug.log("37C = \${toFahrenheit(37)}F")

// Want exactness instead of floating point? Write Rat as the face: the same
// expression, exact — the division is rational arithmetic, not rounded.
let exactCelsius(f: Int): Rat = (f - 32) * 5 / 9

Debug.log("98F is exactly \${exactCelsius(98)}C")

// And with no written type at all, Hexagon refuses rather than truncates:
// let broken(f: Int) = (f - 32) * 5 / 9   -- error: type \`Int\` has no \`Frac\` instance
`,
  specificationReferences: [
    "spec/friendly-numerics.md",
    "spec/numeric-literals.md",
    "spec/operators-logic-precedence.md",
    "spec/division-remainder.md",
    "spec/rat.md",
  ],
};
