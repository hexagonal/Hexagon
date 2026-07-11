# Book Outline

**Status:** Developing. Chapter boundaries and order may change as the specification settles and the book is written.

## Preface — Why Hexagon?

A short account of what Hexagon is for and why it exists.

The Preface should introduce Hexagon as a functional language for the JavaScript and TypeScript world. It should give the reader an approachable sense of *functional programming* before the book asks them to learn its vocabulary: programs built from values and functions, strong inference, explicit data shapes, composition, and controlled effects.

It should explain that Hexagon brings ideas associated with the ML family to programmers who already live in the TypeScript ecosystem, while treating JavaScript interoperation and readable emitted JavaScript as central design requirements rather than afterthoughts.

It should say, without becoming an anti-OO polemic, that mainstream object-oriented design often entangles data, mutable state, identity, dispatch, and code reuse. Class inheritance in particular creates avoidable coupling and fragile hierarchies. Hexagon instead favours plain data, functions, algebraic types, constraints, and companion modules.

Do **not** claim that subtyping itself is inherently bad. Subtyping is a useful way to express substitutability, and structural compatibility is particularly valuable in the TypeScript world. The narrower criticism is of inheritance-heavy design and of using inheritance simultaneously for code reuse, representation, and behavioural substitutability. Hexagon obtains much of the desired flexibility through inference, row polymorphism, constraints, and explicit data transformations.

The Preface should remain short, inviting, and directional. It answers “why might I want this?” rather than teaching syntax or defending every design decision.

## 1. Introduction

The first numbered chapter should let the reader meet Hexagon as a language they can use.

Begin with the smallest honest program the settled execution model permits, then move quickly to a small functional example that demonstrates values flowing through functions. Avoid spending several pages on printing one string.

Until the program-entry specification decides `main`, top-level effects, and module initialization, use an exported function rather than inventing executable semantics. A likely opening shape is an exported greeting function called from JavaScript:

```hexagon
export let greet(name: String): String =
  "Hello, ${name}!"
```

The chapter can then show the three useful faces:

1. the Hexagon source;
2. the readable emitted JavaScript; and
3. the generated `.d.ts` signature.

After this first contact, introduce a slightly richer example using composition or a pipe so the reader sees why Hexagon is more than JavaScript with different punctuation. Explain the example conversationally; detailed rules for functions, inference, modules, and pipes belong to later chapters.

By the end of the Introduction, the reader should understand:

- Hexagon source becomes readable JavaScript;
- generated declarations make it a typed participant in a TypeScript project;
- functions and values are the ordinary organizing tools;
- types are strong but usually inferred; and
- the rest of the book will explain the language systematically.

The Introduction teaches orientation, not completeness. It may briefly use features before their full chapters, provided it explains enough for the example to remain honest and understandable.
