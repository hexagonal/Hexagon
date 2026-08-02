import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { BASE_PROPERTY_SEED, propertySeed, recordedPropertySeed } from "./property-seed.js";

describe("propertySeed", () => {
  test("is stable for a path and different across paths", () => {
    expect(propertySeed(198, "src/passes/lexer/lexer.test.ts")).toBe(
      propertySeed(198, "src/passes/lexer/lexer.test.ts"),
    );
    expect(propertySeed(198, "src/passes/lexer/lexer.test.ts")).not.toBe(
      propertySeed(198, "src/passes/parser/parser.test.ts"),
    );
  });

  test("gives the nine property files nine distinct seeds", () => {
    const files = [
      "src/passes/lexer/lexer.test.ts",
      "src/passes/layout/layout.test.ts",
      "src/passes/parser/parser.test.ts",
      "src/passes/resolver/resolver.test.ts",
      "src/passes/checker/checker.test.ts",
      "src/passes/elaborator/elaborator.test.ts",
      "src/passes/emitter/emitter.test.ts",
      "src/support/source.test.ts",
    ];
    const seeds = files.map((file) => propertySeed(BASE_PROPERTY_SEED, file));

    expect(new Set(seeds).size).toBe(files.length);
  });

  test("never returns a seed below its base", () => {
    // The hash is folded through `>>> 0`, so a sign bit cannot pull the seed
    // backwards past the base and collide with a neighbouring file's.
    fc.assert(
      fc.property(fc.string(), (path) => {
        expect(propertySeed(BASE_PROPERTY_SEED, path)).toBeGreaterThanOrEqual(BASE_PROPERTY_SEED);
      }),
    );
  });
});

/**
 * The pin is worth nothing if fast-check never received it, and nothing else in
 * the suite would notice: `fc.configureGlobal` validates nothing, and
 * `vitest.setup.ts` is outside `tsconfig.json`'s `include`, so a misspelled key
 * there is neither a type error nor a test failure. The properties would go
 * quietly back to running unseeded — which is #198 itself.
 *
 * Asserting against what the setup file recorded, rather than a literal, keeps
 * this true under `HEXAGON_PROPERTY_SEED` as well.
 */
test("the suite is really running seeded", () => {
  const recorded = recordedPropertySeed();

  expect(recorded).toBeTypeOf("number");
  expect(fc.readConfigureGlobal().seed).toBe(recorded);
});
