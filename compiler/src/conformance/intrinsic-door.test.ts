import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import vectorTrieSource from "../../../stdlib/Runtime/VectorTrie.hex?raw";

/**
 * Conformance for the intrinsic door itself (`spec/intrinsics.md`): the gate
 * (§5), verification (§4.2), the admitted forms (§3.3), and the genericity grant
 * that deliberately does *not* reopen foreign externs (§3.4).
 *
 * The behavioural half — what `Seq.memoize` actually does once declared through
 * the door — lives in `seq-memoize.test.ts`. This file is about what the door
 * accepts and what it says when it refuses, which is where §5.3's claim lives:
 * the door has no expression-position name to leak, so the only new surface a
 * user can type is the reserved specifier, and it must fail closed *with an
 * explanation* rather than silently or obscurely.
 */

function diagnostics(
  files: readonly (readonly [string, string])[],
  trustedStandardLibraryModules: ReadonlySet<string> = new Set(),
): readonly string[] {
  return compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
    { trustedStandardLibraryModules },
  ).diagnostics.map((diagnostic) => diagnostic.message);
}

const TRUST_DEBUG = new Set(["Debug"]);

/** A supplied declaration explicitly seated as the registered final prelude member. */
function debugDiagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return diagnostics(files, TRUST_DEBUG);
}

/**
 * A specimen compiled inside a **runtime module**, which is the only place
 * `Node(a)` can be spelled.
 *
 * The specialized harness explicitly grants the registered
 * `Runtime.VectorTrie` identity to this supplied declaration. The specimen rides
 * in `stdlib/Runtime/VectorTrie.hex`'s own text. The trie's text comes along because the emitter writes this
 * module's export list from a fixed inventory and reports the operations a file
 * in this seat fails to declare — a bare specimen would draw a diagnostic about
 * the wiring rather than about the door.
 */
function inRuntimeModule(source: string): readonly string[] {
  return diagnostics(
    [["/VectorTrie.hex", `${vectorTrieSource}\n${source}`]],
    new Set(["Runtime.VectorTrie"]),
  );
}

/** One user module. The prelude is injected around it. */
function main(source: string): readonly string[] {
  return diagnostics([["/main.hex", "module Main\n\n" + source]]);
}

const DOOR =
  'extern from "hex:intrinsic"\n' +
  "    export fun seqMemoize as memoized<a>(source: Seq(a)) -> Seq(a)\n";

describe("the gate (§5)", () => {
  /**
   * §5.1: in unprivileged source any `hex:`-scheme specifier is a hard error with
   * a named rewrite. The rewrite is the ordinary extern block the user's intent
   * wants — the message has to route them somewhere, since "reserved" alone
   * leaves a user who wanted to bind their own JavaScript with nowhere to go.
   */
  test("the reserved scheme fails closed in user source, with a rewrite", () => {
    expect(main(DOOR)).toEqual([
      "the `hex:` specifier scheme is reserved to standard-library source; " +
      "to bind your own JavaScript implementation, use an ordinary `extern from` " +
      "block naming your module",
    ]);
  });

  /**
   * §5.2, and the sharpest form of §5.3's claim: **the privilege attaches to how
   * the module is compiled, not to its text.** The very same block that is an
   * error above compiles here because the host explicitly grants this supplied
   * declaration the registered `Debug` member's role.
   *
   * `Debug.hex` is used because it is **last** in the prelude order: `Seq(a)`
   * is in scope in it (Modules §5.5), and replacing it with a door-only module
   * takes nothing out from under a later member. `Result.hex` served until
   * `JsValue.hex` seated after it and started answering with a `Result`
   * (FFI Part 11 §4.1).
   */
  test("the same text in an explicitly trusted prelude replacement is legal", () => {
    expect(debugDiagnostics([
      ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"],
      ["/Debug.hex", "module Debug\n\n" + DOOR],
    ])).toEqual([]);
  });

  /**
   * §5.3's claim is unconditional — "the block never resolves, so **no user
   * program can reach the inventory**" — so it has to hold of the *artifact*,
   * not only of the diagnostics. Emission for an errored module is best-effort
   * by design (`project.ts` emits every module so a broken one cannot report
   * success silently), and the gate's answer travels on the resolved item
   * precisely so best-effort cannot mean functional-but-forbidden here.
   *
   * The two things that must not be emitted are the two the block would fall
   * through to: the lowering, which is a working door beside the diagnostic
   * refusing it, and the ordinary foreign path, which would write the reserved
   * specifier — the one string the reservation exists to keep out of user
   * programs — into the output as an import.
   */
  test("a refused block emits no lowering, no import, and no reserved specifier", () => {
    const project = compileProject([
      new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + DOOR),
    ]);
    expect(project.diagnostics).toHaveLength(1);
    const javascript = project.modules
      .find(({ source }) => source.path === "/main.hex")!.javascript.text;

    expect(javascript).not.toContain("hex:intrinsic");
    expect(javascript).not.toContain("seqMemoize");
    expect(javascript).not.toContain("import");
    // Inert, not absent: the binding still exists, so the rest of an errored
    // module's output stays readable rather than referring to a missing name.
    expect(javascript).toContain("const memoized = undefined;");
  });

  /** §5.1: `"hex:intrinsic"` is the scheme's only v1 member. */
  test("another `hex:` member is refused even in privileged source", () => {
    expect(debugDiagnostics([
      ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"],
      ["/Debug.hex",
        "module Debug\n\n" + 'extern from "hex:magic"\n' +
        "    export fun seqMemoize as memoized<a>(source: Seq(a)) ->! Seq(a)\n"],
    ])).toEqual([
      "`hex:magic` is not a reserved boundary; `hex:intrinsic` is the scheme's only member",
    ]);
  });

  /**
   * The reservation is a property of the scheme, not of one block form. An
   * effect import of the door would emit `import "hex:intrinsic";` into the
   * output — a specifier no loader resolves — so it fails closed too.
   */
  test("an effect import of the door is refused on both sides of the gate", () => {
    // The rewrite names the form the author was already writing — an effect
    // import, not the `extern from` block the other refusal points at.
    expect(main('extern import "hex:intrinsic"\n')).toEqual([
      "the `hex:` specifier scheme is reserved to standard-library source; " +
      "to run your own JavaScript module for its effects, use an ordinary " +
      "`extern import` naming your module",
    ]);
    expect(debugDiagnostics([
      ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"],
      ["/Debug.hex", "module Debug\n\n" + 'extern import "hex:intrinsic"\n'],
    ])).toEqual([
      "the intrinsic door has no foreign module to import; " +
      'declare the operations you need in an `extern from "hex:intrinsic"` block',
    ]);
  });
});

