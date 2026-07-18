# Hexagon

<p align="center">
  <img src="Hex.svg" width="384" alt="Hexagon programming language logo: a purple hexagon containing the word HEX">
</p>

Hexagon is an ML-style functional language designed for the JavaScript and TypeScript ecosystem. It combines strong type inference, plain data, algebraic types, pattern matching, row-polymorphic records, and type constraints with readable JavaScript output and accurate `.d.ts` declarations.

## Try Hexagon

**[Open the Hexagon Playground](https://hexagonal.zone/Hexagon/)**

The playground runs the compiler directly in a browser worker: there is nothing to
install, no account to create, and no compiler server behind it. Edit the introductory
Hexagon program and immediately inspect its readable JavaScript, inferred types,
TypeScript declaration preview, and any diagnostics. The opening tour demonstrates
the implemented language subset, including tuples, pattern bindings, nullary unions,
exhaustive matching, annotations, and recursive functions. Run executes the latest
successful compilation, with `console.log(...)` captured in the Output tab. Source
is persisted locally, and curated examples and fragment-based Share URLs are built in.
Supported desktop browsers get Monaco editing, exact compiler markers, inferred-type
hovers, and read-only generated JavaScript and declaration models. The Fundamental
Specializations example infers one `Num`-polymorphic function; its JS view can hide
the generated family, show the complete module, or inspect each concrete edition and
its byte size.

One subject-first function, three equally static ways to call it:

```hexagon
Option.getOrElse(possibleName, "Guest")
possibleName |> Option.getOrElse("Guest")
possibleName.getOrElse("Guest")
```

All three forms mean `Option.getOrElse(possibleName, "Guest")`. The dot form is
type-directed syntax for the ordinary companion function—not a runtime method, object,
or prototype lookup.

> [!IMPORTANT]
> Hexagon is under active design and implementation. The language specification is
> about 95% complete, the reader-facing book has reached its first full draft, and
> compiler construction has complete lexer and layout passes plus twenty-three thin vertical
> slices through parsing, name resolution, type checking, Core elaboration,
> JavaScript emission, and declaration emission. Small programs in that subset,
> including tuples, pattern bindings, unions and matches, records, local mutation,
> inclusive ranges, `while`, Range/String `for..in`, annotations, and directly recursive functions, now compile end to end through the compiler API and
> run live in the Playground. Syntax, semantics, generated interfaces, and
> repository structure may still change before the first release.

## Direction

Hexagon is intended for JavaScript and TypeScript developers who want to use functional programming without leaving the JavaScript environment behind. It draws from the ML family while making deliberate choices for JavaScript-native ergonomics.

The current design includes:

- Hindley–Milner inference using Algorithm J;
- let-polymorphism with the ML value restriction;
- row-polymorphic structural records without general subtyping;
- nominal records and unions;
- exhaustive pattern matching;
- type constraints compiled through dictionary passing;
- genuinely n-ary functions without automatic currying;
- persistent collections and controlled mutation;
- JavaScript interoperation as a first-class design concern; and
- readable ESM output with an honest TypeScript declaration surface.

For example, the intended source and boundary experience has this shape:

**Hexagon source**

```hexagon
export let greet(name) = "Hello, " ++ name ++ "!"
```

**JavaScript output**

```js
export const greet = name => "Hello, " + name + "!";
```

**TypeScript declaration**

```ts
export declare const greet: (name: string) => string;
```

The compiler now reaches this boundary shape for its first-round subset, though the
full language and supported toolchain are not yet implemented.

## Project status

The normative language specification is approximately 95% complete. The core
language is decided, including functions, products, unions, constraints, exceptions,
modules, pattern matching, operators, collections, statements, iteration, physical
lexing, layout, and root-module execution. The remaining definition work is
concentrated around foreign-function-interface consolidation and the standard-library
listing.

The reader-facing book has reached a complete 25-chapter first draft. Its individual
chapter files remain the manuscript source; generated whole-book Markdown and PDF
review copies stay outside version control.

Compiler implementation is underway. The platform-neutral TypeScript workspace has
source coordinates, structured diagnostics, a Unicode-aware physical lexer, and the
indentation layout pass. Twenty-three vertical slices cover core expressions, `let` and local `var` bindings,
lambdas, directly recursive functions, conditionals, `while`, Range/String `for..in`, calls, tuple values and patterns,
generic unions and nominal records, exceptions, constraints and ground instances,
relative imports, nominal dot calls, direct fundamental specializations, exhaustive matches, rich annotations, and
operator precedence. Its resolver assigns stable symbols to `let`, `fun`, loop-head pattern,
constructor, and lambda-parameter bindings, implements lexical scopes, and diagnoses
unknown names and illegal rebinding. The implemented
checker provides the Hindley–Milner core, including let-polymorphism, the value
restriction, structural and generic nominal types, exceptions, and n-ary function types,
unification, numeric defaulting,
constraint requirements with generic call-site evidence, checked annotations, local
assignment, inclusive ranges, `while`, and monomorphic direct recursion followed by ordinary generalization. Core elaboration
makes primitive and dictionary evidence explicit, and the
experimental emitter produces readable ESM module graphs plus an honest `.d.ts` surface for
module-level values, functions, generic nominal data, and exceptions. Source comments and intentional
blank lines between top-level items carry into the generated JavaScript. The
implemented pipeline
currently reaches:

```text
Source.File -> Lexed.File -> LaidOut.File -> Parsed.Module -> Resolved.Module -> Typed.Module -> Core.Module -> Emitted output
```

The parser still needs type aliases and the remaining declaration variants; resolution
still needs function capture sets, forward/mutual recursion, and qualified type paths.
Constraints still need defaults, superconstraints, derivation, parameterized instances,
whole-graph coherence, the conditional generic constrained edition, and the public dictionary ABI. Emission still
needs source maps, runtime integration, and the finalized
portable-JavaScript profile.

There is currently no release, package, command-line tool, or supported installation
process. The browser Playground is the public way to try the implementation today.

## Repository map

- [`spec/`](spec/) contains the normative language specifications and design notes.
- [`compiler/`](compiler/) contains the TypeScript compiler workspace, tests, roadmap, and architecture decisions.
- [`book/`](book/) contains the 25-chapter first draft, working plans, and review records.
- [`language-server/`](language-server/) establishes the boundary and roadmap for LSP support.
- [`playground/`](playground/) contains the deployed browser Playground and its architecture.

Useful starting points:

- [Type system overview](spec/type-system-overview.md)
- [Specification roadmap](spec/spec-roadmap.md)
- [Compiler roadmap](compiler/ROADMAP.md)
- [Compiler implementation environment](compiler/architecture/environment.md)
- [Book outline](book/OUTLINE.md)
- [Playground direction](playground/README.md)

Documents under `spec/notes/` preserve active design work, reviews, migration context, and proposals. They are not automatically normative. Each specification states its own status and scope; settled specifications override orienting documents and historical notes.

## Implementation principles

The compiler is implemented as a sequence of explicit typed phase transformations:

```text
Source
  -> Lexed
  -> LaidOut
  -> Parsed
  -> Resolved
  -> Typed
  -> Core
  -> JavaScript and .d.ts
```

The implementation will use TypeScript and may use imperative techniques wherever they make the compiler clearer or faster. Mutable union-find, indexed tables, arenas, work queues, and scope stacks are all compatible with Hexagon's functional language design.

Compiler code is expected to remain explanatory: types describe program shapes, while comments explain compiler concepts, invariants, reasons, and non-obvious implementation choices. See the [readability and commenting doctrine](compiler/architecture/readability-and-comments.md).

Testing uses Vitest, with fast-check for property-based testing and explicit golden fixtures for diagnostics and generated artefacts. See the [testing doctrine](compiler/architecture/testing.md).

## License

Hexagon is available under the [MIT License](LICENSE).
