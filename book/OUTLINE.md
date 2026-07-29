# Book Outline

**Status:** Draft 3 structure. All 25 feature chapters exist. Front matter and a
possible new **Getting Started** chapter remain to be written, followed by the
whole-book pedagogy and liveliness passes.

The numbered list below records the current files. A held structural proposal would
make **Getting Started** the new Chapter 1 and shift the existing feature chapters by
one. Do not rename the files until that revision is undertaken deliberately.

## Preface — Why Hexagon?

A short account of what Hexagon is for and why it exists.

Introduce Hexagon as an ML dialect that targets JavaScript. Give an approachable sense
of programs built from values and functions, strong inference, explicit data shapes,
composition, and controlled effects.

Explain the posture, because it is the thing a reader most needs to get right early:
Hexagon is a member of the ML family — that is where its semantics and its surface come
from — and JavaScript is the platform it compiles to and interoperates with excellently.
The reader will meet a real ML, not a JavaScript variant with types bolted on. Readable
emitted JavaScript and honest declarations are things the compiler works hard for, and
the book should show them off; they are not what decides how the language behaves. Where
the two pull apart, the ML answer is the one the reader will find. Contrast this gently
with inheritance-heavy design without making an anti-object or anti-subtyping argument.

## Introduction

Keep the Introduction small. It has two movements:

1. a brief liveliness/story opening that invites the reader into the book's recurring
   world; and
2. a compact introduction to Hexagon as a functional language for JavaScript and
   TypeScript programmers.

It should orient and entice rather than carry practical setup instructions or a large
language tour.

## Held proposal: 1. Getting Started

Let the reader meet Hexagon as a language they can run. Begin with a root module and
one top-level effect:

```hexagon
print("Hello, Hexagon!")
```

Move quickly to a small transformation that shows values flowing through functions.
Show the Hexagon source, readable JavaScript, and generated `.d.ts` face once, clearly
labelled. Briefly explain root-module execution, inferred types, and the role of the
book without trying to teach their complete rules.

Getting Started must carry enough early module orientation to support `export` and
module-level vocabulary before the full Modules chapter. It teaches first contact and
practical use, not the complete module system.

## Part I — Values and Functions

The current draft numbering follows. If Getting Started is adopted as Chapter 1, these
chapters become 2–7 and every later feature chapter shifts accordingly.

1. **Expressions**
2. **Primitive Types**
3. **Functions**
4. **Operators**
5. **Layout**
6. **Polymorphism**

This part establishes the expression-first model, native primitive values, ordinary
and recursive functions, control and pipe syntax, indentation, and inferred reusable
types.

## Part II — Data

7. **Tuples**
8. **Type Aliases**
9. **Records**
10. **Unions**
11. **Patterns**

This part grows from positional products to named fields, nominal alternatives, and
the common pattern language used to take those values apart.

## Part III — Capabilities and Modules

12. **Constraints**
13. **Derivation**
14. **Modules**
15. **Dot Calls**

This part explains generic capabilities, generated lawful behavior, the module and
privacy model, companion homes, and the convenient dot spelling for subject-first
functions.

## Part IV — State and Flow

16. **Mutable Variables**
17. **Loops and Ranges**
18. **Sequences**
19. **Exceptions**

This part introduces Hexagon's bounded forms of changing state, repetition, lazy
incremental work, and exceptional control flow.

## Part V — Collections and Implied Types

20. **Collections**
21. **Implied Types**

The practical persistent collections chapter leads directly into the advanced
constraint feature used to connect a collection with its iteration item type.

## Part VI — JavaScript and TypeScript

22. **JavaScript Output**
23. **TypeScript Output**
24. **JavaScript Input**
25. **Constraints in JavaScript**

The final part gathers the runtime story, public typed surface, trusted foreign-input
model, and the special JavaScript API generated for constrained polymorphic exports.

## Closing material

A short unnumbered conclusion may return to the opening program, show how the pieces
now fit together, and direct readers toward the API reference, specification, and
compiler tooling. It should provide closure rather than introduce another feature.
