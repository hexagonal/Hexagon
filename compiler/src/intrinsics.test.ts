import { describe, expect, test } from "vitest";

import { compileProject, Source } from "./index";
import { INTRINSIC_INVENTORY, intrinsicKeys, nearestIntrinsicKey } from "./intrinsics";
import regexRuntimeSource from "../../stdlib/Runtime/Regex.hex?raw";

/**
 * The intrinsic inventory is split across two files by necessity — the resolver
 * verifies keys and arities (`spec/intrinsics.md` §4.2), the emitter lowers them
 * (§8.3) — and nothing in the type system holds the halves together. This file
 * does, ahead of time, so a key added to one and forgotten in the other is a red
 * test rather than an emitted `undefined` discovered at runtime.
 */
describe("the inventory and its lowerings agree", () => {
  /**
   * Every key is declared through a real door in privileged source and compiled.
   * A key with no lowering trips the emitter's backstop diagnostic; a key whose
   * declared arity disagrees with the inventory trips the resolver's.
   *
   * The declaration is deliberately typed `Int -> ... -> Int` rather than with
   * each key's true signature: §4.2 makes the *declaration* normative and keeps
   * types out of any compiler-side table, so a table-consistency test must not
   * quietly reintroduce one. Only existence and arity are checked here, which is
   * exactly what the compiler itself checks.
   */
  test.each(
    [...INTRINSIC_INVENTORY].flatMap(([key, entry]) =>
      entry.grade === "operation" ? [{ key, arity: entry.arity }] : []
    ),
  )(
    "`$key` has a lowering and accepts its declared arity",
    ({ key, arity }) => {
      const parameters = Array.from(
        { length: arity },
        (_unused, index) => `argument${index}: Int`,
      ).join(", ");
      const diagnostics = compileProject([
        new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"),
        // The explicit host grant below gives this source the registered
        // prelude member's privilege (§5.2).
        // `Debug.hex` and not another: it is **last** in the prelude order, so
        // replacing it with a door-only module takes nothing out from under a
        // later member. `Result.hex` served until `JsValue.hex` seated after
        // it and started answering with a `Result` (FFI Part 11 §4.1).
        new Source.File(
          Source.fileId(1),
          "/Debug.hex",
          "module Debug\n\n" + 'extern from "hex:intrinsic"\n' +
          `    export fun ${key} as declared(${parameters}) -> Int\n`,
        ),
      ], { trustedStandardLibraryModules: new Set(["Debug"]) }).diagnostics;
      expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([]);
    },
  );

  test("every key follows §4.1's `<companion><Operation>` lowerCamel convention", () => {
    for (const key of INTRINSIC_INVENTORY.keys()) {
      expect(key).toMatch(/^[a-z][A-Za-z0-9]*$/u);
    }
  });

  /**
   * §4.1's key space is flat and **compiler-global across both grades** (#927):
   * one space, two grades. A key spelled at both would make the wrong-grade
   * diagnostic unstatable — it names the one thing a key is — so the two lists
   * partition the map rather than overlapping it.
   */
  test("the two grades partition one flat key space (§4.1)", () => {
    const operations = intrinsicKeys("operation");
    const types = intrinsicKeys("type");
    expect(operations.filter((key) => types.includes(key))).toEqual([]);
    expect(new Set([...operations, ...types])).toEqual(new Set(INTRINSIC_INVENTORY.keys()));
    expect(types).toEqual(["buffer"]);
  });

  /**
   * A **type** key's row carries two things a `fun` row's does not, and both are
   * verified at the declaration site: an arity in type parameters, and the list
   * of modules permitted to declare it (§3.3, §4.1). The whole of that list is
   * compiled here in its real role — the declarer is a real runtime module, and
   * the source is the shipped file — so a row that drifted from its entry is a
   * red test rather than a refusal nobody meets until the engine lands.
   */
  test.each([...INTRINSIC_INVENTORY].flatMap(([key, entry]) =>
    entry.grade === "type" ? [{ key, entry }] : []
  ))(
    "intrinsic type `$key` is declared by every module its entry names",
    ({ key, entry }) => {
      expect(entry.grade).toBe("type");
      if (entry.grade !== "type") return;
      for (const declarer of entry.declarers) {
        // The one declarer today is `Runtime.Regex`, whose shipped file is
        // compiled in its real seat below. A second declarer joining the entry
        // without a row would fail here at the source lookup.
        expect(declarer).toBe("Runtime.Regex");
      }
      expect(regexRuntimeSource).toContain(`type ${key} as `);
    },
  );
});

describe("the nearest-key suggestion", () => {
  test("offers a genuinely close key", () => {
    expect(nearestIntrinsicKey("seqMemoise", "operation")).toBe("seqMemoize");
    expect(nearestIntrinsicKey("seqMemoize", "operation")).toBe("seqMemoize");
  });

  /**
   * §4.2: the search is **grade-scoped**. `bufferLength` is an operation key one
   * edit from nothing at the type grade, so a `type` row misspelling it is
   * offered `buffer` — the only type key — and never an operation it could not
   * take, which would draw the wrong-grade refusal on the next compile.
   */
  test("searches the row's own grade only", () => {
    expect(nearestIntrinsicKey("bufer", "type")).toBe("buffer");
    expect(nearestIntrinsicKey("bufferLenght", "operation")).toBe("bufferLength");
    // The very key that is nearest at the other grade is not offered here.
    expect(nearestIntrinsicKey("bufferLenght", "type")).toBeUndefined();
    expect(nearestIntrinsicKey("buffe", "operation")).toBeUndefined();
  });

  /**
   * A confidently wrong suggestion is worse than none: an author who typed a key
   * for an operation the compiler does not provide is better served by "no such
   * intrinsic" than by being pointed at an unrelated one.
   */
  test("declines to guess when nothing is close", () => {
    expect(nearestIntrinsicKey("mapInsert", "operation")).toBeUndefined();
    expect(nearestIntrinsicKey("", "operation")).toBeUndefined();
  });
});
