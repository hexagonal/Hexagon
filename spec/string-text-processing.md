# String text processing

**Status:** Normative. The public surface was agreed on 2026-09-06 and promoted
on 2026-09-16 after the runtime String-domain and Unicode-version questions were
settled. This document owns the text-processing operations exported by
`stdlib/String.hex`.

**Home:** Public companion functions in `stdlib/String.hex`. Related Vector
changes are kept separately in [Vector API follow-ups](notes/vector-string-api-followups.md).

## 1. Foundation

String operations address codepoints, not JavaScript UTF-16 code units.
Positions are 1-based. Iteration yields one-codepoint Strings through
`Iterable<String>` / `String.toSeq`; there is no separate `Char` type. Existing
String indexing, slicing, ordering, `toSeq`, and `fromSeq` remain governed by
their owning specifications.

The foundational operation promised by Primitive Types §5.1 is part of this
implementation milestone:

```text
String.length(text: String): Int
```

It counts the codepoint items described above. The text-processing operations
below build on that same unit.

Hexagon remains representation-compatible with every JavaScript string. A
well-formed surrogate pair is one codepoint. A lone leading or trailing
surrogate supplied through JavaScript is preserved as one surrogate codepoint:
iteration, indexing, exact matching, splitting, replacement, and reconstruction
must neither reject it nor replace it with U+FFFD. It has none of the Unicode
properties used here and maps to itself under case conversion and folding.
`toCodepoint` is deliberately narrower: it accepts exactly one Unicode scalar
value, so a one-element String containing a lone surrogate answers `None`.
`fromCodepoint` never constructs a surrogate.

Unicode-sensitive behavior is fixed by the repository-wide Unicode data
version, currently Unicode 17.0.0. The compiler ships the tables; the browser,
Node, or another host runtime cannot change `White_Space`, case mapping, or case
folding beneath unchanged compiler bits. A later Unicode version is adopted only
through a recorded Hexagon compatibility update, together with every generated
Unicode table that the compiler uses.

Use native host operations only where they implement the Hexagon contract.
Host positions, empty-pattern behaviour, whitespace definitions, replacement
tokens, and casing algorithms must not silently determine the public semantics.
Functions that return Strings do not implicitly normalize Unicode text.

Signatures below describe the normative qualified API; they are not declaration
syntax. Ordinary String-subject functions also support dot calls. Arguments are
subject-first. `String.join` takes its sequence first and is shown qualified.

## 2. Splitting

```text
String.lines(text: String): Vector(String)
String.words(text: String): Vector(String)
String.split(text: String, delimiter: String): Vector(String)
String.splitCi(text: String, delimiter: String): Vector(String)
```

All four produce eager Vectors. `split` uses an exact, case-sensitive literal
delimiter of any length. Both split functions consume leftmost non-overlapping
matches, scanning from the beginning, and preserve empty fields, including at
both ends. `splitCi` uses section 5's matching rule and preserves the original
spelling of each returned piece.

