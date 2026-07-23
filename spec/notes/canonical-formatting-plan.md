# Hexagon canonical formatting plan

**Status:** Planning note (July 2026). The Playground examples and `stdlib/Rat.hex`
are the first canonicalized corpus. Apply the remaining phases gradually when
their source is otherwise being touched.

## 1. Boundary-first annotation doctrine

Annotations belong at declaration boundaries:

- every module-level function annotates every parameter;
- an exported function additionally annotates its return type;
- lambdas and local bindings do not carry annotations;
- an exported value binding annotates its type;
- an exported signature names a type alias instead of spelling an inline
  structural type.

This is a tooling and maintenance convention. A pinned receiver or scrutinee gives
dot-dispatch and pattern completion a stable anchor; module boundaries form an
error firewall; exported annotations stabilize generated TypeScript declarations;
and the shape follows habits familiar to TypeScript programmers. It applies
consistently, including to literals, without changing inference semantics.

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
alter inferred types, exported declaration shapes, emitted behavior, or inference
rules.
