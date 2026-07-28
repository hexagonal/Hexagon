# Hexagon for VS Code

Syntax highlighting for `.hex` files, as a TextMate grammar.

The grammar lives in [`syntaxes/hexagon.tmLanguage.json`](syntaxes/hexagon.tmLanguage.json)
and is the whole extension — there is no runtime code. A language server is a
separate, later concern (`language-server/`).

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
| Non-uppercase-start name | `variable.other` | §3.1 |
| Name being declared | `entity.name.function` / `variable.other.definition` | — |
| Name before `:` | `variable.parameter` | — |
| Bare `_` | `variable.language.wildcard` | §3.2 |
| Hard keywords | `keyword.control` / `storage.type` / `keyword.operator.word` | §4.1 |
| Contextual keywords, in position only | `keyword.other.*` | §4.2 |
| Integer / Float / BigInt | `constant.numeric.*` | §5 |
| String, escapes, interpolation hole | `string.quoted.double`, `constant.character.escape`, `meta.embedded` | §6 |
| Line, block, and doc comments | `comment.*` | Comments §1 |
| Operators and punctuation | `keyword.operator.*` / `punctuation.*` | §8.1 |
| Everything §10 rejects | `invalid.illegal.*` | §10 |

Three decisions worth stating, because each one is a place where an obvious
alternative would be wrong:

**One scope for every uppercase-start name.** Type, union case, constraint,
implied type, exception, and module alias all share the uppercase start class,
and §3.1 makes that classification happen *before* parsing or resolution — the
distinction between them is not available to a lexer, so this grammar does not
invent one. The single exception is the qualifier position: a term is never
uppercase-start, so an uppercase name immediately before `.` can only be a module
alias or a companion, and it gets `entity.name.namespace`.

**Contextual keywords are matched by position, not spelling.** §4.2's whole point
is that `let when = true` is legal and `{with = 3}` is a field. Each contextual
rule pins the position the spec lists for it — `from` only before a specifier
string, `when` only before an arm's `=>`, `opaque` only before `record`/`union`,
and the FFI vocabulary (`get`, `set`, `new`, `method`, `static`, `default`,
`class`, `enum`) only inside an `extern from` block, where the block is delimited
by the next line that starts in column zero.

**Lexical errors are painted.** §10 has no warning tier: every row is either
accepted source or a hard error. `__hex_` names, `0xFF`, `.5`, `1.`, `1__0`,
`12cats`, unknown string escapes, a bare `#{`, an unmatched `*/`, and `&&`/`||`/`!`
all get `invalid.illegal.*`, so the editor shows them before the compiler does.

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
- **Type variables are not distinguished from terms.** In `Seq(a)`, the `a` is a
  type variable, but it is spelled exactly like a term and only the parser knows
  the difference.
- **`<` and `>` are comparison tokens.** §8.1 makes them the same physical token
  in a comparison and in an angle-bracket binder, and the grammar keeps them that
  way. A generic call like `isEmpty<a>(v)` is still recognized as a call, because
  a following `(` disambiguates it; a bare `Ord<Rat>` head shows `<`/`>` as
  operators.
