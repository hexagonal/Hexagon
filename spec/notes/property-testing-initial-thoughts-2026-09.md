# Property testing for Hexagon — initial thoughts

**Status:** Exploratory, non-normative; 2026-09-24. James considers a
Hedgehog-style testing framework worth substantial design investigation and is
open to language features specifically intended to make it easier and more
automatic to use. This note records the initial suggestions from Codex for
further discussion, including comparison with ideas from Claude. The individual
features below are candidates, not approved language decisions. This note does
not authorize implementation or amend any normative specification.

## 1. Aim

Make property testing an ordinary part of programming in Hexagon:

> Write a small statement about a program, run it, and receive a small,
> understandable counterexample when it fails.

Functional code, algebraic data types, and explicit effect contracts make this a
promising fit. Library design and language support should be considered together:
the compiler can remove setup and improve diagnostics where a library lacks
source information, while generators and property combinators can remain ordinary
typed values.

Example tests and explicit regression cases remain essential. They should share
a runner and reporting model with randomized properties rather than require a
separate testing ecosystem.

## 2. Hedgehog as an influence

The central idea to retain is **integrated shrinking**. A generator describes how
to construct inputs and carries ways to simplify them after a failure. Users
should not normally need to write an independent shrinker that reconstructs the
generator's invariants.

Other useful influences include:

- Explicit ranges and size controls for numbers and collections.
- Composable generators, including generation that depends on earlier values.
- Structural differences in assertion failures.
- State-machine testing against an abstract model, as a later capability.

This is an intended user experience, not a commitment to port Hedgehog's API or
internal representation. Integrated shrinking does not guarantee a globally
minimal counterexample. Filtering, dependent generation, and shrink search order
need careful investigation before choosing an engine or promising particular
invariant-preservation behaviour.

Sources for further discussion:

