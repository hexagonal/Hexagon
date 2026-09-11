# Questions for semantic consolidation

**Status:** Deferred discussion agenda, non-normative; 2026-09-12.

Finish and stabilize the current batch of changes before returning to these
questions. This note adopts no new language rules and requests no immediate
implementation changes.

The aim is to explain Hexagon through a small set of consistent principles,
reconcile the existing specification against them, and separate current rules
from superseded reasoning. Whether all existing features fit together remains
an investigation, not an assumed conclusion.

## 1. What is the typed core, if one already exists?

What representation does Hexagon elaborate into today, and could we give that
representation a compact, precise semantics? Inspect the compiler's actual
representations and phase boundaries before assuming there is a distinct typed
core. Identify what remains after literals, dot-calls, widening, and pattern
syntax are elaborated, and where typing or lowering decisions remain unresolved.
If there is no suitable existing core, consider how one could be defined.

## 2. How is each expression typed?

Distinguish inferring a type, checking against an expected type, discharging
constraints, inserting conversions, and defaulting. State where information may
flow and in what order these steps occur, especially where extensions interact
with HM-style inference and let-polymorphism.

## 3. When are choices committed?

Specify what establishes an operation's type and whether later information can
change that choice. Explain when operation lookup, dictionary selection, and
conversion insertion become fixed, including what happens when a proposed route
fails. Identify any dependence on the order in which expressions are checked.

## 4. What must agree?

State the invariants shared by different parts of the language. For example,
pattern coverage identity must agree with runtime matching equality, and
equivalent call spellings must agree wherever the language promises equivalence.
Separate algebraic instance laws from elaboration rules and compiler guarantees;
record which properties are specified, tested, or proved.

## 5. Where are the deliberate boundaries?

Explain when a separate binding, annotation, or qualified call changes inference
behavior, with small examples. Make the permitted scope of expected-type
propagation and implicit conversion explicit, together with the points where
inference must refuse rather than choose another interpretation.

## How to assess the consolidation

Use examples that cross feature boundaries: numeric literals inside declared
patterns, expected numeric types through dot-calls, and expressions written
inline versus assigned to a variable first. Their behavior should follow from
the rules rather than become additional exceptions.

Give each normative rule one authoritative home. Move historical reasoning and
superseded decisions out of the normative path while preserving them as history.
Keep unresolved design questions explicit instead of silently resolving them
during editorial cleanup.

The practical test is whether an unfamiliar example can be explained from a few
stable principles without reconstructing the sequence of fixes that produced
the current behavior. Specification cleanup, formal guarantees, and compiler
conformance are separate outcomes and should be reported separately.