describe("verification replaces trust (§4.2)", () => {
  /** Privileged source, so the gate passes and verification is what speaks. */
  function privileged(block: string): readonly string[] {
    return debugDiagnostics([
      ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"],
      ["/Debug.hex", "module Debug\n\n" + block],
    ]);
  }

  test("an unknown key is refused, naming the nearest inventory member", () => {
    expect(privileged(
      'extern from "hex:intrinsic"\n' +
      "    export fun seqMemoise as memoized<a>(source: Seq(a)) -> Seq(a)\n",
    )).toEqual([
      "the compiler provides no intrinsic `seqMemoise`; the nearest provided key is `seqMemoize`",
    ]);
  });

  /**
   * A key with nothing close to it gets no *guess* — past a small edit distance
   * the "nearest" member is noise, and a confidently wrong suggestion is worse
   * than none. It still gets a rewrite, as the Rewrite Rule requires: the
   * inventory is flat and compiler-global, so listing it is exhaustive rather
   * than speculative, which is the one thing a suggestion here must not be.
   */
  test("a key with no near neighbour is refused with the inventory, not a guess", () => {
    expect(privileged(
      'extern from "hex:intrinsic"\n' +
      "    export fun mapInsert as insert<a>(values: Seq(a), index: Int) -> a\n",
    )).toEqual([
      "the compiler provides no intrinsic `mapInsert`; the keys it provides are " +
      "`seqMemoize`, `streamFromSeq`, `vectorLength`, `vectorAppend`, `vectorPrepend`, `vectorAt`, " +
      "`vectorSet`, `vectorToSeq`, `vectorFromSeq`, `vectorToArray`, `bigIntAdd`, " +
      "`bigIntMultiply`, " +
      "`bigIntFromNat`, `bigIntSubtract`, `bigIntNegate`, `bigIntFromInt`, " +
      "`bigIntEquals`, `bigIntCompare`, `bigIntShow`, `bigIntPow`, `bigIntHash`, " +
      "`bigIntQuot`, `bigIntRem`, `bigIntToIntUnchecked`, `bigIntToFloatUnchecked`, " +
      "`intAdd`, `intMultiply`, `intFromNat`, `intSubtract`, `intNegate`, " +
      "`intEquals`, `intCompare`, `intShow`, `intPow`, `intHash`, `intQuot`, " +
      "`intRem`, `natAdd`, `natMultiply`, `natEquals`, `natCompare`, `natShow`, " +
      "`natPow`, `natHash`, `natQuot`, `natRem`, `natFromIntUnchecked`, " +
      "`floatAdd`, `floatMultiply`, `floatSubtract`, `floatNegate`, " +
      "`floatFromInt`, `floatDivide`, `floatEquals`, `floatCompare`, " +
      "`floatShow`, `floatPow`, `floatHash`, `floatRem`, `floatTrunc`, " +
      "`floatIsSafeInteger`, `floatToIntUnchecked`, `stringConcat`, " +
      "`stringEquals`, `stringCompare`, `stringHash`, `stringFromSeq`, `stringToSeq`, " +
      "`stringIsWhitespace`, `stringIsCased`, `stringIsCaseIgnorable`, " +
      "`stringLowercaseMapping`, `stringUppercaseMapping`, `stringCaseFoldMapping`, " +
      "`stringCodepointUnchecked`, `stringFromCodepointUnchecked`, `hashTrieMix`, " +
      "`hashTrieDigit`, `hashTrieBitTest`, `hashTrieBitSet`, `hashTrieBitClear`, " +
      "`hashTrieBitCount`, `hashTrieBitCountBelow`, `hashTrieNodeSingleton`, " +
      "`hashTrieNodeInsertAt`, `hashTrieNodeRemoveAt`, `mapEmpty`, " +
      "`mapSingleton`, `mapSize`, `mapGet`, `mapSet`, `mapRemove`, " +
      "`mapEntries`, `setEmpty`, `setSingleton`, `setSize`, `setContains`, " +
      "`setAdd`, `setRemove`, `setElements`, `setLookup`, `nullableUndefined`, " +
      "`nullableNull`, `nullableIsNull`, `nullableIsUndefined`, " +
      "`nullableAsValueUnchecked`, `nullableFromValue`, `debugLog`, " +
      "`mathSqrt`, `mathSin`, `mathCos`, `mathTan`, `mathAsin`, `mathAcos`, " +
      "`mathAtan`, `mathAtan2`, `mathExp`, `mathLn`, `mathLog10`, `mathSinh`, " +
      "`mathCosh`, `mathTanh`, " +
      "`jsValueKind`, `jsValueFrom`, `jsValueIsSafeInteger`, " +
      "`jsValueAsIntUnchecked`, `jsValueAsFloatUnchecked`, " +
      "`jsValueAsBigIntUnchecked`, `jsValueAsBoolUnchecked`, " +
      "`jsValueAsStringUnchecked`, `jsValueIsArray`, " +
      "`jsValueAsArrayUnchecked`, `arrayLength`, `jsMapSize`, `jsMapHas`, " +
      "`jsMapGetUnchecked`, `jsMapFromSeq`, `jsSetSize`, `jsSetHas`, " +
      "`jsSetFromSeq`, `jsErrorReadMessage`, `jsErrorReadStack`, `jsErrorRender`",
    ]);
  });

  /** §4.2: arity is verified against the inventory at the declaration site. */
  test("an arity mismatch is refused, stating the inventory arity", () => {
    expect(privileged(
      'extern from "hex:intrinsic"\n' +
      "    export fun seqMemoize as memoized<a>(source: Seq(a), extra: Int) -> Seq(a)\n",
    )).toEqual([
      "intrinsic `seqMemoize` takes 1 parameter, but this declaration has 2",
    ]);
  });

  /**
   * Types are **not** verified against a compiler-side table (§4.2): the
   * declaration's annotation is normative, and the checker types every use from
   * it. A declaration whose type diverges from what the lowering implements is a
   * compiler conformance defect — testable and loggable, never a user
   * diagnostic — so it must compile silently here rather than being caught by a
   * shadow table the ruling deliberately does not create.
   */
  test("a divergent declared type is not a user diagnostic", () => {
    expect(privileged(
      'extern from "hex:intrinsic"\n' +
      "    export fun seqMemoize as memoized(source: Int) -> Int\n",
    )).toEqual([]);
  });
});