- [Hedgehog overview and examples](https://github.com/hedgehogqa/haskell-hedgehog).
- [Hedgehog discussion of filtering and shrinking](https://github.com/hedgehogqa/haskell-hedgehog/issues/281).

## 3. Candidate language support

### 3.1 First-class test and property declarations

The compiler could recognise test declarations and retain their names and source
locations. This could support automatic discovery, editor run actions, and direct
navigation from failures without manual registration.

The following is an illustration of the desired reading experience only. Neither
the syntax nor the API names are proposed as settled Hexagon grammar:

```text
property "reversing twice preserves a vector"
    xs <- Gen.vector(Gen.int(...))
    assert xs.reverse().reverse() == xs
```

Open questions include where tests may be declared, whether they can access
module-private definitions, how test dependencies enter a project, and how test
code is excluded from ordinary builds. Discovery should not depend on executing
arbitrary module initializers merely to find tests.

### 3.2 Compiler-assisted assertions

For an assertion such as:

```text
assert actual == expected
```

the compiler could supply the expression text, source location, and operand
values. The desired report includes the reduced generated inputs, the failing
assertion, and a useful structural difference between the values.

Evaluation order and evaluation count must be preserved: diagnostic capture must
not evaluate either operand twice. More complex expressions must retain ordinary
short-circuit behaviour. Equality must continue to mean the selected Hexagon
equality operation; diagnostic structure must not silently redefine it.

Questions to resolve include the requirements for displaying values, treatment of
opaque types and custom equality, and whether assertion support is test-specific
or a generally available construct. Rich diagnostics should not casually add
hidden constraints to otherwise valid expressions.

### 3.3 Opt-in generator derivation

Hexagon currently supports opt-in derivation of `Eq`, `Ord`, `Show`, and `Hash`;
see [Constraints](../constraints.md). Generation could become another derivable
capability, with explicit size management for recursive unions.

However, a type describes possible values, not a good testing distribution. An
`Int` may represent an age, an index, or an intentionally invalid input. A
structurally valid tree may need additional balancing or ordering invariants.

The initial preference is therefore:

- Opt-in derivation as a convenient starting point.
- Explicit generators that are easy to supply, compose, and override per test.
- No assumption that a function's parameter types alone adequately specify how
  to test it.

The capability's name and interface are open. Derivation needs rules for
constructor frequencies, recursive size budgets and base cases, unavailable
field generators, and abstract types whose valid construction is controlled by
their defining module. It must not bypass that module's invariants.

### 3.4 Straight-line binding syntax

Writing dependent generators without nested callbacks is important. A typical
case is generating a nonempty vector and then an index valid for that vector.
Shrinking must account for the relationship between these values.

Two approaches merit comparison:

- A dedicated property/generator block with a bounded set of operations.
- A small general binding construct that can also serve generators and
  properties.

Any candidate needs an explicit elaboration into typed operations and an account
of branches, bindings, and failures. Hindley–Milner inference remains a design
constraint. This investigation is not a commitment to higher-kinded types,
general effect handlers, or a monad abstraction in the language.

The syntax should follow the generator semantics. An attractive surface alone
does not resolve dependent shrinking or filtering behaviour.

### 3.5 Executable constraint laws

[Constraints §7](../constraints.md) currently describes laws as expectations
outside the language: constraints supply signatures, and the checker does not
establish that handwritten instances obey their laws.

A testing framework could provide reusable law suites for `Eq`, `Ord`, and other
constraints. Given a concrete instance and suitable generators, the runner could
instantiate the applicable suite. For example, an ordering suite could check
agreement between ordering and equality.

A later language feature might associate reusable law suites with user-defined
constraints, making law checks discoverable and easier to request. Start by
exploring ordinary library law suites before deciding whether dedicated syntax
or compiler metadata earns its cost.

Passing randomized law checks is not proof. It must not grant compiler
optimizations or coherence privileges that require guaranteed laws. Generator
selection, coverage, and the chosen concrete instantiations remain part of what
was actually tested.

## 4. Reproduction and effects

### 4.1 Reproducible failures

Every randomized failure should produce a convenient replay command or token.
The design needs to account for the seed, generation size/settings, test identity,
and relevant framework or generator versions. A seed alone is not a promise of
reproduction after the generator or engine changes.

Decide separately whether to persist failing examples, how to promote a reduced
case into an explicit regression test, and what replay stability is promised
across releases. Parallel execution should not make a failure depend accidentally
on runner scheduling.

### 4.2 Honest effect contracts

Under [Effects §1](../effects.md), deterministic generation from an explicit seed
can be pure. Obtaining entropy, reporting results, and interacting with external
systems involve effects. Testing should preserve this distinction rather than
introduce an exemption from ordinary call and arrow rules.

Pure properties are a useful starting point. Effectful properties require a
defined fixture lifecycle: each trial and each shrink attempt needs fresh or
equivalently reset state, with cleanup on failure. Replaying the generator alone
cannot reproduce an uncontrolled clock, service, or filesystem state.

Exceptions also need an explicit runner policy. Hexagon deliberately treats
throwing separately from effects; a pure property can still throw. Reports should
distinguish assertion failures, unexpected exceptions, and generator or runner
failures. Shrinking should not quietly substitute an unrelated failure for the
original one.

## 5. Candidate initial scope and order

The initial suggested scope is:

1. A generator model with integrated shrinking and explicit range/size controls.
2. Explicit generators and a small property API.
3. Test discovery, strong assertion diagnostics, and failure replay.
4. Ordinary example tests in the same runner.

Opt-in generator derivation is a subsequent candidate. Reusable constraint law
suites provide an early library experiment; automatic association of laws with
constraints is a larger language-design opportunity. State-machine testing is a
later extension whose needs should inform, but not dominate, the foundations.

Before promotion to a normative design, compare small examples covering:

- Independent inputs, such as vector reversal.
- Dependent inputs, such as a vector and a valid index.
- A recursive union with bounded generation.
- A domain invariant constructed directly versus enforced by filtering.
- A custom equality instance with useful failure reporting.
- An effectful property with fresh fixtures during shrinking.

These examples should establish which compiler features meaningfully improve the
experience, which operations fit in a library, and which shrinking guarantees
the implementation can support. Syntax, derivation policy, and law integration
remain decisions for further discussion and manual approval.
