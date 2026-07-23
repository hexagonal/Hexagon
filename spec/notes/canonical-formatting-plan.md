# Hexagon canonical formatting plan

**Status:** Planning note (July 2026). Boundary annotations are canonicalized in
the Playground examples and `stdlib/Rat.hex`; mandatory-`then` conditional
formatting is canonicalized across the live corpus. Apply the remaining phases
gradually when their source is otherwise being touched.

## 1. Boundary-first annotation doctrine

Annotations belong at declaration boundaries:

- every module-level function annotates every parameter;
- an exported function additionally annotates its return type;
- an exported function explicitly writes every constraint in its public contract;
- a non-exported module-level function leaves its constraints to inference;
- lambdas and local bindings do not carry annotations;
- an exported value binding annotates its type;
- an exported signature names a type alias instead of spelling an inline
  structural type.

This is a tooling and maintenance convention. A pinned receiver or scrutinee gives
dot-dispatch and pattern completion a stable anchor; module boundaries form an
error firewall; exported annotations stabilize generated TypeScript declarations;
and the shape follows habits familiar to TypeScript programmers. It applies
consistently, including to literals. An accurate annotation preserves the
program’s inferred type and emitted behavior; an inaccurate annotation
additionally rejects accidental specialization. That rejection is the boundary
error firewall doing its job, not a change to the meaning of a well-typed
program.

### 1.1 Parameter annotations are contracts

For a generic parameter, `thing: a` has two simultaneous jobs:

- it tells the reader that the function is deliberately generic; and
- it requires the checker to keep `a` generic while checking the body.

The written type variable is rigid. It may accumulate inferred constraints, but
it cannot quietly become `Int` or another concrete type. Thus:

```
let takesInt(value: Int) = value
let inferred(value) = takesInt(value)       -- value is inferred as Int
let rejected(value: a) = takesInt(value)    -- error: a cannot become Int
```

For a module-level function, the canonical repair is to replace `a` with the
actual inferred parameter type. Removing the annotation is also a valid local
rewrite that exposes inference, but it exits canonical module-level formatting.
Annotation suggestions and generated examples must therefore insert the
inferred type, never a placeholder type variable chosen merely because the
type is not yet known.

### 1.2 Constraint boundaries

Constraints follow the output side of the boundary doctrine:

- an exported function writes the constraints it intends to publish, even when
  its body would infer them;
- the published list contains only the strongest constraints: omit any
  constraint entailed by another constraint already listed;
- a non-exported module-level function omits its constraint binders and lets its
  body infer the minimal principal constraint set;
- its parameter types remain annotated, including generic structure such as
  `xs: Vector(a)`, because those annotations anchor receiver and scrutinee
  tooling.

For example, if `Hash` extends `Eq`, an exported function publishes `<a: Hash>`,
never `<a: (Eq, Hash)>`. `Eq` rides along through base-constraint entailment.
This is both the minimal canonical spelling and the clearest statement of the
strongest capability demanded.

Explicit constraints on an exported function stabilize its public contract.
Refactoring the body must not silently weaken or strengthen the generated
TypeScript declaration, and an API may deliberately demand a stronger
constraint than its current implementation happens to use. Private helpers
retain inferred constraints for the same reason their return types remain
inferred: both are outputs of the implementation.

The checker enforces the other direction as well: the body of an explicitly
constrained function may demand only constraints entailed by the published
list. A body requiring `Hash` under a written `<a: Eq>` is an error at the
definition; it does not silently strengthen the public contract. The canonical
repair is `<a: Hash>`, with the entailed `Eq` omitted.

## 2. Declarations are total; consumption is free

Union payloads and record fields are completely typed where they are declared.
Their uses do not repeat those types:

- destructuring patterns and pattern binders carry no annotations;
- constructor arguments carry no annotations;
- record literals in checked positions carry no annotations;
- an `honor` member implementation does not repeat the annotations from its
  constraint declaration;
- a record parameter uses its named alias by default;
- an explicitly written open row signals that open-row genericity is intentional.

## 3. Natural literal spelling

Write every non-negative whole-number literal in the bare integer spelling. A
checked context may resolve that literal to `Nat`, `Int`, `Float`, `BigInt`, or
another `Num` instance; do not imitate the target type in source when inference
already has enough information.

For example, a `Float` match arm returns `0`, not `0.0`, when the scrutinee and the
other arms already establish `Float`. Fractional literals retain their decimal
spelling.

## 4. Gradual rollout

1. Canonicalize and continuously compile every curated Playground example.
2. Canonicalize the repository's remaining standalone `.hex` modules, preserving
   each exported API.
3. Canonicalize embedded compiler and Playground fixtures when their owning tests
   are next changed.
4. Canonicalize live specification and book examples, rebuilding generated book
   artifacts from their source chapters.
5. Audit diagnostics, snippets, and templates so generated suggestions teach the
   same forms.
6. Once the corpus has converged, encode only mechanically reliable rules in the
   formatter or linter; leave intent-sensitive choices such as named aliases versus
   explicit open rows to review.

Each phase must typecheck before and after the edit. Formatting changes must not
alter the intended inferred types, exported declaration shapes, or emitted
behavior of well-typed programs. Canonical annotations deliberately reject a
program when its written boundary disagrees with what the body requires.

## 5. Conditionals

Every conditional uses mandatory `then` and `else`. Keep a genuinely short
conditional on one line:

```
if isTall then 5 else 6
```

Otherwise use the reliable multiline form:

```
if condition then
    trueExpression
else
    falseExpression
```

The formatter may collapse the multiline form only when the complete conditional
fits the configured line-width limit.

In multiline code, a nested false-branch conditional is indented beneath `else`;
`else if` is reserved for a complete conditional that stays on one line.