describe("an intrinsic row writes its arrow (§4.2, #869)", () => {
  /**
   * Effects §6.1's ownership split needs no notation: an intrinsic row writes
   * `->`, `->!` or `->?` like every other callable extern row, and what the
   * door changes is who *answers* for the arrow — the compiler, verified,
   * rather than the author, trusted. So the face a caller sees is read from the
   * arrow here exactly as it is at a foreign row, which is what these
   * observations are: a bare call, a `!` call, and a linked call whose colour
   * follows the callback.
   *
   * §4.2's own sentence licenses the declared types: they are normative in the
   * declaration, not in a compiler-side table, so only the key and its arity
   * are verified and a row may be declared at whatever scheme a test needs.
   */
  function privileged(block: string): readonly string[] {
    return debugDiagnostics([
      ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"],
      ["/Debug.hex", "module Debug\n\n" + block],
    ]);
  }

  const ROWS = 'extern from "hex:intrinsic"\n' +
    "    fun stringHash as pureRow(value: String) -> Int\n" +
    "    fun stringConcat as impureRow(left: String, right: String) ->! String\n" +
    "    fun seqMemoize as linkedRow(step: () ->? String) ->? Int\n\n";

  test("`->` is pure at the call, `->!` wants `!`, `->?` follows its callback", () => {
    expect(privileged(ROWS +
      "export let a: Int = pureRow(\"x\")\n" +
      "export let b: String = impureRow!(\"x\", \"y\")\n" +
      "export let c: Int = linkedRow(() => \"x\")\n" +
      "export let d: Int = linkedRow!(() => impureRow!(\"a\", \"b\"))\n",
    )).toEqual([]);
  });

  test("the faces are enforced in both directions", () => {
    // The mark table's rows, reached with nothing FFI-specific: a `->!` row
    // called bare, a `->` row called with `!`, and a `->?` row whose callback
    // is impure called bare.
    expect(privileged(ROWS +
      "export let b: String = impureRow(\"x\", \"y\")\n",
    )).toEqual(["this call runs effects, so `impureRow` wants `!`, not no mark"]);
    expect(privileged(ROWS +
      "export let a: Int = pureRow!(\"x\")\n",
    )).toEqual(["this call is pure, so `pureRow` wants no mark, not `!`"]);
    expect(privileged(ROWS +
      "export let d: Int = linkedRow(() => impureRow!(\"a\", \"b\"))\n",
    )).toEqual(["this call runs effects, so `linkedRow` wants `!`, not no mark"]);
  });

  test("an inlet-less `->?` row is refused at the arrow, as a foreign row is", () => {
    // Effects §4.4's signature clause — the outer arrow is part of the row's
    // signature, and nothing this one's parameters supply can instantiate it —
    // with FFI Part 4 §4.5's advice in words, which a boundary row is owed on
    // both sides of the ownership split: the door does not change what the
    // repair is, only who answers for the arrow once it is written.
    expect(privileged(
      'extern from "hex:intrinsic"\n' +
      "    fun stringHash as linkedRow(value: String) ->? Int\n",
    )).toEqual([
      "`->?` is the caller's colour, and this position has no caller to choose it — " +
      "nothing a caller of this signature supplies carries `->?`, so nothing " +
      "instantiates it; write `->!` for a function that pulls the world, or `->` " +
      "for one that does not — write `->?` on the callback parameter this row runs, " +
      "or write `->!`",
    ]);
  });
});

