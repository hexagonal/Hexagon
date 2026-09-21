import type { PlaygroundExample } from "./hello-world";

export const decimals: PlaygroundExample = {
  id: "decimals",
  title: "Decimals",
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

log("You can divide two dollars among three people")
log("But you have to specify how many decimal places")
let places = 2
let person = 2.00d.divide(3, places)
log("We'll use \${places}, and end up with $\${person} per person")
`,
  specificationReferences: ["spec/dec.md"],
};
