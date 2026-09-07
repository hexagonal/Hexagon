# String text processing

**Status:** Design decisions agreed in discussion on 2026-09-06. Proposal only:
not yet implemented or incorporated into the normative specification or book.
The integration questions in section 11 remain open.

**Home:** Public companion functions in `stdlib/String.hex`. Related Vector
changes are kept separately in [Vector API follow-ups](vector-string-api-followups.md).

## 1. Foundation

String operations address Unicode codepoints, not JavaScript UTF-16 code units.
Positions are 1-based. Iteration already yields one-codepoint Strings through
`Iterable<String>` / `String.toSeq`; there is no separate `Char` type in this
proposal. Existing String indexing, slicing, ordering, `toSeq`, and `fromSeq`
remain governed by their owning specifications.

Use native host operations only where they implement the Hexagon contract.
Host positions, empty-pattern behaviour, whitespace definitions, replacement
tokens, and casing algorithms must not silently determine the public semantics.
Functions that return Strings do not implicitly normalize Unicode text.

Signatures below describe the proposed qualified API; they are not declaration
syntax. Ordinary String-subject functions also support dot calls. Arguments are
subject-first. `String.join` takes its sequence first and is shown qualified.

## 2. Splitting

```text
String.lines(text: String): Vector(String)
String.words(text: String): Vector(String)
String.split(text: String, delimiter: String): Vector(String)
String.splitCI(text: String, delimiter: String): Vector(String)
```

All four produce eager Vectors. `split` uses an exact, case-sensitive literal
delimiter of any length. Both split functions consume leftmost non-overlapping
matches, scanning from the beginning, and preserve empty fields, including at
both ends. `splitCI` uses section 5's matching rule and preserves the original
spelling of each returned piece.

```hexagon
"a,,b".split(",")                  // ["a", "", "b"]
",a,".split(",")                   // ["", "a", ""]
"".split(",")                      // [""]
"OneENDTwoendThree".splitCI("end")  // ["One", "Two", "Three"]
"aßb".splitCI("SS")                // ["a", "b"]
"aßb".splitCI("s")                 // ["aßb"]
```

An empty delimiter matches each original codepoint boundary, including the
initial and final boundaries. Both split functions therefore behave as follows:

```hexagon
"abc".split("")  // ["", "a", "b", "c", ""]
"😀a".split("")  // ["", "😀", "a", ""]
"".split("")     // ["", ""]
```

This follows Rust's empty-separator convention. It deliberately differs from
.NET's single-string separator overload. `toSeq` remains the operation for
obtaining codepoints without these empty fields.

`words` splits on runs of Unicode `White_Space`, discards surrounding whitespace,
and produces no empty words. Empty or whitespace-only input gives `[]`. U+FEFF
is not whitespace under this definition.

`lines` recognizes exactly CRLF, CR, and LF. CRLF is one separator; mixed endings
are accepted. Other newline-like codepoints, including U+0085, U+2028, and U+2029,
remain content. Terminators are removed. Interior blank lines survive, but a
final terminator does not create an additional line; empty input gives `[]`.

```hexagon
"a\r\nb\rc\nd".lines()  // ["a", "b", "c", "d"]
"a\nb\n".lines()        // ["a", "b"]
"a\n\n".lines()         // ["a", ""]
"\n".lines()            // [""]
"".lines()               // []
```

## 3. Dropping codepoints

```text
String.dropFirst(text: String): String
String.dropLast(text: String): String
String.dropFirstN(text: String, count: Int): String
String.dropLastN(text: String, count: Int): String
```

The counted operations remove codepoints from the named end, preserving the
remaining order. Nonpositive counts leave the input unchanged; counts at least
as large as its length give `""`. Empty input stays empty. The single-codepoint
functions delegate to their counted counterparts with `1`.

```hexagon
"😀abc".dropFirstN(2)  // "bc"
"abc😀".dropLastN(2)   // "ab"
"abc".dropFirstN(0)   // "abc"
"abc".dropLastN(-3)   // "abc"
"abc".dropFirstN(20)  // ""
```

Slicing selects a window by positions; dropping expresses removal from an end.
Both remain public operations. The separate Vector note records the same family
over elements.

## 4. Trimming

```text
String.trim(text: String): String
String.trimStart(text: String): String
String.trimEnd(text: String): String
```

Remove the maximal run of Unicode `White_Space` from both ends, the beginning,
or the end respectively. Interior whitespace is preserved. Empty input stays
empty; all-whitespace input becomes empty. U+FEFF is not removed. This follows
Rust's whitespace definition and start/end terminology.

## 5. Literal tests and CI matching

