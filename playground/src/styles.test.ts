import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Comments are stripped before anything is matched. A selector is read as
// "everything since the last brace", so a comment *about* a rule lands inside
// the selector text of the rule that follows it — which made the first version
// of this file pass against the very `* { box-sizing: border-box }` it exists to
// reject, because the comment names the class the test looks for.
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8")
  .replaceAll(/\/\*[\s\S]*?\*\//gu, "");

/** Every selector that sets `box-sizing`, with the value it sets. */
function boxSizingRules(): readonly { selector: string; value: string }[] {
  const rules: { selector: string; value: string }[] = [];
  for (const match of styles.matchAll(/([^{}]+)\{([^}]*)\}/gu)) {
    const declarations = match[2] ?? "";
    const value = /box-sizing\s*:\s*([a-z-]+)/u.exec(declarations)?.[1];
    if (value !== undefined) {
      rules.push({ selector: (match[1] ?? "").trim(), value });
    }
  }
  return rules;
}

/**
 * The one thing a browser would catch and no unit test can: a `*` reset reaching
 * into Monaco.
 *
 * This cannot check the rendering, and does not try. It checks the property the
 * rendering depends on — that the reset names Monaco's container in an
 * exclusion — because the failure it guards is silent, cosmetic, and reachable
 * by writing four characters (#256). It cost a bug report on the live site to
 * find the first time.
 */
describe("the box-sizing reset", () => {
  test("does not reach inside Monaco", () => {
    const forcing = boxSizingRules().filter(({ value }) => value === "border-box");

    expect(forcing).not.toEqual([]);
    for (const { selector } of forcing) {
      // Monaco's own stylesheet assumes the default box model and sets
      // `border-box` where it wants it. A reset that reaches its subtree
      // silently resizes any widget Monaco measures in script and then sizes.
      expect(selector).toContain(".monaco-editor-host");
    }
  });

  test("keeps the specificity a bare `*` had", () => {
    // `:not()` takes the specificity of its most specific argument, so naming
    // the exclusions directly would make this reset outrank a later, deliberate
    // `box-sizing` rule for one of this file's own classes.
    for (const { selector } of boxSizingRules()) {
      if (!selector.includes(":not(")) continue;
      expect(selector).toContain(":not(:where(");
    }
  });
});
