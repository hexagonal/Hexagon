import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

const TRUST_RAT = { trustedStandardLibraryModules: new Set(["Rat"]) } as const;

const TRUSTED_SOURCE = [
  "module Rat",
  "",
  "import Hash as H",
  "",
  "export union Key = First | Second",
  "honor Eq<Key> =",
  "    equals(left, right) = True",
  "honor H.Hash<Key> =",
  "    hash(value) = 0",
  "",
  "opaque record Secret = {n: Int}",
  "honor Eq<Secret> =",
  "    equals(left, right) = left.n == right.n",
  "honor H.Hash<Secret> =",
  "    hash(value) = value.n",
  "",
  "opaque record Amount = {number: Int, presentation: Nat}",
  "export let amount(number: Int, presentation: Nat): Amount = Amount({number, presentation})",
  "honor Eq<Amount> =",
  "    equals(left, right) = left.number == right.number",
  "honor H.Hash<Amount> =",
  "    hash(value) = value.number",
  "",
].join("\n");

describe("trusted standard-library hand-written Hash instances", () => {
  test("a trusted prelude member may own an opaque Decimal-shaped nominal", () => {
    const source = [
      "module Debug",
      "",
      "import Hash as H",
      "opaque record Decimal = {coefficient: BigInt, decimalPlaces: Nat}",
      "honor Eq<Decimal> =",
      "    equals(left, right) = left.coefficient == right.coefficient",
      "honor H.Hash<Decimal> =",
      "    hash(value) = 0",
      "",
    ].join("\n");
    expect(compileFiles([["/decimal.hex", source]], {
      trustedStandardLibraryModules: new Set(["Debug"]),
    }).diagnostics).toEqual([]);
  });

  test("a trusted registered member may hash records and unions it declares", () => {
    expect(compileFiles([["/replacement.hex", TRUSTED_SOURCE]], TRUST_RAT).diagnostics)
      .toEqual([]);
  });

  test("the identical source remains subject to the derivable-only rule without a grant", () => {
    expect(compileFiles([["/replacement.hex", TRUSTED_SOURCE]]).diagnostics.map(({ message }) => message))
      .toEqual([
        "`Hash` instances must be derived, and `derives Hash` requires a derived `Eq` — `Key` declares its own; key on a wrapper type whose `Eq` and `Hash` are both derived",
        "`Hash` instances must be derived, and `derives Hash` requires a derived `Eq` — `Secret` declares its own; key on a wrapper type whose `Eq` and `Hash` are both derived",
        "`Hash` instances must be derived, and `derives Hash` requires a derived `Eq` — `Amount` declares its own; key on a wrapper type whose `Eq` and `Hash` are both derived",
      ]);
  });

  test("Map and Set use the trusted equality and hash for equal representations", async () => {
    const main = [
      "module Main",
      "",
      "import Rat",
      "",
      "let short = Rat.amount(150, 2)",
      "let long = Rat.amount(150, 3)",
      "let keys: Set(Rat.Amount) = Set.fromVector([short, long])",
      "let first: Map(Rat.Amount, Int) = Map.set(Map.empty, short, 1)",
      "let replaced: Map(Rat.Amount, Int) = Map.set(first, long, 2)",
      "export let equal: Bool = short == long",
      "export let hashesEqual: Bool = Hash.hash(short) == Hash.hash(long)",
      "export let setSize: Int = Set.size(keys)",
      "export let mapSize: Int = Map.size(replaced)",
      "export let value: Int = replaced[short]",
      "",
    ].join("\n");
    const exports = await runProject(
      [["/replacement.hex", TRUSTED_SOURCE], ["/main.hex", main]],
      TRUST_RAT,
    );
    expect(exports["equal"]).toBe(true);
    expect(exports["hashesEqual"]).toBe(true);
    expect(exports["setSize"]).toBe(1);
    expect(exports["mapSize"]).toBe(1);
    expect(exports["value"]).toBe(2);
  });

  test("trust does not admit a hand-written Hash for an imported subject", () => {
    const replacement = [
      "module Rat",
      "",
      "honor Hash<Ordering> =",
      "    hash(value) = 0",
      "",
    ].join("\n");
    const messages = compileFiles(
      [["/replacement.hex", replacement]],
      TRUST_RAT,
    ).diagnostics.map(({ message }) => message);
    expect(messages).toContain(
      "orphan instance: this module declares neither `Hash` nor the instance subject",
    );
    expect(messages).toContain(
      "`Hash` instances must be derived; derivation is spelled on the subject's declaration, which is not in project source",
    );
  });

  test("a derived Hash beside hand-written Eq is still rejected in trusted source", () => {
    const source = [
      "module Rat",
      "",
      "record Key = {n: Int}",
      "honor Eq<Key> =",
      "    equals(left, right) = left.n == right.n",
      "honor Hash<Key> = derive",
      "",
    ].join("\n");
    expect(compileFiles([["/replacement.hex", source]], TRUST_RAT).diagnostics.map(({ message }) => message))
      .toContain(
        "cannot derive `Hash<Key>`: the subject has a hand-written `Eq` instance; a derived hash requires derived equality",
      );
  });
});
