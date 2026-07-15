# Group Review: Capabilities and Calls

**Chapters reviewed:** Constraints; Derivation; Modules; Dot Calls.

**Status:** Reviewed as a consistent drafting group. This is not the late whole-book
pedagogy pass, and chapter numbers remain provisional.

## Coherence result

The group follows one clear progression:

1. constraints let generic code require named behavior;
2. deriving lets nominal data request lawful standard behavior without repeating its
   structure;
3. modules give declarations, instances, and companion operations stable homes; and
4. dot calls provide convenient access to ordinary subject-first companion
   functions without turning values into objects with methods.

The distinction between constraint operations and companion operations is the
load-bearing connection. Chapter 12 establishes that `show(value)` selects an
instance. Chapter 15 then explains that `value.operation()` selects an exported
function from a known type's companion and explicitly does not search instances. The
similar-looking conveniences therefore meet without being conflated.

## Integrated corrections

- Changed the generic JavaScript example in Constraints to carry its dictionary after
  the source arguments. Trailing dictionary parameters preserve the subject-first
  position and agree with the established FFI direction.
- Replaced “stable hashing” with the narrower promise that hashing is consistent with
  equality. Hash values are deterministic within an execution, but collection table
  placement may be randomized and cross-execution stability is not promised here.
- Stated Hexagon's required-foundation rule for equality directly, without making
  understanding it depend on familiarity with Haskell.
- Clarified derived record ordering: fields are visited in field-name order and their
  values are compared lexicographically.
- Corrected the nested function type example from `Box(Int -> Int)` to
  `Box(Int -> Int)`.
- Added the transparent-alias rule to Dot Calls: an alias creates no new
  companion and uses the companion of its expanded type.
- Defined a nominal type's **home module** directly as the file that declares it before
  opacity, instance placement, and dot-call lookup depend on the term.
- Related Hexagon's four import forms to familiar JavaScript ES module imports before
  stating the language's exact path and namespace rules.
- Standardized the reader-facing term **dot call** and retained “method-style” only as
  an informal lookup synonym.
- Added principal index entries for derivation, dot calls, and subject-first
  style.

## Pedagogical dependency check

Constraints arrives only after ordinary polymorphism, operators, nominal types, and
direct function calls are familiar. The `Show` example makes constrained polymorphism
concrete before the chapter names dictionaries or discusses coherence. `Area` then
introduces user-defined constraints, required operations, defaults, and instances in
one small domain. Superconstraints, coherence, and the orphan rule follow only after
the reader knows what an instance supplies.

Deriving depends on that full instance model. Its two spellings are shown together,
so `derives` is understood as concise instance generation rather than a separate
feature. Records precede unions, matching their earlier teaching order. Hashing is
explained only far enough to justify the equality law and the derived-only rule;
collection mechanics remain deferred.

Modules arrives only after declarations, nominal types, constraints, and derivation
make privacy, opacity, and global instances meaningful. It then defines home and
companion modules before Dot Calls depends on them. Dot calls reuse the subject-first
convention and pipes from the opening chapters. The three-spelling example gives the
entire feature before the lookup rules add precision.

No idea in the group needs to move later. The late pedagogy pass should nevertheless
test whether the orphan rule and the unknown-receiver fallback need more breathing
room for a reader encountering type-directed lookup for the first time.

## Terminology and index check

- **Constraint**, **instance**, and **constrained polymorphism** are defined together
  at first use.
- **Default operation**, **superconstraint**, **coherence**, **orphan rule**, and
  **dictionary** each receive a direct definition where their purpose is visible.
- **Derivation** is presented through `derives` and `derive`; its index entry points
  back to instances rather than treating it as unrelated machinery.
- **Home module**, **companion module**, **subject-first**, and **dot call** form one
  vocabulary across Modules and Chapter 15.
- Principal definitions and useful lookup forms are represented in
  `INDEX-CANDIDATES.md`.

## Example continuity

`Show` moves from interpolation and inferred obligations to a parameterized
`Show<Box(a)>` instance, then returns in the distinction between `show(value)` and a
dot call. `Eq` moves from operators to a required `equals` foundation and inherited
`notEquals`, then into derived equality. No returning example changes the operation an
operator selects.

`Point`, records, and unions reuse data shapes already established in Chapters 9–11.
`Option.getOrElse(possibleName, "Guest")` connects the earlier subject-first and pipe
material to the dot spelling in one compact example. Its clarity also makes it
suitable for the repository README without requiring the surrounding chapter.

## Technical surface check

- Required and defaulted constraint operations, completed-instance dispatch,
  superconstraints, coherence, orphan placement, simple instance heads, and global
  instance participation agree with the constraints specification.
- `Eq.notEquals` inherits from required `equals`; circular user defaults remain
  possible ordinary recursion and receive an appropriately brief warning.
- Genuinely polymorphic emitted functions carry trailing dictionary arguments;
  concrete operations may still specialize away dictionary plumbing.
- Nominal opt-in derivation, automatic structural instances, record field ordering,
  union declaration ordering, parameter obligations, and the derived-`Eq` requirement
  for `Hash` agree with the data and collections specifications.
- File identity, four import forms, privacy, opacity, global instances, acyclic loading,
  root execution, and one-to-one ESM emission agree with the modules specification.
- Dot-call lookup uses the independently known receiver type and its single companion;
  bare dots remain fields, collisions require explicit spelling, and abstract
  constraint dispatch remains a direct call.
- The JavaScript and `.d.ts` accounts remain consistent: derivation creates ordinary
  generated operations, dot calls erase to function calls, and neither feature adds
  runtime methods or TypeScript method members.

## Deferred to later reviews

- The FFI chapters must reconcile internal trailing dictionaries with exported dictionary
  types and explain the qualified dictionary surface without contradicting the plain
  `.d.ts` statements here.
- The late pedagogy pass should reconsider pacing, final cross-references, index
  locators, and whether any coherence material belongs in an advanced aside.

## Review result

After the integrated corrections, no known technical contradiction remains in the
four chapters or between this group and Chapters 1–11. The sequence gives one account
of capability requirements, generated instances, declaration homes, public APIs, and
convenient ordinary function calls while maintaining the distinction between instance
dispatch and companion lookup. Collections and Associated Types have since discharged
the group's `Hash` and `Iterable` promises; the final FFI group owns the remaining
boundary promises.
