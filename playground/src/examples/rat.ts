import type { PlaygroundExample } from "./hello-world";

export const rat: PlaygroundExample = {
  id: "rat",
  title: "Exact Fractions with Rat",
  description: "Build exact normalized rational numbers over BigInt and compose them like ordinary values.",
  source: `// Rat is an opaque value with an exact BigInt representation.
export opaque record Rat derives Eq = {numerator: BigInt, denominator: BigInt}

exception ZeroDenominatorError(message: String)

// Smart construction reduces every value and keeps its denominator positive.
let create(numerator: BigInt, denominator: BigInt): Rat =
  if denominator == 0n
    throw(ZeroDenominatorError("a Rat denominator cannot be zero"))
  else
    let divisor = BigInt.gcd(numerator, denominator)
    let reducedNumerator = BigInt.quot(numerator, divisor)
    let reducedDenominator = BigInt.quot(denominator, divisor)
    if reducedDenominator < 0n
      Rat({numerator: -reducedNumerator, denominator: -reducedDenominator})
    else Rat({numerator: reducedNumerator, denominator: reducedDenominator})

let add(left: Rat, right: Rat): Rat =
  create(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator
  )

honor Show<Rat> =
  show(value) = "\${value.numerator}/\${value.denominator}"

let half = create(1n, 2n)
let third = create(1n, 3n)
let fiveSixths = add(half, third)

console.log("1/2 + 1/3 = \${fiveSixths}")
console.log("Normalized equality: \${create(10n, 12n) == fiveSixths}")
`,
  specificationReferences: [
    "spec/rat.md",
    "spec/integral-constraint.md",
    "spec/division-remainder.md",
  ],
};
