import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import vectorTrieSource from "../../../stdlib/Runtime/VectorTrie.hex?raw";
import regexRuntimeSource from "../../../stdlib/Runtime/Regex.hex?raw";
import { intrinsicKeys } from "../intrinsics";

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

/**
 * A specimen compiled inside a **runtime module**, which is the only place
 * `Node(a)` can be spelled.
 *
 * The role is not a host's to hand out (#829): a file is a runtime member by
 * sitting at the member's basename and declaring the member's name, so the
 * specimen rides in `stdlib/Runtime/VectorTrie.hex`'s own text at
 * `/VectorTrie.hex`. The trie's text comes along because the emitter writes this
 * module's export list from a fixed inventory and reports the operations a file
 * in this seat fails to declare — a bare specimen would draw a diagnostic about
 * the wiring rather than about the door.
 */
function inRuntimeModule(source: string): readonly string[] {
  return diagnostics([["/VectorTrie.hex", `${vectorTrieSource}\n${source}`]]);
}

/** One user module. The prelude is injected around it. */
function main(source: string): readonly string[] {
  return diagnostics([["/main.hex", "module Main\n\n" + source]]);
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
   * `Debug.hex` is used because it is **last** in the prelude order: `Seq(a)`
   * is in scope in it (Modules §5.5), and replacing it with a door-only module
   * takes nothing out from under a later member. `Result.hex` served until
   * `JsValue.hex` seated after it and started answering with a `Result`
   * (FFI Part 11 §4.1).
   */
  test("the same text at a prelude injection path is legal", () => {
    expect(diagnostics([
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
    expect(diagnostics([
      ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"],
      ["/Debug.hex",
        "module Debug\n\n" + 'extern from "hex:magic"\n' +
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
    // The rewrite names the form the author was already writing — an effect
    // import, not the `extern from` block the other refusal points at.
    expect(main('extern import "hex:intrinsic"\n')).toEqual([
      "the `hex:` specifier scheme is reserved to standard-library source; " +
      "to run your own JavaScript module for its effects, use an ordinary " +
      "`extern import` naming your module",
    ]);
    expect(diagnostics([
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
    return diagnostics([
      ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"],
      ["/Debug.hex", "module Debug\n\n" + block],
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
   * A key with nothing close to it gets no *guess* — past a small edit distance
   * the "nearest" member is noise, and a confidently wrong suggestion is worse
   * than none. It still gets a rewrite, as the Rewrite Rule requires: the
   * inventory is flat and compiler-global, so listing it is exhaustive rather
   * than speculative, which is the one thing a suggestion here must not be.
   */
  test("a key with no near neighbour is refused with the inventory, not a guess", () => {
    // The listing is **grade-scoped** since #927 (§4.2): a `fun` row is offered
    // the operations and never `buffer`, which it could not take. Built from the
    // inventory rather than transcribed, because a hundred-and-twenty-key
    // literal pins the spelling of the joiner and nothing else anybody reads —
    // and the joiner is asserted here, whole, once.
    const listing = intrinsicKeys("operation").map((key) => `\`${key}\``).join(", ");
    expect(listing).toContain("`seqMemoize`, `streamFromSeq`,");
    expect(listing).toContain("`bufferWrite`, `bufferLength`");
    expect(listing).not.toContain("`buffer`,");
    expect(privileged(
      'extern from "hex:intrinsic"\n' +
      "    export fun mapInsert as insert<a>(values: Seq(a), index: Int): a\n",
    )).toEqual([
      `the compiler provides no intrinsic \`mapInsert\`; the keys it provides are ${listing}`,
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
      ["/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"],
      ["/Debug.hex", "module Debug\n\n" + block],
    ]);
  }

  // §11's row, verbatim to its closing parenthesis. The head exemplar sits at
  // the sentence's tail since #590's respell rider — a one-word `(opaque)`
  // mid-sentence read as a gloss on "ordinary" instead of as the spelling to
  // write.
  // *(#927.)* `type` left the refused list when §3.3 admitted it, and the
  // parenthetical now names the ordinary form a type *programs must be able to
  // address* should take — one outside §3.3's confinement bar.
  const REFUSAL = "the intrinsic boundary provides operations and compiler-implemented types " +
    "only; declare `fun` or `type` here, and declare everything else as an ordinary " +
    "declaration in this module (typically `opaque record`)";

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
   * *(#927.)* `type` is **admitted** — §3.3's compiler-implemented type — so the
   * refusal family no longer names it, and the two forms the block takes are the
   * two the message names. The rows below hold what a `type` row must satisfy;
   * this one holds only that the keyword itself is not turned away.
   */
  test("`type` is no longer an inadmissible form", () => {
    expect(privileged(
      'extern from "hex:intrinsic"\n' +
      "    export type seqNode as SeqNode\n",
    ).some((message) => message === refusalOf("type"))).toBe(false);
  });

  /**
   * Every other form keeps its refusal, and `class` is the one that reads as a
   * near miss: FFI Part 5's opaque foreign class is a `type`-ish word, and it is
   * still an ordinary declaration's business rather than the door's.
   */
  test("`class` is still refused, with `type` now among the admitted forms", () => {
    const [message] = privileged(
      'extern from "hex:intrinsic"\n' +
      "    export class Widget\n",
    );
    expect(message).toBe(refusalOf("class"));
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
      "    fun identity<a>(value: a): a\n",
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
      "    fun place<k: Hash>(key: k): Int\n",
    )).toContain("generic extern declarations are not part of Hexagon v1");
  });

  test("an intrinsic declaration may be generic", () => {
    expect(diagnostics([
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
      "    fun hashTrieNodeSingleton as one<a: Hash>(value: a): Node(a)\n";
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
    expect(diagnostics([
      ["/main.hex",
        "module Main\n\n" + "export let asInt: Int = Debug.produce(1)\n" +
        "export let asText: String = Debug.produce(2)\n"],
      ["/Debug.hex",
        "module Debug\n\n" + 'extern from "hex:intrinsic"\n' +
        "    export fun seqMemoize as produce<a>(source: Int): a\n"],
    ])).toEqual([]);
  });
});

/**
 * The `type` form (`spec/intrinsics.md` §3.3, #927/#930): the compiler-implemented
 * type whose values only the block's `fun` rows construct and inspect, keyed and
 * arity-verified in the same flat space as an operation (§4.1), declarable only
 * in the modules its inventory entry names, and **confined** — never addressable
 * outside them.
 *
 * Every specimen rides in `stdlib/Runtime/Regex.hex`'s own text at
 * `/Regex.hex`, the way the `VectorTrie` specimens ride in the trie's: a file is
 * a runtime member by sitting at the member's basename and declaring the
 * member's name (#829), and `buffer`'s inventory entry names that module as its
 * one declarer. The shipped text comes along so the specimen compiles beside the
 * rows it is about.
 */
describe("the `type` form (§3.3)", () => {
  /** A specimen inside `Runtime.Regex`'s seat, the `buffer` key's one declarer. */
  function inRegexRuntime(source: string): readonly string[] {
    return diagnostics([["/Regex.hex", `${regexRuntimeSource}\n${source}`]]);
  }

  /** A specimen in a *runtime* module that is not a named declarer of `buffer`. */
  function inOtherRuntime(block: string): readonly string[] {
    return diagnostics([["/VectorTrie.hex", `${vectorTrieSource}\n${block}`]]);
  }

  /**
   * The admitted form, §3.3's own example: the type row and the four operations
   * over it, with the arrows `regex.md` §7 writes. This is the shipped file
   * compiled in its real role, so what passes here is the declaration the engine
   * will be written against rather than a specimen shaped like it.
   */
  test("the shipped `Runtime.Regex` door compiles in its real role", () => {
    expect(diagnostics([["/Regex.hex", regexRuntimeSource]])).toEqual([]);
  });

  /**
   * §4.2's unknown-key row at the **type** grade, with the nearest suggestion
   * searched inside that grade alone — an operation key offered here could not
   * be taken, since the next compile would refuse it for its grade.
   */
  test("an unknown type key is refused, with a grade-scoped nearest", () => {
    expect(inRegexRuntime(
      'extern from "hex:intrinsic"\n' +
      "    type bufer as Store(a)\n",
    )).toEqual([
      "the compiler provides no intrinsic `bufer`; the nearest provided key is `buffer`",
    ]);
  });

  /** §11's type-key arity row: the arity is the type's **parameter** count. */
  test("a type key's arity is verified, in type parameters", () => {
    expect(inRegexRuntime(
      'extern from "hex:intrinsic"\n' +
      "    type buffer as Store(a, b)\n",
    )).toEqual([
      "intrinsic type `buffer` takes 1 type parameter, but this declaration has 2",
    ]);
    expect(inRegexRuntime(
      'extern from "hex:intrinsic"\n' +
      "    type buffer as Store\n",
    )).toEqual([
      "intrinsic type `buffer` takes 1 type parameter, but this declaration has 0",
    ]);
  });

  /**
   * §11's wrong-grade row, **both ways**. The rewrite is the row's keyword: the
   * key exists and names exactly one thing, so there is nothing to correct in
   * the spelling.
   */
  test("a type key under `fun` is refused, and an operation key under `type`", () => {
    expect(inRegexRuntime(
      'extern from "hex:intrinsic"\n' +
      "    fun buffer as make(size: Int): Int\n",
    )).toEqual([
      "`buffer` is an intrinsic type, not an operation; declare it with `type`",
    ]);
    expect(inRegexRuntime(
      'extern from "hex:intrinsic"\n' +
      "    type bufferLength as Length\n",
    )).toEqual([
      "`bufferLength` is an intrinsic operation, not a type; declare it with `fun`",
    ]);
  });

  /**
   * §11's declarer row. The list is part of the *inventory entry*, not of the
   * gate: `Runtime.VectorTrie` is privileged, holds the door, and still may not
   * declare `buffer` — which is the half of §3.3's confinement bar a declaration
   * site can answer.
   */
  test("a type key declared outside its named declarers is refused", () => {
    expect(inOtherRuntime(
      'extern from "hex:intrinsic"\n' +
      "    type buffer as Store(a)\n",
    )).toEqual([
      "`buffer` may be declared only in `Hex.Runtime.Regex`; a value over it " +
      "reaches other modules through a sealed row, never through the type",
    ]);
  });

  /**
   * The gate is unmoved by the new form (§5.1): a `type` row in unprivileged
   * source draws the reservation's own message and nothing about types at all,
   * because the block never resolves.
   */
  test("the door still refuses a `type` row in unprivileged source", () => {
    expect(main(
      'extern from "hex:intrinsic"\n' +
      "    type buffer as Store(a)\n",
    )).toEqual([
      "the `hex:` specifier scheme is reserved to standard-library source; " +
      "to bind your own JavaScript implementation, use an ordinary `extern from` " +
      "block naming your module",
    ]);
  });

  /**
   * *(#927.)* The variance sigil. §3.3 gives the row the opaque-declaration rule
   * and a written sigil would be a *trusted* claim under §4.2's parametricity
   * obligation; no inventory row makes one, and a claim recorded but not carried
   * through both variance walks would read as load-bearing and do nothing. The
   * form is refused rather than half-built.
   */
  test("a written variance sigil is refused", () => {
    expect(inRegexRuntime(
      'extern from "hex:intrinsic"\n' +
      "    type buffer as Store(+a)\n",
    )).toEqual([
      "an intrinsic `type` row takes no variance claim; every parameter is " +
      "invariant here — remove the `+`",
    ]);
  });
});

/**
 * §3.3's **confinement** and §11's "Confined type escaping" row (#927/#930): the
 * type may not appear in an exported signature, in an exported pattern's
 * parameter types, in an exception payload, in the representation of a
 * non-`opaque` exported type, or in an `export` of its own — and *may* sit in an
 * `opaque` exported record's field or `opaque` exported union constructor's
 * payload, which is how a value over confined storage lawfully travels.
 */
describe("confinement (§3.3, §11)", () => {
  function inRegexRuntime(source: string): readonly string[] {
    return diagnostics([["/Regex.hex", `${regexRuntimeSource}\n${source}`]]);
  }

  /** The two clauses §11 selects between, by carrier. */
  const CARRY = "the intrinsic type `Buffer` is private to this module; " +
    "carry it in an opaque record, or keep this private";
  const HEAD = "the intrinsic type `Buffer` is private to this module; " +
    "head the carrier `opaque`, carry it in an opaque record, or drop the `export`";

  /** Carrier 1 of five: an exported signature. */
  test("an exported signature carrying the type is refused", () => {
    expect(inRegexRuntime(
      "export let sized(b: Buffer(Int)): Int = length(b)\n",
    )).toEqual([CARRY]);
  });

  /** And an exported **door row**'s signature, which is a signature like any other. */
  test("an exported door row carrying the type is refused", () => {
    expect(inRegexRuntime(
      'extern from "hex:intrinsic"\n' +
      "    export fun bufferLength as size(buffer: Buffer(a)) -> Int\n",
    )).toEqual([CARRY]);
  });

  /** Carrier 2: an exported pattern's parameter types (a pattern crosses). */
  test("an exported pattern carrying the type is refused", () => {
    expect(inRegexRuntime(
      "export pattern sized(n: Int): Buffer(Int)\n" +
      "    view(b) = length(b)\n",
    )).toEqual([CARRY]);
  });

  /**
   * Carrier 3: an exception payload — **whatever the head says**. §3.3's clause
   * carries no `exported` qualifier where its neighbours do, and that difference
   * is the point: an exception escapes its module by being thrown.
   */
  test("an exception payload carrying the type is refused, exported or not", () => {
    expect(inRegexRuntime(
      "export exception Overrun(message: String, at: Buffer(Int))\n",
    )).toEqual([CARRY]);
    expect(inRegexRuntime(
      "exception Overrun(message: String, at: Buffer(Int))\n",
    )).toEqual([CARRY]);
  });

  /** Carrier 4: the representation of a non-`opaque` exported type. */
  test("a transparent exported record's field carrying the type is refused", () => {
    expect(inRegexRuntime(
      "export record Cell = {slots: Buffer(Int)}\n",
    )).toEqual([HEAD]);
  });

  /** The same for a transparent exported union, and for an exported type alias. */
  test("a transparent exported union, and an exported alias, are refused", () => {
    expect(inRegexRuntime(
      "export union Cell = | Slots(at: Buffer(Int))\n",
    )).toEqual([HEAD]);
    // An alias has no `opaque` head to take (Modules §4.2), so it gets the
    // clause that offers only the other two repairs.
    expect(inRegexRuntime("export type Alias = Buffer(Int)\n")).toEqual([CARRY]);
  });

  /** Carrier 5: the row exporting itself. */
  test("an `export`ed type row is refused, and the rewrite is the modifier", () => {
    expect(diagnostics([["/Regex.hex",
      "module Runtime.Regex\n\n" +
      'extern from "hex:intrinsic"\n' +
      "    export type buffer as Buffer(a)\n",
    ]])).toEqual([
      "the intrinsic type `Buffer` is private to this module; drop the `export`",
    ]);
  });

  /**
   * And the carrier that is **accepted**: an opaque record's field. An opaque
   * value's structure is unreadable outside the home module (Modules §4.2), so
   * the storage stays addressable only here while a value over it travels —
   * which is exactly how a compiled `Regex` will carry its program. The `make`
   * export is what proves the acceptance is real rather than vacuous: the
   * carrier is built here and handed out.
   */
  test("an opaque record's field may carry the type", () => {
    expect(inRegexRuntime(
      "opaque record Cell = {slots: Buffer(Int)}\n" +
      "export let make(): Cell = Cell({slots = create!(1, 0)})\n",
    )).toEqual([]);
  });

  /** The same for an opaque union's constructor payload. */
  test("an opaque union's payload may carry the type", () => {
    expect(inRegexRuntime(
      "opaque union Cell = | Slots(at: Buffer(Int))\n" +
      "export let make(): Cell = Slots(create!(1, 0))\n",
    )).toEqual([]);
  });

  /**
   * A `derives` over such a carrier is refused **at the missing instance**, and
   * that falls out rather than being arranged: a confined type has no derived
   * instances (§3.3's second property) and no row of the block honors `Eq`, so
   * the derivation asks at the field's type and finds nothing. The report names
   * what is actually absent, at the seat that wanted it — which is why nothing
   * in the confinement machinery mentions `derives` at all.
   */
  test("a `derives` over an opaque carrier is refused at the missing instance", () => {
    expect(inRegexRuntime(
      "opaque record Cell derives (Eq) = {slots: Buffer(Int)}\n",
    )).toEqual(["type `Buffer(Int)` has no `Eq` instance"]);
  });

  /**
   * The escape is reported **once**, with §11's wording. The neighbouring
   * private-type family (Modules §4.3) would otherwise fire on the same seat
   * and offer "export the type, perhaps opaquely" — a repair §3.3 forbids
   * outright — so the confined row stands alone there.
   */
  test("an escape draws §11's row and not Modules §4.3's", () => {
    const messages = inRegexRuntime("export let sized(b: Buffer(Int)): Int = length(b)\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain("exposes private type");
  });
});
