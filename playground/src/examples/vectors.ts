import type { PlaygroundExample } from "./hello-world";

export const vectors: PlaygroundExample = {
  id: "vectors",
  title: "Persistent Vectors",
  description:
    "Use the canonical Vector companion for total access, signed access, persistent updates, and Seq conversion.",
  source: `let numbers = Vector.fromSeq(Seq.iterate(10, number => number + 10).take(3))
let extended = numbers.append(40)
let updated = extended.set(2, 25)

log("numbers = \${numbers}")
log("updated = \${updated}")
log("last = \${updated.at(-1)}")
log("has a fifth value? \${updated.get(5) != None}")
`,
  specificationReferences: [
    "spec/collections-part3-vector.md",
    "spec/collections-part5-iterable.md",
  ],
};
