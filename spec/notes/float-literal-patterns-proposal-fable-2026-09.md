# Float literal patterns — proposal for Fable

**Status:** Proposed, non-normative; 2026-09-06. Records the design agreed in
discussion with James. This note requests a specification correction and its
subsequent implementation; it does not claim either has landed.

## 1. Decision requested

Allow `Float` literals in patterns, using the existing `Eq<Float>` semantics.
Remove the permanent ban. Named special values remain ordinary expressions and
are tested through guards.

The existing rules contradict one another. [Pattern Matching §2.5](../pattern-matching.md)
says literal patterns elaborate through `Eq`, but bans Float literals partly
because “NaN would never match its own literal.”
[Decisions Batch §1](../decisions-batch-2026-07.md) defines `Eq<Float>` as
SameValueZero: NaN equals NaN, and positive and negative zero compare equal.
The NaN rationale is therefore false. Signed zero sharing an equality class is
also no reason to prohibit patterns that explicitly follow that equality.

There is ML precedent: [F# constant patterns](https://learn.microsoft.com/en-us/dotnet/fsharp/language-reference/pattern-matching)
include floating-point literals. Hexagon's own equality contract determines the
semantics here; this proposal does not import F#'s special-value semantics.

## 2. Literal matching and typing

```hex
match value
    0.0 => "zero"
    1.5 => "one and a half"
    -2.5 => "negative two and a half"
    _ => "something else"
```

A Float literal pattern has type `Float` and unifies with the scrutinee in the
ordinary way. It does not introduce numeric coercion, overloaded Float literals,
or approximate comparison. Existing integer-literal inference is unchanged.

Its arm test is `Eq<Float>.equals(scrutinee, literalValue)`, with exactly the
meaning of `scrutinee == literalValue`. The `0.0` arm therefore also matches
negative zero. A Float literal matches a computed value only when that value is
equal under the same operation; no tolerance is implied by pattern syntax.

Negative Float literals are accepted in pattern position, just as negative
integer literals are. The parser forms the signed literal pattern; the physical
lexer token does not acquire a leading sign.

Use the existing [lexer](../lexer.md) conversion: correctly rounded binary64,
ordinary rounding and underflow permitted, overflow rejected. Thus `1.0e308`
is legal, `1.0e309` retains the existing overflow diagnostic, and `1.0e-400`
has the same matching behavior as `0.0`.

## 3. Special values use guards

James's example is the intended idiom:

```hex
match value
    x when x == Float.nan => "nan"
    x when x == Float.infinity => "positive infinity"
    x when x == -Float.infinity => "negative infinity"
    _ => "finite"
```

All three guards work under the established `Eq<Float>` semantics, including
the NaN comparison. Once they fail, the remaining Float values are finite.

`Float.nan` and `Float.infinity` are named terms, not Float literal tokens;
`-Float.infinity` and `0.0 / 0.0` are expressions. This proposal adds neither
constant-name patterns nor expression patterns. Ordinary finite literals need
no guard; named special values use the existing guard mechanism above.

## 4. Coverage and reachability

Float literal patterns are refutable. A match consisting only of Float literal
arms requires a catch-all; the checker must not attempt to enumerate binary64
values to establish exhaustiveness. Existing irrefutability restrictions in
binding positions still apply.

Literal coverage identity uses the rounded binary64 value under `Eq<Float>`,
not the written spelling. In particular:

- `0.0` and `-0.0` cover the same values.
- `1.0`, `1.00`, and `1.0e0` cover the same values.
- Different decimal spellings that round to the same binary64 value cover the
  same values, including underflow to zero.

Apply existing redundancy rules to those equivalent patterns, including inside
or-patterns and nested patterns. An earlier unguarded `0.0` arm makes a later
`-0.0` arm unreachable.

Guards retain their existing coverage treatment: they contribute no guaranteed
coverage. Do not add special reasoning about NaN or infinity guards. The `_`
arm in §3 supplies exhaustiveness by the ordinary rule.

## 5. User-defined patterns: Float components are first-class

This correction also applies to [Pattern Declarations](../pattern-declarations.md).
Its component types are general: Float components are already expressible, as
the `Paint.rgb` example demonstrates. The restriction being removed is on Float
**literal sub-patterns**, not on declaring or binding Float components. The main
`Color.rgb` and `Color.hsl` examples currently use `Int`; that workaround must
not dictate the component types of a colour API.

Use actual Float components for both views of `Color`. For example, assuming
the module has already defined pure `rgbChannels` and `hslChannels` functions
returning three Floats:

```hex
export pattern rgb(r: Float, g: Float, b: Float): Color
    view = rgbChannels

export pattern hsl(h: Float, s: Float, l: Float): Color
    view = hslChannels
```

These are match-only declarations; optional `build` members follow the existing
rules. For this illustrative API, RGB channels, saturation, and lightness are
normalised to `[0.0, 1.0]`, with hue expressed in degrees. Those conventions
belong to the example's `Color` API, not to the pattern mechanism.

```hex
import Color

match colour
    (0.0, 0.0, 0.0)rgb => "black"
    (1.0, 1.0, 1.0)rgb => "white"
    (_, 0.0, _)hsl => "grey"
    (h, s, l)hsl => "other colour"
```

Each view supplies Float values; each literal sub-pattern compares its component
using `Eq<Float>`. In the final arm, `h`, `s`, and `l` are Float bindings. The
same rules apply recursively wherever a declared pattern contains a Float
component. No integer quantisation or guard is needed for an ordinary literal
component test. A comparison requiring a tolerance remains an explicitly
authored guard, as does comparison against a named special value.

The existing view and coverage laws remain intact:

- `view` remains pure and total; this adds no compiler-derived inverse or
  relationship between `rgb` and `hsl`.
- Within the same declared view, equivalent Float literals use the coverage
  identity in §4. For example, `(0.0, _, _)rgb` shadows a later
  `(-0.0, _, _)rgb`.
- Restricted `rgb` and `hsl` rows do not establish coverage by combining facts
  about colour conversion. The checker does not infer that black has zero
  saturation or prove which Float triples the view can return.
- `(h, s, l)hsl` is irrefutable because its components are bindings and its view
  is total. It supplies exhaustiveness in the example, just as `(_, _, _)hsl`
  or `_` would. A later arm under either view would then be unreachable.

Rewrite the corresponding Pattern Declarations examples with Float heads,
Float literals, and Float return annotations wherever they return a channel.
Preserve the purpose of each example, including namespace contests, match-only
construction errors, and cross-view coverage. Neither an `Int` workaround nor
an artificial difference in numeric component types is needed to teach those
rules.

## 6. Book changes

Update the [patterns chapter](../../book/chapters/11-patterns.md) and its
[chapter plan](../../book/plans/11-patterns.md): remove the permanent Float
exclusion and its rationale, teach finite Float literal patterns, and retain
guards for the special-value example in §3.

Use the Float-based `Color` declarations and matching example above to teach
user-defined patterns: one opaque subject, two named views, actual Float
components, and ordinary literal matching inside each view. Explain why the
final binding-only `hsl` arm covers every remaining colour without requiring the
compiler to understand colour conversion. Check all accompanying snippets and
chapter summaries for the obsolete Int-only presentation or Float ban.

## 7. Adoption and implementation work

Fable should first amend the normative specification consistently:

- Replace Pattern Matching §2.5's ban with the rules above, and extend the
  literal grammar and negative-literal wording to Float.
- Correct its companion summary, excluded-feature and diagnostic tables,
  decision ledger, and Float-ban example. Remove the blanket assertion that
  every supported primitive literal arm uses JavaScript `===`.
- Audit other specification references for the old permanent ban. Keep the
  existing SameValueZero decision and lexical overflow rule.
- Update Pattern Declarations and the book as specified in §§5–6, including
  component signatures, literal examples, return types, and coverage commentary.

Implementation must carry Float literals through pattern parsing, syntax trees,
typing, coverage, and emission. Removing the parser rejection alone is not
completion. Generated tests must implement `Eq<Float>`; the existing Float
equality operation is the natural lowering. Any optimized lowering must preserve
that contract. Coverage keys must agree with runtime equality, especially at
signed zero and rounded duplicate values.

Required conformance cases are acceptance and matching of positive and negative
finite literals; a Float literal against an incompatible scrutinee; signed-zero
and rounded-value redundancy; underflow and overflow; nested and or-patterns;
missing catch-all rejection; and the complete special-value guard example,
including NaN, both infinities, and finite values. Verify that guarded arms still
do not establish coverage and that ordinary term expressions have not become
patterns.

Add declared-pattern conformance cases using `Color` views with Float components:
literal matching through `rgb` and `hsl`, Float-typed component bindings,
signed-zero redundancy within one view, mixed-view restricted arms that still
need a catch-all, and a binding-only view arm that establishes exhaustiveness
and shadows later arms under either view. Validate the revised book examples
against the implemented behavior when the proposal lands.

Report spec adoption and compiler conformance separately. There are no remaining
design objections from this discussion; the work is to make the specification
consistent and implement its stated equality rule throughout.