describe("what the block admits (§3.3)", () => {
  function privileged(block: string): readonly string[] {
    return debugDiagnostics([
      ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"],
      ["/Debug.hex", "module Debug\n\n" + block],
    ]);
  }

  // §11's row, verbatim to its closing parenthesis. The head exemplar sits at
  // the sentence's tail since #590's respell rider — a one-word `(opaque)`
  // mid-sentence read as a gloss on "ordinary" instead of as the spelling to
  // write.
  const REFUSAL = "the intrinsic boundary provides operations only; declare `fun` here, " +
    "and declare types as ordinary declarations in this module (typically `opaque record`)";

  /**
   * The whole message: §11's static row plus the one datum the row cannot carry
   * — which form was written — appended as an aside (the row's own edit note
   * records the arrangement, so the two reconcile from the spec alone).
   *
   * Composed and asserted **whole**, rather than the row and the form name
   * checked separately: two containments leave the punctuation between them
   * free, and the relationship being claimed — row, then one clause — is
   * precisely what a doubled parenthesis would break while passing both.
   */
  const refusalOf = (form: string): string => `${REFUSAL} — \`${form}\` is not admitted`;

  test("`let` is refused, and the rewrite points at an ordinary declaration", () => {
    const [message] = privileged(
      'extern from "hex:intrinsic"\n' +
      "    export let seqMemoize: Int\n",
    );
    expect(message).toBe(refusalOf("let"));
  });

  /**
   * Compiler-owned *types* in particular do not enter here — the collection
   * companions declare their types as ordinary declarations in Hexagon source
   * rather than through this door, and the deliberate non-declared boundary
   * types stay fallbacks under Modules §5.5.
   */
  test("`type` is refused", () => {
    const [message] = privileged(
      'extern from "hex:intrinsic"\n' +
      "    export type seqNode as SeqNode\n",
    );
    expect(message).toBe(refusalOf("type"));
  });

  /**
   * `default` names a foreign module's default export; there is no module here.
   * Reported once, not twice: a `default` declaration has no foreign name to be
   * the key, so verifying its local name as one would report the same mistake
   * again as a claim about a key the author never wrote.
   */
  test("`default` is refused, once", () => {
    const messages = privileged(
      'extern from "hex:intrinsic"\n' +
      "    export default fun memoized<a>(source: Seq(a)) -> Seq(a)\n",
    );
    expect(messages).toEqual([refusalOf("default")]);
  });
});

