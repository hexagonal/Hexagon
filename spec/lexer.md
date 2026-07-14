# Hexagon Spec: Physical Lexer

**Status:** Decided (July 2026)
**Scope:** Source text, line endings and horizontal whitespace; identifiers and
case classification; the complete hard and contextual keyword inventory; numeric
and string literal lexing; the complete punctuation and operator inventory;
comments as trivia; physical token shapes; maximal munch; lexical diagnostics.
**Not in scope:** Indentation-stack behaviour and virtual tokens (Lexer & Layout);
operator precedence (Operators, Logic & Precedence); parsing; doc-comment
attachment; source-file discovery and filesystem I/O.
**Companions:** Lexer & Layout, Comments, Primitive Types, Numeric Literals,
Operators/Logic/Precedence, Pattern Matching, Modules, and Foreign Enums.

This document closes the full-lexer debt recorded in the specification roadmap.
It consolidates spellings already fixed elsewhere and decides the remaining lexical
minutiae. A later language feature may add a token only by updating this inventory.

---

## 1. Doctrine

- **The lexer recognizes a closed language.** Hexagon has no user-defined
  operators. Punctuation not listed here is an error, not an operator waiting for
  the parser to interpret it.
- **Text stays text.** Every physical token has an exact half-open source span in
  UTF-16 code units. Literal payloads are decoded alongside, never instead of,
  their original spelling.
- **Case is syntax.** A name's first codepoint classifies it as a lowercase name
  or an uppercase name before parsing or resolution. This preserves the language's
  binder-versus-constructor distinction without consulting a symbol table.
- **Keywords are split deliberately.** A small hard set is always reserved.
  Position-specific vocabulary remains an identifier token and becomes meaningful
  only in its grammatical context.
- **Malformed constructs consume and diagnose.** The lexer always advances to a
  recovery boundary. It never emits a plausible valid token for a malformed literal
  and leaves the misleading remainder to the parser.

## 2. Source characters, positions, and whitespace

### 2.1 Source character repertoire

Hexagon source is Unicode. A host reading `.hex` bytes decodes UTF-8 strictly; an
ill-formed byte sequence is a source-loading error. A programmatic host that already
supplies a JavaScript string must reject unpaired UTF-16 surrogates as invalid source
characters. Unicode scalar values are therefore the common model at every host.

One U+FEFF byte-order mark is permitted and ignored only at offset zero. U+FEFF
anywhere else is an invalid source character. Hexagon has no shebang form.

Offsets and columns are zero-based UTF-16 code-unit counts. Lines are zero-based.
This is the coordinate system already required by layout and by the language-server
boundary; an astral codepoint advances the column by two.

The lexer accepts LF, CRLF, and lone CR as physical line endings. Each is one line
boundary; CRLF is one boundary with a two-code-unit span. Outside a string, all three
produce the same physical-newline fact. Inside a multiline string, each produces one
semantic `\n`, making a checkout's line-ending convention unable to change a value.

### 2.2 Horizontal whitespace and tabs

U+0020 SPACE and U+0009 TAB are the only horizontal whitespace characters.

- A tab anywhere from the start of a line through its first non-whitespace
  character is a hard error. Indentation is spaces only, as fixed by Decisions
  Batch 2026-07 §4.
- A tab after a non-whitespace source token is legal horizontal whitespace. The
  formatter should replace it with spaces. A tab inside a string or comment is
  content, not horizontal whitespace.
- Form feed, vertical tab, non-breaking space, Unicode pattern whitespace, and
  every other spacing character outside a string or comment are invalid. There is
  no invisible second spelling of an ordinary space.

Blank lines and comment-only lines produce no code token. Their physical line
boundaries remain visible through token positions and newline facts so the layout
pass can ignore them deliberately rather than losing their existence.

## 3. Identifiers

### 3.1 Character grammar

