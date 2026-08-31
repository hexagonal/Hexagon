import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// Comments are stripped before anything is matched. A selector is read as
// "everything since the last brace", so a comment *about* a rule lands inside
// the selector text of the rule that follows it — which made the first version
// of this file pass against the very `* { box-sizing: border-box }` it exists to
// reject, because the comment names the class the test looks for.
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8")
  .replaceAll(/\/\*[\s\S]*?\*\//gu, "");

/** Every selector that sets `property`, with the value it sets. */
function rulesSetting(property: string): readonly { selector: string; value: string }[] {
  const rules: { selector: string; value: string }[] = [];
  const declaration = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([a-z-]+)`, "u");
  for (const match of styles.matchAll(/([^{}]+)\{([^}]*)\}/gu)) {
    const value = declaration.exec(match[2] ?? "")?.[1];
    if (value !== undefined) {
      rules.push({ selector: (match[1] ?? "").trim(), value });
    }
  }
  return rules;
}

function boxSizingRules(): readonly { selector: string; value: string }[] {
  return rulesSetting("box-sizing");
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

/**
 * The second thing a browser would catch and no unit test of behaviour can.
 *
 * `hidden` is a presentation hint the user agent implements as `display: none`
 * in its own stylesheet, so any `display` an author stylesheet gives the same
 * element outranks it. An element this file lays out with `display` and the
 * script hides with `element.hidden = true` therefore needs its own `[hidden]`
 * rule, or setting the property sets an attribute and changes nothing on screen.
 *
 * Measured on the generated-sections panel: delete `.build-report[hidden]` and
 * every test in the playground suite stays green while the panel renders 43.2px
 * tall on a module that has nothing to report — the failure is silent, cosmetic,
 * and reachable by deleting three lines, which is this file's remit (#256).
 */
describe("the hidden guards", () => {
  // The panel and the view control inside it. Both are laid out and both are
  // toggled from `renderBuildReport`; `.zero-entry-points` beside them is
  // toggled too and sets no `display`, so the attribute alone still hides it and
  // it is not listed here.
  for (const selector of [".build-report", ".js-view-control"]) {
    test(`${selector} is hidden by the attribute it is toggled with`, () => {
      const laidOut = rulesSetting("display").find((rule) => rule.selector === selector);
      const guard = rulesSetting("display").find(
        (rule) => rule.selector === `${selector}[hidden]`,
      );

      // The guard is owed only because the base rule sets a display at all. If
      // that ever stops being true this assertion is the thing that says so,
      // rather than the test quietly passing over an element it no longer covers.
      expect(laidOut).toBeDefined();
      expect(laidOut?.value).not.toBe("none");
      expect(guard?.value).toBe("none");
    });
  }
});