describe("genericity is granted inside the boundary only (§3.4)", () => {
  /**
   * The grant rests on *who implements*: the compiler owns the representation of
   * every Hexagon type because it emits them, so FFI Part 4 §12.4's deferred
   * representation question does not arise inside the trust boundary. It very
   * much still arises outside it, and this pins that Part 4 was not reopened as
   * a side effect.
   */
  test("a foreign extern is still monomorphic", () => {
    expect(main(
      'extern from "elsewhere"\n' +
      "    fun identity<a>(value: a) ->! a\n",
    )).toContain("generic extern declarations are not part of Hexagon v1");
  });

  /**
   * *(#370.)* The amendment rides the same argument one member deeper: at a
   * foreign boundary a constrained contract would hand an untrusted implementer
   * a dictionary whose shape is the compiler's private business — Part 4 §12.4's
   * representation question again. So foreign externs stay monomorphic **and
   * unconstrained**, which the existing refusal already delivers: a bound
   * introduces a type variable, so the monomorphism diagnostic is what a
   * constrained foreign row meets first, and the brackets are dropped rather
   * than recorded, so nothing behind the diagnostic acquires a scheme.
   */
  test("a foreign extern is still unconstrained", () => {
    expect(main(
      'extern from "elsewhere"\n' +
      "    fun place<k: Hash>(key: k) ->! Int\n",
    )).toContain("generic extern declarations are not part of Hexagon v1");
  });

  test("an intrinsic declaration may be generic", () => {
    expect(debugDiagnostics([
      ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"],
      ["/Debug.hex", "module Debug\n\n" + DOOR],
    ])).toEqual([]);
  });

  /**
   * *(#370.)* And a constrained intrinsic row is an ordinary constrained
   * function from the declaration onward: discharge happens at every call, and
   * a key type with no instance is refused there rather than at the door.
   * `stdlib/Map.hex`'s keyed trio is the grant's concrete demand and its live
   * customer; this is the mechanism in miniature, at a runtime module's door so
   * the specimen owns its own key.
   */
  test("an intrinsic declaration may carry constraint brackets, and they bind", () => {
    const constrained = 'extern from "hex:intrinsic"\n' +
      "    fun hashTrieNodeSingleton as one<a: Hash>(value: a) -> Node(a)\n";
    expect(inRuntimeModule(`${constrained}export let ok: Int = Node.get(one(1), 0)\n`))
      .toEqual([]);
    expect(inRuntimeModule(
      "record Weird = {s: String}\n" +
      `${constrained}export let bad: Int = Node.get(one(Weird({s = "K"})), 0).s\n`,
    ).join("\n")).toContain("type `Weird` has no `Hash` instance");
  });

  /**
   * §3.1 and §6: after the declaration the binding is ordinary, which includes
   * *ordinary generalisation* — two consumers instantiate it independently.
   *
   * The variable here appears only in the **result**, the shape that catches a
   * scheme quantified over a snapshot taken before every annotation was
   * interned. A result-only variable left free is not a type error at the
   * declaration; it is a variable shared by every consumer, so the first call
   * site silently pins it for all the others, and the second one fails with a
   * mismatch naming a type it never mentioned. `seqMemoize` has no such
   * variable, but §9.2 binds the `Vector` arc, whose door is full of nullary
   * producers (`empty<a>(): Vector(a)`) that are exactly this shape.
   */
  test("a result-only type variable generalizes, so consumers instantiate it independently", () => {
    expect(debugDiagnostics([
      ["/main.hex",
        "module Main\n\n" + "export let asInt: Int = Debug.produce(1)\n" +
        "export let asText: String = Debug.produce(2)\n"],
      ["/Debug.hex",
        "module Debug\n\n" + 'extern from "hex:intrinsic"\n' +
        "    export fun seqMemoize as produce<a>(source: Int) -> a\n"],
    ])).toEqual([]);
  });
});
