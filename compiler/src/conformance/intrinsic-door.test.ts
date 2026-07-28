import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

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
): readonly string[] {
  return compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  ).diagnostics.map((diagnostic) => diagnostic.message);
}

/** One user module. The prelude is injected around it. */
function main(source: string): readonly string[] {
  return diagnostics([["/main.hex", source]]);
}

const DOOR =
  'extern from "hex:intrinsic"\n' +
  "    export fun seqMemoize as memoized<a>(source: Seq(a)): Seq(a)\n";

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
   * error above compiles here, because the file sits at a prelude injection path
   * — the loader already lets a project-supplied file win over the embedded copy,
   * and that is the stdlib-developing-itself path.
   *
   * `Result.hex` is used because it is last in the prelude order, so `Seq(a)` is
   * in scope in it (Modules §5.5).
   */
  test("the same text at a prelude injection path is legal", () => {
    expect(diagnostics([
      ["/main.hex", "export let ok: Int = 1\n"],
      ["/Result.hex", DOOR],
    ])).toEqual([]);
  });

  /** §5.1: `"hex:intrinsic"` is the scheme's only v1 member. */
  test("another `hex:` member is refused even in privileged source", () => {
    expect(diagnostics([
      ["/main.hex", "export let ok: Int = 1\n"],
      ["/Result.hex",
        'extern from "hex:magic"\n' +
        "    export fun seqMemoize as memoized<a>(source: Seq(a)): Seq(a)\n"],
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
    expect(main('extern import "hex:intrinsic"\n')).toEqual([
      "the `hex:` specifier scheme is reserved to standard-library source; " +
      "to bind your own JavaScript implementation, use an ordinary `extern from` " +
      "block naming your module",
    ]);
    expect(diagnostics([
      ["/main.hex", "export let ok: Int = 1\n"],
      ["/Result.hex", 'extern import "hex:intrinsic"\n'],
    ])).toEqual([
      "the intrinsic door has no foreign module to import; " +
      'declare the operations you need in an `extern from "hex:intrinsic"` block',
    ]);
  });
});

describe("verification replaces trust (§4.2)", () => {
  /** Privileged source, so the gate passes and verification is what speaks. */
  function privileged(block: string): readonly string[] {
    return diagnostics([
      ["/main.hex", "export let ok: Int = 1\n"],
      ["/Result.hex", block],
    ]);
  }

  test("an unknown key is refused, naming the nearest inventory member", () => {
    expect(privileged(
      'extern from "hex:intrinsic"\n' +
      "    export fun seqMemoise as memoized<a>(source: Seq(a)): Seq(a)\n",
    )).toEqual([
      "the compiler provides no intrinsic `seqMemoise`; the nearest provided key is `seqMemoize`",
    ]);
  });

  /**
   * A key with nothing close to it gets no suggestion. Past a small edit
   * distance the "nearest" member is noise, and a confidently wrong suggestion
   * is worse than none.
   */
  test("a key with no near neighbour is refused without a guess", () => {
    expect(privileged(
      'extern from "hex:intrinsic"\n' +
      "    export fun vectorAt as at<a>(values: Seq(a), index: Int): a\n",
    )).toEqual([
      "the compiler provides no intrinsic `vectorAt`",
    ]);
  });

  /** §4.2: arity is verified against the inventory at the declaration site. */
  test("an arity mismatch is refused, stating the inventory arity", () => {
    expect(privileged(
      'extern from "hex:intrinsic"\n' +
      "    export fun seqMemoize as memoized<a>(source: Seq(a), extra: Int): Seq(a)\n",
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
      "    export fun seqMemoize as memoized(source: Int): Int\n",
    )).toEqual([]);
  });
});

describe("what the block admits (§3.3)", () => {
  function privileged(block: string): readonly string[] {
    return diagnostics([
      ["/main.hex", "export let ok: Int = 1\n"],
      ["/Result.hex", block],
    ]);
  }

  const REFUSAL = "the intrinsic boundary provides operations only; declare `fun` here, " +
    "and declare types as ordinary (`export opaque`) declarations in this module";

  test("`let` is refused, and the rewrite points at an ordinary declaration", () => {
    const [message] = privileged(
      'extern from "hex:intrinsic"\n' +
      "    export let seqMemoize: Int\n",
    );
    expect(message).toContain(REFUSAL);
    expect(message).toContain("`let`");
  });

  /**
   * Compiler-owned *types* in particular do not enter here — the four collection
   * companions declare ordinary records, and the deliberate non-declared boundary
   * types stay fallbacks under Modules §5.5.
   */
  test("`type` is refused", () => {
    const [message] = privileged(
      'extern from "hex:intrinsic"\n' +
      "    export type seqNode as SeqNode\n",
    );
    expect(message).toContain(REFUSAL);
    expect(message).toContain("`type`");
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
      "    export default fun memoized<a>(source: Seq(a)): Seq(a)\n",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(REFUSAL);
    expect(messages[0]).toContain("`default`");
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
      "    fun identity<a>(value: a): a\n",
    )).toContain("generic extern declarations are not part of Hexagon v1");
  });

  test("an intrinsic declaration may be generic", () => {
    expect(diagnostics([
      ["/main.hex", "export let ok: Int = 1\n"],
      ["/Result.hex", DOOR],
    ])).toEqual([]);
  });
});
