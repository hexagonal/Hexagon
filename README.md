# Hexagon

<p align="center">
  <img src="Hex.svg" width="384" alt="Hexagon programming language logo: a purple hexagon containing the word HEX">
</p>

Hexagon is an ML-style functional language designed for the JavaScript and TypeScript ecosystem. It combines strong type inference, plain data, algebraic types, pattern matching, row-polymorphic records, and type constraints with readable JavaScript output and accurate `.d.ts` declarations.

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
> compiler construction has begun with working lexer and layout passes. Parsing and
> later phases are not implemented yet, so no Hexagon program can be compiled
> end-to-end. Syntax, semantics, generated interfaces, and repository structure may
> still change before the first release.

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

These examples express the design direction; the compiler does not yet reach code
generation.

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
indentation layout pass. Its implemented pipeline currently reaches:

```text
Source.File -> Lexed.File -> LaidOut.File
```

Parsing is next. Later work will continue through resolution, checking, elaboration,
JavaScript and `.d.ts` emission, tests, and an interactive playground example before
a language feature is treated as delivered end-to-end.

There is currently no release, package, command-line tool, playground deployment, or supported installation process.

## Repository map

- [`spec/`](spec/) contains the normative language specifications and design notes.
- [`compiler/`](compiler/) contains the TypeScript compiler workspace, tests, roadmap, and architecture decisions.
- [`book/`](book/) contains the 25-chapter first draft, working plans, and review records.
- [`language-server/`](language-server/) establishes the boundary and roadmap for LSP support.
- [`playground/`](playground/) contains the browser-playground architecture and an early UI scaffold.

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

## Contributing

Hexagon is early enough that apparently small language changes can affect inference, runtime representation, JavaScript interoperation, declarations, diagnostics, and future tooling. Before proposing or implementing a feature:

1. check the relevant specification and its status;
2. check the [specification roadmap](spec/spec-roadmap.md) for recorded dependencies and debts;
3. preserve the distinction between normative specifications and design notes; and
4. carry accepted changes through affected specifications rather than leaving contradictory local rules.

Compiler setup and build commands are documented in the
[compiler README](compiler/README.md).

## License

Hexagon is available under the [MIT License](LICENSE).
