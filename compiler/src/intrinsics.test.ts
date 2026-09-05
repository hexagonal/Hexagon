import { describe, expect, test } from "vitest";

import { compileProject, Source } from "./index";
import { INTRINSIC_INVENTORY, nearestIntrinsicKey } from "./intrinsics";

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
  test.each([...INTRINSIC_INVENTORY].map(([key, arity]) => ({ key, arity })))(
    "`$key` has a lowering and accepts its declared arity",
    ({ key, arity }) => {
      const parameters = Array.from(
        { length: arity },
        (_unused, index) => `argument${index}: Int`,
      ).join(", ");
      const diagnostics = compileProject([
        new Source.File(Source.fileId(0), "/main.hex", "module Main\n\n" + "export let ok: Int = 1\n"),
        // A prelude injection path, so the module is privileged (§5.2).
        // `Debug.hex` and not another: it is **last** in the prelude order, so
        // replacing it with a door-only module takes nothing out from under a
        // later member. `Result.hex` served until `JsValue.hex` seated after
        // it and started answering with a `Result` (FFI Part 11 §4.1).
        new Source.File(
          Source.fileId(1),
          "/Debug.hex",
          "module Debug\n\n" + 'extern from "hex:intrinsic"\n' +
          `    export fun ${key} as declared(${parameters}): Int\n`,
        ),
      ]).diagnostics;
      expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([]);
    },
  );

  test("every key follows §4.1's `<companion><Operation>` lowerCamel convention", () => {
    for (const key of INTRINSIC_INVENTORY.keys()) {
      expect(key).toMatch(/^[a-z][A-Za-z0-9]*$/u);
    }
  });
});

describe("the nearest-key suggestion", () => {
  test("offers a genuinely close key", () => {
    expect(nearestIntrinsicKey("seqMemoise")).toBe("seqMemoize");
    expect(nearestIntrinsicKey("seqMemoize")).toBe("seqMemoize");
  });

  /**
   * A confidently wrong suggestion is worse than none: an author who typed a key
   * for an operation the compiler does not provide is better served by "no such
   * intrinsic" than by being pointed at an unrelated one.
   */
  test("declines to guess when nothing is close", () => {
    expect(nearestIntrinsicKey("mapInsert")).toBeUndefined();
    expect(nearestIntrinsicKey("")).toBeUndefined();
  });
});
