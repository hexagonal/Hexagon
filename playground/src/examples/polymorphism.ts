import type { PlaygroundExample } from "./hello-world";

export const polymorphism: PlaygroundExample = {
  id: "polymorphism",
  title: "Polymorphism and Variance",
  description:
    "Reuse one empty sequence at two element types, and declare what an opaque type promises.",
  source: `// A binding whose right-hand side is a value is polymorphic: \`empty\` is a
// reference to an immutable binding, so \`nothing\` can be reused at any
// element type. This is the program most languages make you write twice.
let nothing = Seq.empty

let numbers = Seq.prepend(nothing, 42)
let words = Seq.prepend(nothing, "Briar")

// A computed right-hand side is not a value, and is polymorphic anyway when
// nothing in the result could hold an element the checker never saw. \`Vector\`
// only ever produces its element, so \`blank\` generalizes too.
fun makeEmpty<a>(): Vector(a) = []
let blank = makeEmpty()

let counts: Vector(Int) = blank.append(1)
let labels: Vector(String) = blank.append("one")

// Your own types say what they promise. An opaque type hides its structure, so
// nothing crosses the boundary that the author did not write: \`+a\` declares
// that a \`Box\` only ever hands an \`a\` out, never takes one in.
export opaque record Box(+a) = {open: () -> Option(a)}

export fun emptyBox<a>(): Box(a) = Box({open = () => None})

export fun openBox<a>(box: Box(a)): Option(a) = (box.open)()

// Drop the \`+\` and this stops compiling: without a claim, a parameter is
// invariant and \`empty\` would be pinned to whatever type used it first.
let empty = emptyBox()
let boxedNumber: Box(Int) = empty
let boxedWord: Box(String) = empty

console.log(Seq.length(numbers), Seq.length(words))
console.log(Vector.length(counts), Vector.length(labels))
console.log(openBox(boxedNumber), openBox(boxedWord))
`,
  specificationReferences: [
    "spec/functions.md",
    "spec/decisions-ml-dialect-generalization-2026-08.md",
  ],
};