```text
String.contains(text: String, target: String): Bool
String.startsWith(text: String, prefix: String): Bool
String.endsWith(text: String, suffix: String): Bool
String.containsCI(text: String, target: String): Bool
String.startsWithCI(text: String, prefix: String): Bool
String.endsWithCI(text: String, suffix: String): Bool
```

The ordinary functions match exact, case-sensitive codepoint sequences. Empty
patterns succeed for all three tests, including on empty input.

The CI family uses Unicode default full case folding, independent of the
machine's locale, without implicit normalization. A match must be a contiguous
substring of the original text whose full case fold equals the full case fold
of the pattern. Prefix and suffix tests additionally require the corresponding
original-text endpoint. Matches cannot begin or end inside a codepoint's folded
expansion. This follows ICU's full-fold literal regex matching precedent.

```hexagon
"Straße".containsCI("STRASSE")  // True
"ß".containsCI("ss")           // True
"ss".containsCI("ß")           // True
"ß".containsCI("s")            // False
"ß".startsWithCI("s")          // False
"ß".endsWithCI("s")            // False
```

Consequently, blindly folding both complete inputs and invoking ordinary
substring search is not a correct implementation. Locale-specific matching is
outside this agreed family.

**Naming decision:** Two-letter initialisms stay uppercase within camelCase or
PascalCase names (`containsCI`, `IOStream`); longer initialisms are treated as
words (`Html`, `Csv`, `Json`, `Http`). At the beginning of a camelCase name the
initialism is lowercase (`ioStream`). This follows the Microsoft/Kotlin
precedent. Promotion of the general convention belongs in the naming guidance.

## 6. Replacement

```text
String.replace(text: String, target: String, replacement: String): String
String.replaceFirst(text: String, target: String, replacement: String): String
String.replaceCI(text: String, target: String, replacement: String): String
String.replaceFirstCI(text: String, target: String, replacement: String): String
```

`replace` and `replaceCI` replace all non-overlapping matches, scanning from the
beginning. The `First` variants replace only the first match. Matching uses
section 5's exact or CI rule. Unmatched text preserves its original spelling;
each matched original span is replaced by the supplied replacement unchanged.
Both arguments are literal strings, with no regex or replacement-token syntax.
Inserted text is never searched again. No match leaves the input unchanged.

An empty target matches each original codepoint boundary. All-match replacement
inserts at all those boundaries; first-match replacement inserts only at the
beginning. This follows Rust's `replace` / `replacen` behaviour.

```hexagon
"aaa".replace("aa", "x")     // "xa"
"a".replace("a", "aa")      // "aa"
"😀a".replace("", "-")      // "-😀-a-"
"".replace("", "-")         // "-"
"ab".replaceFirst("", "-")  // "-ab"
"ß".replaceCI("", "-")      // "-ß-"
```

## 7. Joining and laws

```text
String.join(parts: Seq(String), separator: String): String
```

Join the elements in traversal order, inserting the separator between elements
only. Empty elements are preserved; an empty sequence produces `""`, and a
singleton produces its element unchanged. A Vector supplies `.toSeq()`.
Producing the result consumes the sequence; an infinite sequence cannot produce
a completed result. `String.fromSeq` retains its existing concatenation role.

The following laws hold for finite sequences and valid inputs, including empty
patterns and delimiters:

```hexagon
String.join(parts, "") == String.fromSeq(parts)
String.join(text.split(delimiter).toSeq(), delimiter) == text
String.join(text.split(target).toSeq(), replacement)
    == text.replace(target, replacement)
String.join(text.splitCI(target).toSeq(), replacement)
    == text.replaceCI(target, replacement)
```

Rejoining `splitCI` with its delimiter need not reconstruct the original text:
matched delimiter spans may have different spelling, case, or codepoint length.

## 8. Search positions

```text
String.indexOf(text: String, target: String): Option(Int)
String.indexOfCI(text: String, target: String): Option(Int)
String.lastIndexOf(text: String, target: String): Option(Int)
String.lastIndexOfCI(text: String, target: String): Option(Int)
```

Return the least or greatest starting position of a valid match in the original
text, respectively. Positions count codepoints from 1; absence is `None`.
Overlapping candidates participate: `"aaa".lastIndexOf("aa") == Some(2)`.
CI positions use section 5's matching rule and never index the folded text.

An empty target gives `Some(1)` for the first match and
`Some(text.length() + 1)` for the last. Both give `Some(1)` on empty text. These
are boundary positions for an empty match, not assertions that an element exists
at that position. `"😀hello".indexOf("hello") == Some(2)`.

## 9. Scalar/integer conversion and casing

```text
String.toCodepoint(text: String): Option(Int)
String.fromCodepoint(value: Int): Option(String)
String.toUpper(text: String): String
String.toLower(text: String): String
String.caseFold(text: String): String
```

