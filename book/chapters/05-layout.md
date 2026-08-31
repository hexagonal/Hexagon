# Layout

The opening chapters have already relied on indentation:

```hexagon
let shippingLabel(international: Bool, region: String): String =
    if international then
        let label = "International: ${region}"
        label
    else
        "Domestic"
```

The shape is not decorative. Indentation tells Hexagon which expressions and bindings
belong to each block. There are no written block delimiters hiding underneath it and no
alternative brace style.

## Indentation is the block syntax

When a construct expects a body on the following line, its first indented line sets the
block's indentation. Lines that begin at the same indentation belong to the same block:

```hexagon
let prepare(order: Order): Order =
    log("Preparing order")
    let checkedOrder = check(order)
    checkedOrder
```

All three body items begin in the same column. The call to `log`, the `let` binding,
and the final expression therefore belong to one block. As established earlier, the
final expression supplies the block's value — the law of *expression* blocks. A
member block, like chapter 3's `fun` block or the top level of a source file,
groups declarations under the same indentation rules and has no value to supply.

Indenting farther opens a nested block. Returning to an earlier column closes it:

```hexagon
let describeDelay(delayed: Bool): String =
    if delayed then
        log("Order delayed")
        "Delayed"
    else
        "On time"
```

`log` and `"Delayed"` belong to the first branch. The dedented `else` closes that
branch and begins the alternative.

Use four spaces for each level of leading indentation. A tab before the first token of
a line is an error; there is no project-specific tab width that might make the same
source appear to have different blocks in different editors. The compiler accepts any
consistent deeper indentation, but Hexagon code conventionally uses four spaces.

## A same-line body is one expression

Short definitions may keep their body on the same line:

```hexagon
let double(n: Int): Int = n * 2
let ready(status: String): Bool = status == "ready"
```

That body is one expression. Move to the following line and indent when the body needs
several items:

```hexagon
let clean(dishes: Dishes): Dishes =
    let cleanDishes = dishes |> rinse |> wash |> dry
    cleanDishes
```

This is the same block model, not a second function syntax.

## Braces always mean records

A JavaScript developer may instinctively write:

```hexagon
let greet(name) = { log("Hello ${name}") }
```

That is not a block. In Hexagon, `{` always begins a record. The compiler can therefore
give one direct correction:

```hexagon
let greet(name) =
    log("Hello ${name}")
```

There is no context where braces switch back to block delimiters. Later, when records
arrive, `{}` will mean the empty record.

## Semicolons put same-level items on one line

An explicit semicolon means the same thing as a newline at the current block
indentation:

```hexagon
let sum(): Int =
    let x = 1; let y = 2
    x + y
```

This contains the same items at the same block level as:

```hexagon
let sum(): Int =
    let x = 1
    let y = 2
    x + y
```

The semicolon is a **separator**, not a JavaScript-style terminator. Do not put one at
the end of a line, at the start of a block, or beside another semicolon.

It also cannot open a multi-item body:

```hexagon
let greet = name => log("Hello ${name}"); log("Ready")
```

The lambda body is only `log("Hello ${name}")`. The semicolon separates the complete
`let` binding from `log("Ready")` in the enclosing block. If both calls should belong
to the lambda, use indentation:

```hexagon
let greet = name =>
    log("Hello ${name}")
    log("Ready")
```

Semicolons are occasionally convenient for tiny neighboring bindings. Newlines are
usually easier to scan.

## Comments: one familiar spelling, one ML spelling

A line comment begins with `//` and continues to the newline, exactly as in
JavaScript:

```hexagon
let retries = 3 // enough for a transient failure
```

A block comment uses the ML family's `(* ... *)` and may span lines. Unlike
JavaScript block comments, Hexagon block comments nest:

```hexagon
(* outer explanation
   (* temporarily disabled detail *)
   back in the outer explanation
*)
```

Nesting makes it safe to comment out a region that already contains block comments.
Every opening `(*` still needs its own closing `*)`.

If JavaScript muscle memory produces `/*` or `*/`, the compiler recognizes the
attempt and answers with the rewrite: Hexagon block comments are `(* ... *)`. The
slash spellings are never silently accepted and never mean division and
multiplication side by side.

The form `(** ... *)` is the documentation comment. Placed directly above a
declaration, its content — Markdown — becomes that declaration's documentation:
editors show it on hover, and the compiler carries it into the generated JavaScript
and `.d.ts` as JSDoc, where every TypeScript consumer's tooling reads it. A
documentation comment that does not sit above a declaration is an error, not a
silently ignored note — if you wrote documentation, Hexagon makes sure something
shows it. (Banner lines are safe: `(***……` stays an ordinary comment.)

## Comments do not reshape a block

Comments count as whitespace for layout. A comment-only line neither opens a block nor
separates two items:

```hexagon
let prepare(order: Order): Order =
    // Keep the effect close to the work it announces.
    log("Preparing order")

            // Comment-only indentation is ignored.
    order
```

The body still contains the call followed by the final `order` expression. A trailing
comment likewise does not change the line's indentation or block membership.

Strings and comments remain separate lexical worlds. The string `"not // a comment"`
contains slashes; it does not end at them. Conversely, quotes inside a block comment do
not start string parsing.

## Summary

- indentation is Hexagon's only block syntax, serving expression blocks and member
  blocks alike;
- lines at the same indentation belong to the same block, deeper indentation nests,
  and dedenting closes blocks;
- a same-line body contains one expression;
- braces always begin records;
- semicolons separate items at the same block level but never terminate statements or
  open blocks;
- leading indentation uses spaces, not tabs; and
- `//` comments are line comments while `(* ... *)` comments can nest.

The earlier chapters' blocks were already following these rules. Naming them now gives
us a stable source shape for the more substantial types and declarations ahead.
