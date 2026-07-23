import type { PlaygroundExample } from "./hello-world";

export const constraints: PlaygroundExample = {
  id: "constraints",
  title: "Constraints",
  description: "Honor the prelude Show constraint for a type and use it from generic code.",
  source: `// Show is a prelude constraint used by string interpolation.
record Person = {name: String, age: Int}

// A local type can honor Show by supplying its display operation.
honor Show<Person> =
    show(person) = "\${person.name}, age \${person.age}"

// Interpolation propagates Show into otherwise generic code.
let describe<a: Show>(thing: a) =
    "Description: \${thing}"

let ada = Person({name: "Ada", age: 36})

console.log(describe(ada))
console.log(describe(5))
`,
  specificationReferences: ["spec/constraints.md"],
};
