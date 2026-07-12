# Hexagon

<p align="center">
  <img src="Hex.svg" width="384" alt="Hexagon programming language logo: a purple hexagon containing the word HEX">
</p>

Hexagon is an ML-style functional language designed for the JavaScript and TypeScript ecosystem. It combines strong type inference, plain data, algebraic types, pattern matching, row-polymorphic records, and type constraints with readable JavaScript output and accurate `.d.ts` declarations.

> [!IMPORTANT]
> Hexagon is in the language-design and compiler-architecture stage. The specification is incomplete, the compiler has not been implemented, and no Hexagon program can be compiled yet. Syntax, semantics, generated interfaces, and repository structure may change before the first release.

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

```hexagon
export let greet(name) = "Hello, " ++ name ++ "!"
```

```js
export const greet = (name) => "Hello, " + name + "!";
```

```ts
export declare const greet: (name: string) => string;
```

These examples express the design direction; there is not yet a compiler that produces them.

## Project status

The normative language specification is being developed before compiler implementation begins. Much of the core language is decided, including functions, products, unions, constraints, exceptions, modules, pattern matching, operators, collections, statements, iteration, and root-module execution. The general foreign-function interface, full lexer inventory, and standard-library listing still have open work.

Compiler implementation will proceed through thin vertical slices. A language feature should travel through lexing, layout, parsing, resolution, checking, elaboration, JavaScript and `.d.ts` emission, tests, and an interactive playground example before it is treated as delivered.

There is currently no release, package, command-line tool, playground deployment, or supported installation process.

## Repository map

- [`spec/`](spec/) contains the normative language specifications and design notes.
- [`compiler/`](compiler/) contains the compiler roadmap and architecture decisions.
- [`book/`](book/) contains plans for the reader-facing Hexagon book.
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

The compiler is planned as a sequence of explicit typed phase transformations:

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

Testing will use Vitest, with fast-check for property-based testing and explicit golden fixtures for diagnostics and generated artefacts. See the [testing doctrine](compiler/architecture/testing.md).

## Contributing

Hexagon is early enough that apparently small language changes can affect inference, runtime representation, JavaScript interoperation, declarations, diagnostics, and future tooling. Before proposing or implementing a feature:

1. check the relevant specification and its status;
2. check the [specification roadmap](spec/spec-roadmap.md) for recorded dependencies and debts;
3. preserve the distinction between normative specifications and design notes; and
4. carry accepted changes through affected specifications rather than leaving contradictory local rules.

Implementation contribution instructions will be added when the compiler workspace and build commands exist.

## License

Hexagon is available under the [MIT License](LICENSE).
