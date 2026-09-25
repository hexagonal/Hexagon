import type { PlaygroundExample } from "./hello-world";

export const decimals: PlaygroundExample = {
  id: "decimals",
  title: "Exact Money with Dec",
  description: "Use Dec for exact decimal arithmetic and explicit decimal places.",
  source: `module Decimals

let log = Debug.log

log("Standard Float behavior is surprising")
log("\${0.1} + \${0.2} = \${0.1 + 0.2}")
log("Fixed by switching to Dec (decimal)")
log("\${0.1d} + \${0.2d} = \${0.1d + 0.2d}")
log("")

log("You can add dollars and cents")
log("\${1} + \${0.23d} = \${1 + 0.23d}")
log("")

log("You can buy 3 bananas that are $2.50 each")
log("\${3} * \${2.50d} = \${3 * 2.50d}")
log("")

log("You can divide $2 among 3 people,")
log("but we have to say how many decimal places")
let places = 2
log("If we choose \${places} places,")
let person = 2.00d.divide(3, places)
log("we end up with $\${person} per person")
log("but three shares add up to $\${person * 3}: a cent appeared")
log("")

log("A Float becomes a Dec only by rounding, to places you choose")
log("\${0.1 + 0.2} => \${Dec.fromFloat(0.1 + 0.2, 2)}")
log("")

log("42.00 is equal to 42")
log("\${42.00d} == \${42} => \${42.00d == 42}")
log("But 42.00 is not the same as 42")
log("\${42.00d}.same(\${42}) => \${42.00d.same(42)}")
log("42.00 is only the same as 42.00")
log("\${42.00d}.same(\${42.00d}) => \${42.00d.same(42.00d)}")
`,
  specificationReferences: ["spec/dec.md"],
};
