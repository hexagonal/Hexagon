# Hexagon Compiler

This folder contains the beginning of `hexc`, the Hexagon compiler.

The platform-neutral TypeScript core now includes shared source coordinates,
structured diagnostics, the complete physical lexer, and the indentation layout
pass. Forty-one vertical compiler slices now carry the public pipeline through `Source.File -> Lexed.File
-> LaidOut.File -> Parsed.Module -> Resolved.Module -> Typed.Module -> Core.Module ->
Emitted output` for a deliberate language subset.

The initial parser supports module and nested block items, `let` and local `var` bindings,
module-level exports, function-header sugar and lambdas, directly recursive `fun`
bindings plus nested tuple and structural-record patterns, primitive, tuple, structural-record,
and declared union annotations, tuple and structural-record literals with construction
punning, immutable record spread updates, payload union declarations and constructor
patterns, primitive and negative Int/String/Bool pattern literals, Unit, nested
or-patterns with shared bindings, and as-patterns,
guarded match arms, direct tuple/record matching, inclusive ranges, `while`, `for..in`
over `Range` and `String`, and
string interpolation, mandatory-`then` inline and multiline `if`, calls, field access,
indexing, assignment, generic unions, nominal records, exception declarations and
guarded full-pattern `try`/`catch` arms, completed user constraint declarations and honors, implied type
declarations and ground bindings, `derive` and declaration-header `derives`, explicit
constrained binders, `Seq(a)`, relative imports, explicit right-associative function
types with zero, one, or many parameters, and the complete operator precedence table.
Compiler-known primitive companions provide the decided `Int`/`BigInt`
`div`/`mod`/`quot`/`rem`/`gcd` families, `BigInt.lcm`, and `Float.mod`/`rem`;
the Hexagon-written `stdlib/Rat.hex` module is their first exact-arithmetic client.
Whole-project checking now transports coherent instances across imports, and ESM
emission exposes only reserved evidence handles for dependent Hexagon modules. The
Playground uses that boundary to compile and execute the canonical `Rat` source as
the first member of its deliberately provisional fundamental stdlib.
Transparent parameterized type aliases, qualified type paths, opaque record and union
exports, and module-level `extern` imports with named, aliased, default, effect, value,
function, and opaque-type declarations are also implemented. Receiver members, classes,
and enums remain later FFI slices and receive targeted diagnostics.

The initial resolver assigns stable symbols to sequential `let` bindings, directly
recursive `fun` bindings, local `var` bindings, loop-head patterns, and lambda parameters. It implements lexical block scopes
and head-binder shadowing, resolves primitive, tuple, record, and union annotations, and
assigns stable identities to generic unions, nominal records, their constructors,
exception constructors, constraint members, and imported bindings. It
diagnoses illegal `let` self-reference, unknown names and types, rebinding, duplicate
parameters, mutable-capture rejection, alias cycles, and calls made before a recursive
function's captured sequential values are available. Function declarations in one block
form a mutual-recursion group.
Relative named, aliased, namespace, and effect imports plus nominal companion lookup
are implemented, including qualified type syntax and opaque imported representations.
Implied type names have owner-relative
scope inside their constraint and instances; attempted v1 references outside those
owners receive implied-type-specific diagnostics.