```hexagon
"a,,b".split(",")                  // ["a", "", "b"]
",a,".split(",")                   // ["", "a", ""]
"".split(",")                      // [""]
"OneENDTwoendThree".splitCi("end")  // ["One", "Two", "Three"]
"aßb".splitCi("SS")                // ["a", "b"]
"aßb".splitCi("s")                 // ["aßb"]
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

## 5. Literal tests and case-insensitive matching

```text
String.contains(text: String, target: String): Bool
String.startsWith(text: String, prefix: String): Bool
String.endsWith(text: String, suffix: String): Bool
String.containsCi(text: String, target: String): Bool
String.startsWithCi(text: String, prefix: String): Bool
String.endsWithCi(text: String, suffix: String): Bool
```

The ordinary functions match exact, case-sensitive codepoint sequences. Empty
patterns succeed for all three tests, including on empty input.

The `Ci` family uses Unicode default full case folding, independent of the
machine's locale, without implicit normalization. A match must be a contiguous
substring of the original text whose full case fold equals the full case fold
of the pattern. Prefix and suffix tests additionally require the corresponding
original-text endpoint. Matches cannot begin or end inside a codepoint's folded
expansion. This follows ICU's full-fold literal regex matching precedent.

```hexagon
"Straße".containsCi("STRASSE")  // True
"ß".containsCi("ss")           // True
"ss".containsCi("ß")           // True
"ß".containsCi("s")            // False
"ß".startsWithCi("s")          // False
"ß".endsWithCi("s")            // False
```

Consequently, blindly folding both complete inputs and invoking ordinary
substring search is not a correct implementation. Locale-specific matching is
outside this agreed family. `Regex`'s `i` flag uses *simple* case folding, not
this family's full folding, and `regex.md` §3.4 records that one divergence.

**Naming decision:** Initialisms are ordinary words regardless of length, so
the suffix is `Ci`, as in `containsCi`, consistently with `JsMap` and
`IoStream`. Functions §2 owns the general convention.

## 6. Replacement

```text
String.replace(text: String, target: String, replacement: String): String
String.replaceFirst(text: String, target: String, replacement: String): String
String.replaceCi(text: String, target: String, replacement: String): String
String.replaceFirstCi(text: String, target: String, replacement: String): String
```

`replace` and `replaceCi` replace all non-overlapping matches, scanning from the
beginning. The `First` variants replace only the first match. Matching uses
section 5's exact or case-insensitive rule. Unmatched text preserves its original spelling;
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
"ß".replaceCi("", "-")      // "-ß-"
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

The following laws hold for finite sequences and all Strings, including empty
patterns and delimiters:

```hexagon
String.join(parts, "") == String.fromSeq(parts)
String.join(text.split(delimiter).toSeq(), delimiter) == text
String.join(text.split(target).toSeq(), replacement)
    == text.replace(target, replacement)
String.join(text.splitCi(target).toSeq(), replacement)
    == text.replaceCi(target, replacement)
```

Rejoining `splitCi` with its delimiter need not reconstruct the original text:
matched delimiter spans may have different spelling, case, or codepoint length.

## 8. Search positions

```text
String.indexOf(text: String, target: String): Option(Int)
String.indexOfCi(text: String, target: String): Option(Int)
String.lastIndexOf(text: String, target: String): Option(Int)
String.lastIndexOfCi(text: String, target: String): Option(Int)
```

Return the least or greatest starting position of a valid match in the original
text, respectively. Positions count codepoints from 1; absence is `None`.
Overlapping candidates participate: `"aaa".lastIndexOf("aa") == Some(2)`.
Case-insensitive positions use section 5's matching rule and never index the folded text.

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
A one-item String containing a lone surrogate also fails. This is scalar
conversion, not grapheme counting.

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

Illustration using this String API; the Node module itself is not landed:

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

## 11. Integration and implementation requirements

All public operations in this document are exports of `stdlib/String.hex`.
There is no public `Unicode`, `Text`, character, or helper module. Private
intrinsic doors and compiler-generated Unicode tables may provide only the
primitive capabilities that ordinary Hexagon cannot express; scanning,
matching policy, original-span selection, empty-pattern rules, result
construction, and the public operation bodies remain in `String.hex` wherever
the intrinsic doctrine permits.

The companion is ordered after the prelude modules whose public operations its
ordinary source uses, including `Iterable` and `Vector`. This is a dependency
order, not a new public import or a cyclic exception.

Operations perform at least the traversal their result requires. Codepoint
scans are linear in the traversed input. Output-producing operations also count
the produced output, including expanded case mappings and folds. `join` counts
sequence traversal even when every element and separator is empty. Search
algorithms state their implemented bound; no blanket constant-time String
indexing or host-delegation claim exists.

The owning primitive, collection, FFI, intrinsic, module, and standard-library
specifications cross-reference this document rather than restating its API.
Public `String.hex` documentation carries the library reference. The book is a
language manual: it explains the String model where useful but does not list
this companion surface.

Case-insensitive key wrappers remain separate. A future wrapper may reuse
`String.caseFold`, but its name, stored representation, construction surface,
and provided `Eq`/`Hash` pair are not part of this document. BOM consumption is
likewise a text-decoding or file-I/O boundary concern; ordinary String
processing preserves U+FEFF as section 10 requires.

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
- [Kotlin naming](https://kotlinlang.org/docs/coding-conventions.html#choose-good-names):
  initialisms treated as ordinary words.
- [F#/.NET text reading](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.readalltext):
  consuming an initial BOM at the decoding boundary.