Identifier characters follow [Unicode Standard Annex #31](https://www.unicode.org/reports/tr31/)'s
`XID_Start` and `XID_Continue` properties from
[Unicode 17.0.0](https://www.unicode.org/versions/Unicode17.0.0/), with the case
restriction below.
The compiler ships the relevant tables; it must not inherit whatever Unicode version
happens to be installed on the host.

```text
LowerName = LowercaseStart XID_Continue*
UpperName = UppercaseStart XID_Continue*

LowercaseStart = XID_Start and Unicode Lowercase = Yes
UppercaseStart = XID_Start and (Unicode Uppercase = Yes or General_Category = Lt)
```

The spelling must be in Unicode NFC. A non-NFC identifier is an error with a fix-it
to its NFC spelling; the compiler does not silently change source text. Identifier
comparison is then exact codepoint comparison.

This is a deliberate profile of UAX #31 rather than unrestricted `XID_Start`.
Hexagon's case rule is load-bearing: an uncased initial such as a Han ideograph cannot
be classified as a binder or a type/constructor. Such a codepoint is legal after a
cased initial (`user東京`) but not as the first codepoint. The diagnostic says that
Hexagon names must begin with a lowercase or uppercase cased letter.

ASCII examples remain the ordinary forms:

```text
name       item2      parse_json     -- LowerName
Point      HTTP2      Résultat       -- UpperName
δelta      Δelta                     -- lower and upper Unicode initials
```

### 3.2 Deliberate exclusions

- `_` is its own wildcard token. It is not a name. `_name` is invalid because a
  name must begin with a cased letter; underscore remains legal after the initial.
- `$` is not an identifier character. Dollar-initial generated names belong to the
  emitter and can never collide with Hexagon source.
- Identifier escapes do not exist. `\u{...}` is a string escape only; a backslash
  in a name is an error.
- Apostrophes are not identifier characters. ML-style `a'` names do not exist.
- No case folding occurs. `point`, `Point`, and `POINT` are three spellings, though
  only the first is a lowercase name.

### 3.3 Unicode evolution

Unicode 17.0.0 fixes v1's tables. A future Hexagon release may adopt a later Unicode
version through a recorded compatibility update. UAX #31 guarantees identifier-set
growth, but the compiler release—not the runtime host—selects the version so unchanged
compiler bits remain deterministic.

## 4. Keyword inventory

### 4.1 Hard keywords

Hard keywords receive dedicated token kinds and may never be used as names:

```text
and         catch       constraint  derive      else       exception
export      extern      false       finally     for        fun
honor       iff         if          implies     import      in
let         match       not         or          record      then
true        try         type        union       var         while
```

The groups are:

- declarations and modules: `constraint`, `exception`, `export`, `extern`, `fun`,
  `honor`, `import`, `let`, `record`, `type`, `union`, `var`;
- expression and control forms: `catch`, `else`, `for`, `if`, `in`, `match`,
  `then`, `try`, `while`;
- word operators: `and`, `iff`, `implies`, `not`, `or`;
- literal words: `false`, `true`;
- derivation: `derive`, legal only as the complete body of an `honor` declaration;
- reserved future control word: `finally`. It is tokenized now but has no v1
  grammar, so its use receives the targeted deferred-feature diagnostic.

`honor` is the current instance-declaration keyword. The superseded `implement` is
not reserved; in a declaration-shaped position it should receive a migration hint to
write `honor`.

### 4.2 Contextual keywords

The following spellings lex as `LowerName`. The parser recognizes them only in the
listed positions:

| Spelling | Context |
|---|---|
| `as` | import/foreign aliases and the pattern `p as name` |
| `derives` | a `record`, `union`, or foreign-enum header before `=` |
| `from` | an `import` clause or `extern from` declaration |
| `opaque` | immediately after `export` on `record` or `union` |
| `when` | between an arm pattern and `=>` |
| `enum` | a foreign enum declaration inside `extern from` |
| `class` | foreign class description; syntax completed by the FFI spec |
| `method` | foreign member description; syntax completed by the FFI spec |
| `get` | foreign getter description; syntax completed by the FFI spec |
| `set` | foreign setter description; syntax completed by the FFI spec |
| `new` | foreign class constructor description; syntax completed by the FFI spec |
| `static` | foreign static-member modifier; syntax completed by the FFI spec |
| `default` | foreign default-import position; syntax completed by the FFI spec |

Contextual status is observable: `let when = true` is legal, while the same spelling
after an arm pattern introduces its guard. A parser must test both spelling and
position; the lexer does not emit contextual-keyword token kinds.

### 4.3 Words that are not keywords

`throw`, `ignore`, `range`, `rangeDown`, `show`, `module`, `main`, `async`, `await`,
`break`, `continue`, and `yield` are ordinary lowercase names. Some are prelude
functions, some name rejected or deferred forms, and some have no meaning at all.
Library membership never turns a name into a keyword.

`module Geometry`, `export default` outside `extern`, `break`, and similar near misses
may receive targeted parser diagnostics without acquiring lexical privilege.

## 5. Numeric literals

Let `Digits` mean an ASCII decimal digit followed by zero or more groups consisting
of an optional underscore and another ASCII decimal digit:

```text
Digits   = [0-9] ("_"? [0-9])*
Exponent = ("e" | "E") ("+" | "-")? Digits

Integer  = Digits
BigInt   = Digits "n"
Float    = Digits "." Digits Exponent?
         | Digits Exponent
```

Consequences:

- Decimal is the only base in v1. `0x`, `0o`, and `0b` forms are errors.
- A decimal point belongs to a Float only when a digit follows it, and then requires
  digits on both sides. Write `1.0`, not a standalone `1.`, and `0.5`, not `.5`.
  The postfix form `1.show()` remains an Integer followed by `.` and a name.
- `_` must have an ASCII digit on both sides. It cannot touch `.`, `e`/`E`, a sign,
  or the `n` suffix. Group size is not regulated.
- `n` is lowercase and belongs only to `BigInt`. `1N` is invalid.
- A leading sign is never part of the physical token. `-3` is `-` followed by an
  integer token; the parser forms a negative literal pattern in pattern position.
- Leading zeroes are legal and decimal: `00`, `01`, and `00.5` have no octal meaning.
- `1..2` is an integer, `..`, and an integer. It is never a malformed float.

An integer token stores its separator-free decimal spelling. A bare integer must be
at most `2^53 - 1`, as fixed by Numeric Literals; a larger token is diagnosed with an
`n`-suffix fix-it. A BigInt payload is arbitrary precision and remains a decimal
string until a later phase deliberately chooses another representation.

A Float token stores both its source spelling and the correctly-rounded IEEE-754
binary64 value. Conversion overflow is a lexical error directing the user to
`Float.infinity`; underflow and ordinary rounding are the defined binary64 result.

When digits are immediately followed by identifier characters in a form that cannot
be a literal (`12cats`, `1nmore`, `1efoo`), the lexer diagnoses one malformed numeric
literal and consumes through that identifier run. It does not manufacture two valid
tokens that suggest whitespace would make the original meaningful.

## 6. String literals and interpolation

### 6.1 One composite token

A string begins and ends with `"`. It may contain physical newlines and interpolation.
The physical lexer exposes one composite `String` token whose payload alternates:

```text
Text(decodedText, sourceSpan)
Interpolation(tokens, sourceSpan)
```

`${` opens an interpolation. The matching `}` closes it, with ordinary delimiter
nesting inside. The interpolation body is lexed recursively using the normal token
inventory and may contain nested strings and comments. Its newlines are ordinary
expression whitespace but are marked layout-suppressed: to the layout pass, the
whole composite string is one physical token. This preserves Primitive Types §5.2's
rule that interpolation holes do not participate in indentation layout.

An empty interpolation is retained for the parser to diagnose as a missing
expression. EOF before the closing `}` reports the interpolation opener; EOF before
the string's closing quote reports the string opener. Recovery never searches past
the containing string for a quote or brace.

### 6.2 Text and escapes

Raw text contributes its Unicode scalar values. Physical LF, CRLF, and CR each
contribute `\n` as specified in §2.1. The complete escape inventory is:

| Escape | Value |
|---|---|
| `\n` | line feed |
| `\t` | tab |
| `\r` | carriage return |
| `\\` | backslash |
| `\"` | double quote |
| `\$` | dollar sign; in particular, `\${` suppresses interpolation |
| `\#` | hash sign; in particular, `\#{` writes the reserved sequence literally |
| `\u{H...}` | one Unicode scalar value, one to six hexadecimal digits |

No legacy JavaScript escapes (`\xNN`, fixed-width `\uNNNN`, octal, `\b`, `\f`,
`\v`, `\0`) exist. An unknown escape is an error at the backslash. A Unicode escape
must be at most U+10FFFF and must not name a surrogate.

A bare `$` is text unless immediately followed by `{`. A bare `#{` is a hard error
reserved for future `Debug` interpolation, with the required `\#{` fix-it. A `#` not
followed by `{` is ordinary string text.

## 7. Comments and trivia

The Comments spec is authoritative; this section fixes token interaction.

- `//` begins a line comment and spends that spelling permanently.
- `/*` begins a nesting block comment; `*/` at depth zero is one unmatched-comment
  error, not `*` followed by `/`.
- Comments and horizontal whitespace are trivia, not parser tokens. An implementation
  may retain their spans and text for formatting or readable emission, but doing so
  cannot affect the token sequence.
- Newlines encountered inside comments still update physical positions. Code before
  and after a multiline block comment therefore retains its real line relationship.
- Strings are not recognized inside comments and comments are not recognized in
  string text. Normal comment lexing resumes inside `${...}`.

## 8. Punctuation and operator tokens

### 8.1 Complete source-spellable inventory

| Category | Tokens |
|---|---|
| Delimiters | `(` `)` `[` `]` `{` `}` |
| Separators and labels | `,` `:` `;` |
| Access and spread | `.` `...` |
| Declaration/arm punctuation | `=` `=>` |
| Arithmetic and concatenation | `+` `-` `*` `/` `**` `++` |
| Comparison | `==` `!=` `<` `>` `<=` `>=` |
| Range | `..` |
| Pipe | `\|>` |
| Assignment | `:=` |
| Union/or-pattern bar | `\|` |
| Wildcard | `_` |

`<` and `>` are the same physical tokens in comparisons and angle-bracket type
binders; the parser owns the contextual distinction. Braces always delimit records,
never blocks. Semicolon is a real separator token, never a terminator.

### 8.2 Maximal munch

At a position where several listed tokens share a prefix, the lexer chooses the
longest valid token. Important cases:

```text
...  before  ..  before  .
**   before  *
+++  means ++ then +
|>   before  |
<= >= == != := =>  before their one-character prefixes
// /* */ are handled before / and *
```

Maximal munch does not combine adjacent valid tokens into an unlisted one. `--` is
two minus tokens, making `x --1` parse as `x - (-1)` rather than a comment. `->` is
`-` then `>`; source type arrows do not exist, and the parser can give the targeted
annotation diagnostic.

The lexer special-cases well-known forbidden symbolic logic runs so the user gets one
useful error: bare `!`, `&&`, and `||` point to `not`, `and`, and `or`. `||` must not
be accepted as two pattern bars.

### 8.3 Not tokens

The following are deliberately absent: `%`, `^`, `&`, bare `!`, `?`, `@`, `#`,
backtick, backslash outside a string, `&&`, `||`, `->`, `::`, `??`, `?.`, `..<`,
compound assignments, increment/decrement, and every user-invented punctuation run.

Where every character of a run is independently valid (`+=`, `->`, `--`), the lexer
may emit those valid component tokens and let the parser issue the form-specific
diagnostic. A character with no token begins one invalid-character diagnostic and is
then consumed. Repeated characters belonging to one familiar forbidden spelling
should be consumed together when that produces the targeted diagnostic above.

## 9. Physical token stream

The physical lexer returns a `Lexed.File` containing:

- the source file identity;
- code tokens with exact half-open spans;
- physical newline facts outside composite strings, including the actual line-ending
  span and the next code token's real column;
- an explicit EOF token at the source length; and
- diagnostics accumulated without throwing away later tokens.

The code-token kinds are exactly:

1. `LowerName`, `UpperName`, and the hard-keyword kinds from §4.1;
2. `Integer`, `BigInt`, `Float`, and composite `String`;
3. every punctuation/operator/wildcard kind from §8.1; and
4. `Eof`.

Whitespace and comments are trivia, not code-token kinds. Contextual words are
`LowerName`. `VOPEN`, `VSEP`, and `VCLOSE` do not occur in `Lexed.File`; the layout
pass alone creates them in `LaidOut.File`. The parser must never consume this physical
stream directly.

Every successful token has a non-empty span except EOF. Every lexer loop either
advances its UTF-16 offset or finishes. A malformed token may be represented in an
implementation-private recovery form, but it is never part of the public successful
token inventory and the lexer must not report the same source code unit twice.

## 10. Required lexical diagnostics

| Situation | Message shape / recovery |
|---|---|
| Tab in leading whitespace | "indentation uses spaces; tabs are not allowed here"; replace with spaces |
| Unsupported whitespace | name the codepoint; replace with U+0020 when appropriate |
| Unpaired surrogate / invalid UTF-8 | "Hexagon source must be valid Unicode" |
| BOM away from offset zero | "a byte-order mark is only allowed at the start of a file" |
| Uncased or invalid name initial | "Hexagon names must begin with a lowercase or uppercase cased letter" |
| Non-NFC name | "identifier is not in Unicode NFC" + normalized fix-it |
| `_name` | "`_` is the wildcard; names begin with a lowercase or uppercase letter" |
| Hard keyword in name position | "`WORD` is reserved and cannot be used as a name" |
| Malformed `_` in a number | "`_` in a number must have a digit on both sides" |
| `.5` / `1.` | suggest `0.5` / `1.0` |
| Non-decimal base prefix | "Hexagon v1 has decimal literals only" |
| Bare integer over safe range | Numeric Literals message + `n` fix-it |
| Float overflow | "Float literal is too large; use `Float.infinity`" |
| Invalid literal suffix | consume the joined run and name the invalid suffix |
| Unknown string escape | list or point to the supported escapes |
| Invalid `\u{...}` | require 1–6 hex digits naming a Unicode scalar value |
| Bare `#{` in a string | required future-reservation message + `\#{` fix-it |
| Unterminated string/interpolation | point at the opener; recover at EOF |
| Unterminated/unmatched block comment | Comments §5 messages verbatim |
| Bare `!`, `&&`, `||` | suggest `not`, `and`, `or` respectively |
| Any other invalid character | name the character and codepoint; consume it once |

There is no warning tier. Every row is either accepted source or a hard error.

## 11. Acceptance inventory

```hexagon
let café2 = 1_000                 // NFC Unicode LowerName + Integer
record Résultat(a) = {value: a}   // Unicode UpperName
let greeting = "Hello ${name}."   // one composite String token
let lines = "first\r\nsecond"      // escapes retain explicit CRLF
let multi = "first
second"                           // physical newline contributes one \n
let n = 1..10                     // Integer, Range, Integer
let subtract = x --1              // x - (-1); never a comment
match value
  Some(x) | None as whole when ready => whole
```

Rejected lexically:

```text
let _name = 1       -- `_` cannot begin a name
let 東京 = 1         -- uncased initial cannot satisfy the case rule
let x = .5          -- write 0.5
let x = 1.          -- write 1.0
let x = 0xFF        -- decimal only
let x = 1__0        -- digit required on both sides of `_`
let x = "\q"        -- unknown escape
let x = "#{value}"  -- reserved; write "\#{value}" for text
a && b              -- write `a and b`
```

## 12. Decisions log

| Decision | Where |
|---|---|
| Strict Unicode source; optional initial BOM; LF/CRLF/CR; UTF-16 positions | §2.1 |
| Only space/tab horizontal whitespace; leading tabs error, interior tabs legal | §2.2 |
| Unicode 17 XID identifiers, NFC-required, cased initial classifies name | §3 |
| `_`, `$`, apostrophe, and identifier escapes excluded | §3.2 |
| Complete hard/contextual/not-keyword tables; `finally` reserved | §4 |
| Decimal numeric grammar, required digits around `.`, exact suffix rules | §5 |
| Composite string token; interpolation recursively lexed but layout-suppressed | §6.1 |
| Complete escape set; source newlines normalize to semantic LF | §6.2 |
| Comments are trivia; nested forms and diagnostics inherited unchanged | §7 |
| Closed punctuation/operator inventory and maximal-munch rules | §8 |
| Exact physical token families; virtual layout tokens excluded | §9 |
| No warning tier; malformed tokens advance and recover | §10 |
