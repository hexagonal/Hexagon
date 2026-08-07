/**
 * The intrinsic inventory (`spec/intrinsics.md` §4).
 *
 * The intrinsic door is how privileged standard-library source names a
 * compiler-provided implementation of an operation it publicly owns. It is a
 * *declaration*, not a third meaning of `Name.` — an `extern from
 * "hex:intrinsic"` block reusing FFI Part 4's grammar, whose left-of-`as` name
 * is a key in this flat, compiler-global space (§4.1) rather than a foreign
 * export name.
 *
 * Keys deliberately mirror the emitter's runtime helper family (`seqMemoize` ↔
 * the memoizing spine) and survive module and operation renames: the local name
 * is the module's business, the key is the compiler's.
 *
 * At a foreign extern boundary the declaration is believed; here it is
 * **checked** (§4.2), because the compiler is the implementer. Key existence and
 * arity are verified at the declaration site. Types are *not* checked against a
 * table: the declaration's annotation is normative, and a lowering that diverges
 * from it is a compiler conformance defect, never a user diagnostic.
 */

/** The reserved specifier scheme (§5.1). Fails closed in unprivileged source. */
export const INTRINSIC_SCHEME = "hex:";

/** The scheme's only v1 member (§5.1). */
export const INTRINSIC_SPECIFIER = "hex:intrinsic";

export function isIntrinsicScheme(specifier: string): boolean {
  return specifier.startsWith(INTRINSIC_SCHEME);
}

/**
 * Every intrinsic the compiler provides, keyed by §4.1's `<companion><Operation>`
 * convention, with the arity §4.2 verifies each declaration against.
 *
 * `seqMemoize` — Loops §6.4's explicit opt-in: wraps any `Seq` in the runtime's
 * memoizing spine, the same mechanism as FFI Part 3's inbound adapter. Declared
 * by `stdlib/Seq.hex` per `spec/intrinsics.md` §3.2; lowered by the emitter's
 * helper of the same name.
 *
 * The `vector*` family is exactly Collections Part 3 §7's boundary crossing —
 * representation-sensitive length and end updates, signed indexed access,
 * persistent indexed update, and the eager/lazy bridge. Everything else in that
 * table is Hexagon source in `stdlib/Vector.hex`, which declares these seven and
 * owns the public surface over them (§9.2's `Vector` milestone).
 *
 * The `bigInt*` family is the door's third customer and the primitive template's
 * worked example (§3.2, #344), in the **primop shape**: every own-operation
 * member of `stdlib/BigInt.hex`'s eight instances crosses here, because an
 * operator- or interpolation-form body would denote only the slot it defines
 * (Constraints §6.1). What sits *above* those operations is ordinary Hexagon in
 * that file and therefore absent here — the Euclidean pair over the truncated
 * one, `gcd`, `lcm`, `toInt`'s range check, and every zero-divisor and
 * negative-exponent guard. `bigIntPow` is the raw native `**`, unguarded, for
 * the same reason.
 */
export const INTRINSIC_INVENTORY: ReadonlyMap<string, number> = new Map([
  ["seqMemoize", 1],
  ["vectorLength", 1],
  ["vectorAppend", 2],
  ["vectorPrepend", 2],
  ["vectorAt", 2],
  ["vectorSet", 3],
  ["vectorToSeq", 1],
  ["vectorFromSeq", 1],
  ["bigIntAdd", 2],
  ["bigIntMultiply", 2],
  ["bigIntFromNat", 1],
  ["bigIntSubtract", 2],
  ["bigIntNegate", 1],
  ["bigIntFromInt", 1],
  ["bigIntEquals", 2],
  ["bigIntCompare", 2],
  ["bigIntShow", 1],
  ["bigIntPow", 2],
  ["bigIntHash", 1],
  ["bigIntQuot", 2],
  ["bigIntRem", 2],
  ["bigIntToIntUnchecked", 1],
  ["bigIntToFloat", 1],
]);

/**
 * The nearest inventory member to a misspelled key, for §11's diagnostic. Only
 * a genuinely close key is offered: past a third of the key's length the
 * "nearest" member is noise, and the message falls back to listing nothing.
 */
export function nearestIntrinsicKey(key: string): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of INTRINSIC_INVENTORY.keys()) {
    const distance = editDistance(key, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best === undefined) return undefined;
  return bestDistance <= Math.max(1, Math.floor(best.length / 3)) ? best : undefined;
}

/** Ordinary Levenshtein distance over a single rolling row. */
function editDistance(left: string, right: string): number {
  let previous = [...Array(right.length + 1).keys()];
  for (let index = 1; index <= left.length; index += 1) {
    const current = [index];
    for (let other = 1; other <= right.length; other += 1) {
      current.push(
        left[index - 1] === right[other - 1]
          ? previous[other - 1]!
          : 1 + Math.min(previous[other - 1]!, previous[other]!, current[other - 1]!),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}