`toCodepoint` succeeds only for exactly one Unicode scalar value. `fromCodepoint`
accepts integers in `0..0x10FFFF`, excluding `0xD800..0xDFFF`. Invalid input gives
`None`, never a replacement character. This adapts Rust's checked conversions to
Hexagon's convention of using Strings for individual codepoints. When
`text.toCodepoint() == Some(n)`,
`String.fromCodepoint(n) == Some(text)`, and conversely for accepted integers.

`"😀".toCodepoint() == Some(128512)`;
`String.fromCodepoint(128512) == Some("😀")`. Empty and multi-scalar Strings fail.
This is scalar counting, not grapheme counting.

`toUpper` and `toLower` perform Unicode default locale-independent case mappings,
including the context-sensitive rules of those mappings. `caseFold` performs
Unicode default full case folding. Results may change codepoint length. No
normalization is implicit. Their distinct purposes are visible in:

```hexagon
"Straße".toUpper()   // "STRASSE"
"Straße".toLower()   // "straße"
"Straße".caseFold()  // "strasse"
```

## 10. BOM handling at text input

Ordinary String processing preserves U+FEFF unless an operation explicitly
matches or removes it. It participates in length, positions, equality, and
ordering. `words` and trimming follow Unicode whitespace, which excludes it.
No dedicated `String.stripBom` function was adopted.

The agreed direction is for the usual text-file reader to consume an initial
encoding signature. Raw byte reading preserves bytes. The discussed Node wrapper
reads UTF-8 and removes exactly one initial U+FEFF; it does not detect UTF-16 or
UTF-32. F#'s usual .NET reader provides precedent for consuming the signature,
while Rust's `read_to_string` preserves it.

Illustration using this proposed String API, not a landed module:

```hexagon
module Hex.Experimental.Node.File

extern from "node:fs"
    fun readFileSync(path: String, encoding: String) ->! String

export let readText(path: String): String =
    let text = readFileSync!(path, "utf8")
    if text.startsWith("\u{FEFF}") then
        text.dropFirst()
    else
        text
```

## 11. Open integration questions and promotion work

- **Runtime String validity at foreign boundaries:** source literals reject
  surrogate values, but the current trusted FFI String contract and checked
  `JsValue.toString` do not establish a scalar-only runtime String invariant.
  The scalar-only conversions agreed here do not by themselves change that
  boundary. Decide the handling of ill-formed host strings before implementing
  this surface; do not silently add replacement or general FFI validation.
- **Unicode data:** choose the supported data version and update policy for
  whitespace, case mapping, and full case folding. Host lowercase is not a
  substitute for full case folding.
- **Implementation and complexity:** establish the native/Hexagon split under
  `spec/intrinsics.md`, document costs, and preserve existing collection
  contracts. In particular, joining must account for element traversal even
  when elements and separators are empty. No blanket constant-time String
  indexing or host-delegation claim is made here.
- **Owning documents:** reconcile `spec/primitive-types.md` and Collections
  Parts 3 and 5 with the adopted API, including the old separator-first join
  candidate in Part 5 section 14.2. Update the String companion's stale comment
  about lacking a codepoint API when the bridge is implemented. Keep normative
  spec, book, and public source documentation aligned.
- **Case-insensitive keys:** the existing `CiString` working proposal owes a
  name and folding semantics. Reconcile it with this full-fold decision and the
  new initialism convention in its own discussion; no wrapper API is adopted
  here.

## 12. Precedents consulted

- [Rust String operations](https://doc.rust-lang.org/std/primitive.str.html):
  empty-pattern splitting/replacement, final-line termination, Unicode whitespace.
  Hexagon additionally accepts lone CR as a line terminator; Rust accepts LF
  and CRLF.
- [Rust character conversion](https://doc.rust-lang.org/std/primitive.char.html#method.from_u32)
  and [string-to-character parsing](https://doc.rust-lang.org/src/core/char/convert.rs.html):
  checked scalar construction and exactly-one conversion.
- [Elm String](https://github.com/elm/core/blob/1.0.5/src/String.elm):
  `lines`, `words`, `split`, `join`, all-occurrence `replace`, and named drops
  alongside slicing. Hexagon does not adopt Elm's UTF-16-sensitive operations.
- [Unicode case mappings](https://www.unicode.org/faq/casemap_charprop.html)
  and [default caseless matching, section 3.13.5](https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-3/).
- [ICU literal case-insensitive matching](https://unicode-org.github.io/icu/userguide/strings/regexp.html#case-insensitive-matching):
  full folding with original-character match boundaries.
- [Kotlin naming](https://kotlinlang.org/docs/coding-conventions.html#choose-good-names)
  and [Microsoft capitalization](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/capitalization-conventions):
  two-letter versus longer initialisms.
- [F#/.NET text reading](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.readalltext):
  consuming an initial BOM at the decoding boundary.