The initial checker implements the Hindley–Milner core with private union-find
variables, inferred and explicitly annotated n-ary function types, structural tuple and open-row record types,
generic nominal union and record types, nested constructor-payload and record-pattern binding,
primitive literal, Unit, structural, nested or-, and as-patterns, guarded arms,
irrefutable single-constructor and exhaustive Bool/closed-union or-pattern
destructuring, payload-sensitive exhaustive union/Bool/Unit matching with
structural catch-all enforcement,
let-generalisation, the
value restriction, lambda monomorphism, primitive types, integer defaulting,
operator and interpolation constraints, tuple and record access, exact/open record
annotations with anonymous or named additional-field tails, immutable record updates,
conditionals, calls, monomorphic assignment, inclusive `Range`, `while`, and
concrete `Range`/`String`/`Seq(a)` iteration,
first-argument pipe insertion, and block sequencing. Typed syntax records an
immutable type for every expression and a scheme for every binding. Declarations,
generic call-site evidence, explicit and inferred constraints, required-member user
constraints, base constraints, inherited defaults, coherent ground and parameterized
instances, nominal derivation, concrete implied type substitution, the
projection-bearing constraint binder ban, concrete exception payloads, guarded full-pattern
exception handling, imported schemes, and nominal dot-call
resolution. Exported signatures cannot expose private nominal or foreign types, and imported opaque
records reject construction, field access, destructuring, and updates outside their home
module. Extern signatures are monomorphic, annotation-driven, and checked for their
implemented boundary adaptations. The public dictionary ABI and later FFI validation
remain future slices. Primitive annotations
constrain inference and are erased after checking rather than leaking into Core.
Direct recursion uses one monotype inside its own body and generalizes only after
the recursive knot closes.

The initial elaborator receives pipes already rewritten to calls, removes grouping
and overloadable operator syntax, turns
integer conversion and interpolation into explicit semantic operations, selects
primitive or dictionary evidence, lowers derived logic, and preserves comparison
chains as a single-evaluation Core form. The Core IR remains typed and
source-attributed without copying JavaScript syntax. Generic calls carry their
trailing evidence explicitly; forms awaiting checker support remain later slices.

The experimental emitter produces deterministic readable ESM and `.d.ts` text
without performing filesystem writes. It emits private and exported bindings,
functions, blocks, primitive operations, dictionary-backed generic bodies,
conditionals, interpolation, tuple arrays and positional indexing, record objects
and field access, nullary union strings, tagged payload unions and their
single-constructor and exhaustive or-pattern destructuring, compact `switch`
matches and ordered guarded/literal/structural/nested-or-pattern tests, semantic helpers,
short-circuiting comparison chains,
and recursive `fun` bindings as hoisted function declarations, generic nominal data,
branded real-`Error` exceptions with nested guarded handlers and implicit rethrow,
constraint dictionaries, imported ESM graphs, local mutation as
JavaScript `let`/assignment, replayable iterable ranges and memoized lazy sequences,
generator-backed `Seq.iterate`/`map`/`filter`/`take`, `while`, and native
`for..of` loops for Range/String/Seq iteration. Module-level foreign bindings emit direct
ESM imports; `Seq` results and values receive one stable boundary adapter, while `Unit`
results discard the foreign return value. Implied type bindings are checked and
then erased; their term members remain ordinary dictionary fields. Exported constrained functions receive
direct dictionary-free fundamental editions, with deterministic names, collision
diagnostics, and byte-counted generated regions. Declarations cover
exported primitives, tuples, structural records, discriminated payload unions and
their constructors, nominal records, exceptions, unconstrained polymorphic functions,
and fundamental specializations. Exported aliases remain named TypeScript aliases;
opaque records and unions receive collision-safe private-symbol brands without exporting
their constructors. Exported opaque foreign types receive the same collision-safe
brand treatment, and exported foreign values and functions retain their declared signatures.
Source maps, the conditional generic constrained edition, public dictionaries, richer types, and the
finalized portable target profile remain later emission slices.

Interactive tools may additionally call `emitTypeScriptPreview` to inspect every
representable top-level binding without promoting private bindings into the public
module contract. Constrained bindings remain in the typed analysis without exposing
their generic dictionary surface; lawful fundamental editions appear as ordinary
non-exported preview declarations.

Development commands, run from this folder:

```text
npm ci
npm run check
npm test
npm run build
```

- [Roadmap](ROADMAP.md)
- [Global naming doctrine](architecture/naming.md)
- [Readability and commenting doctrine](architecture/readability-and-comments.md)
- [Testing doctrine](architecture/testing.md)
- [Implementation and environment](architecture/environment.md)
- [Compilation roots and running modules](architecture/compilation-roots.md)
- [JavaScript target doctrine](architecture/javascript-target.md)

The implementation language is TypeScript 7 or later.
