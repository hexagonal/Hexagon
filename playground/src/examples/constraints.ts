import type { PlaygroundExample } from "./hello-world";

export const constraints: PlaygroundExample = {
  id: "constraints",
  title: "Constraints",
  description: "Define a capability, honor it for a type, and use it from generic code.",
  source: `// A constraint names operations that a type can provide.
constraint Labelled<a> =
  label(value: a): String

record Guest = {name: String, seats: Int}

// honor supplies those operations for one type.
honor Labelled<Guest> =
  label(guest) = guest.name

// The constraint lets generic code call label without knowing the concrete type.
let describe<a: Labelled>(value: a): String = label(value)

let dinner = Guest({name: "Ada", seats: 2})
console.log(describe(dinner), "has", dinner.seats, "seats")
`,
  specificationReferences: ["spec/constraints.md"],
};
