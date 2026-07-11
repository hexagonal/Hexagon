# Compiler Readability and Commenting Doctrine

**Status:** Initial architecture decision. Binding on compiler implementation code; revisable through an explicit recorded change.

## 1. Purpose

The Hexagon compiler is intended to be understandable by a human reader, including a reader learning how the compiler works. Its source should expose the ideas behind lexing, layout, resolution, inference, elaboration, and emission instead of relying on the type checker to be its only explanation.

TypeScript types describe the shapes that code accepts and returns. Comments have a different job: they explain the compiler concept, invariant, semantic reason, or non-obvious implementation choice.

The goal is not to maximize the number or length of comments. The goal is that a reader can understand what an important function is doing and why without first reconstructing the algorithm from its mechanics.

## 2. Governing rule

> Comment the idea represented by the code, not the type information already visible in the code.

An important function normally receives a short conceptual comment. The comment should answer whichever of these questions matter:

- What compiler operation does this function perform?
- Why is that operation necessary?
- Which invariant does it establish or preserve?
- What semantic consequence would follow from doing it differently?
- Which unusual mutation or performance technique implements the simpler conceptual model?

Comments should be written for a reader of the compiler. User-facing diagnostics remain written for a Hexagon programmer and must not expose implementation vocabulary unnecessarily.

## 3. Module introductions

Every substantial compiler module begins with a compact introduction covering the relevant parts of this contract:

1. the compiler concept owned by the module;
2. the representation or phase it consumes and produces;
3. the invariants it establishes;
4. the work deliberately left to another pass; and
5. the governing specification section when behaviour is normative.

A module introduction is not a catalogue of all exports. It gives the reader the mental model needed to understand them.

Small mechanical modules, such as a collection of character predicates, do not need ceremonial introductions when their purpose is already completely clear.

## 4. Function comments

Important functions receive comments that explain their role in the algorithm. This especially includes:

- pass entry points and phase boundaries;
- layout-stack and scope-stack operations;
- name binding and lookup;
- unification, generalisation, instantiation, and defaulting;
- row-polymorphism operations;
- exhaustiveness and reachability analysis;
- dictionary elaboration and specialization;
- representation selection and code generation; and
- recovery paths that affect subsequent diagnostics.

Comments are most valuable above functions whose names state the operation but cannot state its reasoning:

```ts
// Generalize variables created deeper than the surrounding environment.
// Variables reachable from that environment remain monomorphic: allowing
// them to escape would let separate uses interfere through one shared cell.
function generalize(type: TypeId, environmentLevel: Level): TypeScheme {
  // ...
}
```

A comment that only translates the signature into English adds no information:

```ts
// Avoid: Takes a TypeId and a Level and returns a TypeScheme.
function generalize(type: TypeId, environmentLevel: Level): TypeScheme {
  // ...
}
```

Public API documentation may still describe parameters when their meaning, units, ownership, or permitted range is not evident from their names and types.

## 5. Comments inside algorithms

Use local comments to introduce conceptual stages, justify a non-obvious branch, or state an invariant around mutation:

```ts
// Resolve earlier bindings first so the comparison sees the current shape
// of each type rather than the path used to reach it.
left = types.find(left);
right = types.find(right);

// A free variable may adopt the other type only after the occurs and level
// checks rule out an infinite type or a variable escaping its scope.
if (types.isVariable(left)) {
  bindVariable(left, right, context);
  return;
}
```

Do not narrate assignments, loops, or branches already clear from the code. Prefer a clear intermediate name or a small helper over a comment that decodes a compressed expression.

## 6. Mutation and optimized representations

Hexagon does not avoid imperative techniques where they simplify the compiler or make it faster. Mutable union-find cells, dense indexed tables, arenas, work queues, scope maps, and layout stacks are all legitimate tools.

When optimized mechanics obscure the underlying idea, comments must preserve the conceptual model. For example, code using integer-indexed parallel arrays should still explain that it is maintaining equivalence classes of type variables. Path compression should explain which invariant permits the mutation, not merely say that an array element is being assigned.

Comments around subtle mutation should make clear:

- which state is mutated;
- which invariant is true before and after the operation;
- whether callers may retain references or indices into that state;
- whether failure requires rollback; and
- whether the mutation changes semantics or only representation.

The compiler must not discard source provenance or semantic facts merely to make an optimization easier. If information moves to a source store, origin link, or side table, the relevant representation documentation should say where it remains available.

## 7. Specification references

Where code implements a normative language rule, cite the narrowest useful specification section:

```ts
// A semicolon is a separator rather than a terminator, so EOF after `;` is
// diagnosed here instead of becoming an empty statement.
// See Lexer & Layout §3.2.
```

The comment should still summarize the rule. A bare path or section number forces the reader to leave the code before learning why it behaves as it does.

References should point to stable normative documents where possible. Notes and roadmap items may be cited when they are genuinely the current authority, but the comment should be updated when the rule is promoted or changed.

## 8. Terminology and tone

Use established compiler terms when they make the explanation more precise, and explain a specialized term on its first important use in a module. Prefer direct ordinary language over academic shorthand when both are equally accurate.

Comments should be confident about settled invariants and explicit about temporary limitations. Avoid jokes, conversational filler, historical narration with no present consequence, and claims that code is "obvious" or "simple." Such claims do not help a reader who is trying to understand it.

Write comments as complete sentences with the same terminology used by the architecture and specification. In particular, preserve the canonical phase vocabulary from `naming.md`.

## 9. Keeping comments trustworthy

A misleading comment is worse than an absent one. A change to an algorithm must update its conceptual comments in the same change. Code review treats disagreement between code and comments as a correctness problem.

Comments should describe durable reasoning rather than incidental line-by-line structure. If a harmless refactor makes a comment false, the comment was probably too mechanical.

Tests remain the executable evidence for edge cases. Comments explain the rule and its rationale; they do not attempt to enumerate every test case.

## 10. Review checklist

Before a compiler change is complete, check:

- Can a reader state the purpose of each new substantial module?
- Do important functions explain their compiler role or invariant?
- Are non-obvious mutations and performance representations conceptually explained?
- Do comments avoid repeating signatures and self-evident control flow?
- Are normative behaviours connected to the relevant spec sections?
- Did the change leave any existing comment inaccurate?
- Would clearer naming or structure remove the need for a decoding comment?

This checklist is a judgment aid, not a comment quota. Very clear code may need little commentary; conceptually dense code may need considerably more.

## 11. Decision record

### Initial decision

- Compiler code is written to teach its important ideas to a human reader.
- Types describe program shapes; comments explain concepts, invariants, reasons, and semantic consequences.
- Substantial modules and important functions receive conceptual introductions.
- Non-obvious mutation and optimized representations retain an explanation of their simpler underlying model.
- Normative implementations cite and summarize the relevant specification rule.
- Comment volume is governed by explanatory value, not a quota.
