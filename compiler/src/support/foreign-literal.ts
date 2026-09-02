/**
 * The member value of a **literal `extern enum`** (`spec/ffi-foreign-enums.md`
 * §2.4) — a JavaScript value written in the declaration rather than read from a
 * foreign object.
 *
 * It lives beside `source.ts` and `diagnostics.ts` rather than in any one
 * syntax tree because all four trees carry it unchanged: the parser reads it,
 * the resolver copies it onto the union declaration it marks, and the emitter
 * spells it as JavaScript and as TypeScript. Nothing between them interprets
 * it.
 *
 * The five kinds are §2.4's closed list. A float is deliberately absent: `NaN`
 * and signed zero separate `Object.is` from `===`, and §4's `switch` lowering
 * rests on the two agreeing. An integer's sign is folded in here as it is in a
 * pattern (Pattern Matching §2.5), so `-0` is stored as `0` — the value
 * `Object.is` sees, and the one no `switch` case can tell from a positive zero.
 */
export type ForeignLiteral =
  | { readonly kind: "String"; readonly value: string }
  | { readonly kind: "Integer"; readonly value: number }
  | { readonly kind: "Bool"; readonly value: boolean }
  | { readonly kind: "Null" }
  | { readonly kind: "Undefined" };

/**
 * The literal as JavaScript source — the constant's initializer (§7.1), a
 * `switch` case label (§4), and the `.d.ts` alternative (§7.2) are all this
 * exact text.
 */
export function foreignLiteralJs(literal: ForeignLiteral): string {
  switch (literal.kind) {
    case "String":
      return JSON.stringify(literal.value);
    case "Integer":
      return String(literal.value);
    case "Bool":
      return literal.value ? "true" : "false";
    case "Null":
      return "null";
    case "Undefined":
      return "undefined";
  }
}

/**
 * A key that distinguishes exactly the values `Object.is` distinguishes (§2.4's
 * pairwise-distinctness rule, §3 rule 5).
 *
 * The kind is part of the key because JavaScript's own `Object.is` separates
 * `"1"` from `1` and `0` from `false`, and a bare `String(value)` would not.
 * Within the integer kind the stored value has already had `-0` folded to `0`,
 * so two spellings of zero collide here — which is the refusal §2.4 asks for.
 */
export function foreignLiteralKey(literal: ForeignLiteral): string {
  switch (literal.kind) {
    case "String":
      return `s:${literal.value}`;
    case "Integer":
      return `i:${literal.value}`;
    case "Bool":
      return `b:${literal.value}`;
    case "Null":
      return "null";
    case "Undefined":
      return "undefined";
  }
}

/** Whether this literal is one of JavaScript's two nullish values (§2.4). */
export function isNullishLiteral(literal: ForeignLiteral): boolean {
  return literal.kind === "Null" || literal.kind === "Undefined";
}
