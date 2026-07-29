# Hexagon for VS Code

Syntax highlighting for `.hex` files, as a TextMate grammar.

The grammar lives in [`syntaxes/hexagon.tmLanguage.json`](syntaxes/hexagon.tmLanguage.json)
and is the whole extension — there is no runtime code. A language server is a
separate, later concern (`language-server/`).

**Playground reads this same file** (`playground/src/monaco-textmate.ts`), so it is
not the extension's private grammar: it is the one Hexagon grammar, and a rule
changed here changes both editors. Playground used to carry a second, hand-written
Monarch tokenizer, which drifted (#145) until #161 deleted it. The one construct
Playground does not share is its own `module` / `end module` notation, which is not
`.hex` syntax and lives in a Playground-side injection rather than here.

## Installing it locally

VS Code loads any extension folder it finds in `~/.vscode/extensions`, so a
symlink is enough:

```sh
ln -s "$PWD" ~/.vscode/extensions/hexagon-vscode
```

Then reload the window (**Developer: Reload Window**) and open any `.hex` file.
The repository's `.vscode/settings.json` already maps `*.hex` to the `hexagon`
language id this extension contributes.

To see which scope a token actually gets, run **Developer: Inspect Editor Tokens
and Scopes** with the cursor on it.

## What it colors, and why

The grammar follows `spec/lexer.md`, which fixes a **closed** token language: a
later feature may add a token only by updating that inventory. So the rules here
mirror the spec's sections rather than pattern-matching on what code tends to
look like.

| Construct | Scope | Source |
| :--- | :--- | :--- |
| Uppercase-start name | `entity.name.type` | §3.1 |
| Uppercase-start name before `.` | `entity.name.namespace` | Modules §3.3, §5.3 |
| Uppercase-start name in a constraint position | `entity.name.type.constraint` | Constraints §3, §4.1, §4.3; Declarations Preamble §2.3 |
| Non-uppercase-start name in type position | `entity.name.type.parameter` | Functions §4.2.1 |
| Non-uppercase-start term name | `variable.other` | §3.1 |
| Name being declared | `entity.name.function` / `variable.other.definition` | — |
| Name before `:` | `variable.parameter` | — |
| Bare `_` | `variable.language.wildcard` | §3.2 |
| Hard keywords | `keyword.control` / `storage.type` / `keyword.operator.word` | §4.1 |
| Contextual keywords, in position only | `keyword.other.*` | §4.2 |
| Integer / Float / BigInt | `constant.numeric.*` | §5 |
| String, escapes, interpolation hole | `string.quoted.double`, `constant.character.escape`, `meta.embedded` | §6 |
| Line, block, and doc comments | `comment.*` | Comments §1 |
| Operators and punctuation | `keyword.operator.*` / `punctuation.*` | §8.1 |
| Everything §10 requires a diagnostic for | `invalid.illegal.*` | §10 |

Four decisions worth stating, because each one is a place where an obvious
alternative would be wrong:

**One scope for every uppercase-start name, by default.** Type, union case,
implied type, exception, and module alias all share the uppercase start class,
and §3.1 makes that classification happen *before* parsing or resolution — the
distinction between them is not available to a lexer, so this grammar does not
invent one. Two positions are exceptions, and both earn it the same way: by being
syntactically closed rather than by guessing at a name's meaning. A term is never
uppercase-start, so an uppercase name immediately before `.` can only be a module
alias or a companion (`entity.name.namespace`); and a constraint can only appear
in the four positions below (`entity.name.type.constraint`).

**Constraints are distinguished, because their positions are closed.** A constraint
name can appear only as a `constraint` or `honor` head (Constraints §4.1), in a
parameterized instance head's prefix form (§4.3), inside a binder's bound (§3), or
in a `derives` list (Declarations Preamble §2.3). That list is exhaustive, which is
what makes the distinction safe: `Show` takes `entity.name.type.constraint` in every
position it can legally occupy, so a name never changes scope depending on where it
is written. The instance *subject* is not a constraint — `honor Show<Rat>` scopes
`Show` as a constraint and `Rat` as an ordinary type, which is exactly the
declaration/use duality §4.1 describes. The `derives` rules accept the clause at the
start of a continuation line as well as after a header name, because Declarations
Preamble §2.4 spells that shape out.

**Type variables are recognized by type position plus casing.** A lowercase name
is not intrinsically a type variable — `a` remains an ordinary term in `let x = a`.
But inside a declaration parameter list, a disambiguated `<...>` list, a type
alias, or an annotation after `:`, the language says a non-uppercase-start name
can only be a type variable. Those names get `entity.name.type.parameter`, including
nested uses such as `Result(a, Vector(b))`.

**Contextual keywords are matched by position, not spelling.** §4.2's whole point
is that `let when = True` is legal and `{with = 3}` is a field. Each contextual
rule pins the position the spec lists for it — `from` only before a specifier
string, `when` only before an arm's `=>`, `opaque` only before `record`/`union`,
and the FFI vocabulary (`get`, `set`, `new`, `method`, `static`, `default`,
`class`, `enum`) only inside an `extern from` block, where the block is delimited
by the next line that starts in column zero.

**Lexical errors are painted.** §10 has no warning tier: every row is either
accepted source or a hard error. `__hex_` names, `0xFF`, `.5`, `1.`, `1__0`,
`12cats`, unknown string escapes, a bare `#{`, an unmatched `*/`, and `&&`/`||`/`!`
all get `invalid.illegal.*`, so the editor shows them before the compiler does.

`true` and `false` in **value position** are on that list (#147). `Bool` is the
prelude union `False | True`, so the two words are reserved spellings with no value
meaning, and the compiler answers them with a one-token redirect. In name position —
`let true = 1` — the binding rule claims the name first and paints it as a binder;
that is a general shadowing hole in `#declarations`, which sits ahead of `#keywords`
and swallows every hard keyword there, and it is filed on its own. Their
replacements need no rule:
`True` and `False` are ordinary uppercase-start names and take `entity.name.type`
along with every other constructor, `None` included.

## Tests

```sh
npm install && npm test
```

`src/grammar.test.ts` runs the checked-in grammar through the same engine VS Code
uses — `vscode-textmate` over the Oniguruma WASM build — so the assertions cover
what the editor would really paint. The cases come from `spec/lexer.md` §11's
acceptance and rejection inventories, plus two invariants over every `.hex` file
in the repository: no token may be painted `invalid.*`, and no token may come out
unscoped.

`src/language-configuration.test.ts` covers `language-configuration.json`, which
never goes through the grammar and so is invisible to every test above. It exists
because a `wordPattern` can be silently wrong in a way the editor never reports:
VS Code compiles a bare-string `wordPattern` with no flags, and without `u` each
`\p{...}` quietly degrades into an identity escape — double-clicking `map` would
select `ap`, and `xs` would select nothing at all. The pattern is therefore written
in the object form that carries `"flags": "u"`, and the test asserts both the form
and the selections.

## Known limits

Each of these is a place where TextMate cannot express something the real lexer
knows. They are listed rather than hidden, because the grammar is otherwise meant
to be exact.

- **`extern from` blocks end at column zero.** TextMate has no indentation stack,
  so the block's extent is approximated by "until the next line starting in column
  one." That is exact for every `extern from` in the corpus, which is always
  top-level. One legal shape does defeat it: `spec/comments.md` §4 permits a
  comment-only line at *any* column, "including column 0 inside a deeply indented
  block", and such a comment ends the block early, after which `get`/`set`/`method`
  revert to ordinary names.
- **`when` is recognized by neighbours, not by bracket depth.** A guard is matched
  when a complete pattern precedes it — a name, `)`, `]`, or `}` — and an `=>`
  follows later on the line. That is what keeps `Event(when, what) => …`,
  `(when) => …`, `f(when, g)`, and `fun schedule(when: Instant)` reading as the
  binders they are, since `when` is a plausible field name. TextMate cannot see
  bracket depth, so a guard is deliberately under-claimed rather than over-claimed.
- **A record update wrapped after `with` is not recognized.** In
  `{settings with\n    port = 8080}` the lookahead cannot cross the newline, so
  `with` reads as an ordinary name. Keeping it on one line highlights correctly.
- **A type alias is coloured only on its own line.** The header must reach `=` on
  the same physical line, which keeps a foreign declaration such as
  `extern type SearchParams` from opening a type-alias context, and the right-hand
  side ends at end of line. Running the context further would be worse than useless:
  Collections Part 2 §5.1 puts an implied `type Item = a` inside a `constraint` body
  or `honor` block, so a context that reached the next top-level declaration would
  swallow the rest of the block and paint its member names as type variables. A
  wrapped alias right-hand side loses colour past the break.
- **`<` and `>` are comparison tokens.** §8.1 makes them the same physical token
  in a comparison and in an angle-bracket binder, and the grammar keeps them that
  way. A generic call like `isEmpty<a>(v)` is still recognized as a call, because
  a following `(` disambiguates it; a bare `Ord<Rat>` head shows `<`/`>` as
  operators.
- **A binder list is told from a comparison heuristically, and the heuristic is not
  complete.** Entering the binder context needs `<` followed immediately by an
  identifier character, and a closing `>` that is not `>=` and is followed by `(`,
  `=`, or an uppercase name. That admits `<a>`, `honor<a: Show>`, and `isEmpty<a>(v)`
  while rejecting the spaced `count < limit and total > (x + y)` and the `>=` of
  `a<b and c >= d`. It does **not** reject every comparison: `let z = a<b and c > (d)`
  and `size(a)<size(b) and count(c) > (d)` still read as binder lists, painting the
  span between the operators as types and costing `and` its keyword scope. §8.1 makes
  `<` and `>` the same physical token in both roles, so no regex distinguishes them in
  general; spacing the left operand is the fix. This is the same class of exposure the
  generic-call rule has always had.
