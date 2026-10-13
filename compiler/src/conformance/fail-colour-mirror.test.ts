/**
 * Step 8a's mirror (`support/mirror.ts`), always on for these programs: until
 * the fail colour has spellings and sources of its own, `->!` gives an arrow
 * both colours and `->` neither, so every fail colour mirrors its world colour
 * (Effects §1), and what the two colours report about one site is one report.
 * Each program reaches a step of the machinery the fail colour runs on its
 * own; the whole suite runs the type check under `HEX_MIRROR`.
 */

import { describe, expect, it } from "vitest";
import { mirrorDivergence } from "../support/mirror.js";
import { compileFiles } from "../support/test-project.js";

const world = `extern from "./world.js"
    export fun save(document: String) ->! Unit
`;

const prelude = "module Main\n\n" + world + "let save0(): Unit = save!(\"x\")\n";

/**
 * Every module's divergence, and how many reports the main module made, each
 * one once: a report two colours made about one site is one report.
 */
function mirrored(source: string): { readonly divergences: readonly string[]; readonly reports: number } {
  const project = compileFiles([["/world.js", ""], ["/main.hex", prelude + source]]);
  const divergences: string[] = [];
  let reports = 0;
  for (const module of project.modules) {
    const divergence = mirrorDivergence(module.typed);
    if (divergence !== undefined) divergences.push(`${module.source.path}: ${divergence}`);
    if (module.source.path !== "/main.hex") continue;
    const keys = module.typed.diagnostics.map(({ message, primary }) =>
      `${primary.start.offset}:${primary.end.offset} ${message}`
    );
    const twice = keys.find((key, index) => keys.indexOf(key) !== index);
    if (twice !== undefined) divergences.push(`/main.hex reports twice: ${twice}`);
    reports += keys.length;
  }
  return { divergences, reports };
}

describe("the fail colour mirrors the world colour (step 8a)", () => {
  it("at a known instance whose member takes a callback", () => {
    expect(mirrored(`constraint Run<a> =
    with(r: a, f: () ->! Unit) ->! Unit
export record Job = { n: Int }
honor Run<Job> =
    with(job, f) = f!()
export let go(j: Job, f: () ->! Unit): Unit = with!(j, f)
`).divergences).toEqual([]);
  });

  it("at a `>->` face its body refuses, which reads as its fix on both colours", () => {
    const { divergences, reports } = mirrored(`export let mk(cb: () ->! Unit): () >-> Unit = () => save!("x")
export let use(): Unit = mk(() => ())!()
`);
    expect(divergences).toEqual([]);
    expect(reports).toBeGreaterThan(0);
  });

  it("at a `>->` face over a body in error", () => {
    expect(mirrored(`export let mk(cb: () ->! Unit): () >-> Unit = () => nowhere!()
export let use(): Unit = mk(() => ())!()
`).divergences).toEqual([]);
  });

  it("at a refused tie, whose parameters read as their fix", () => {
    const { divergences, reports } = mirrored(`fun b(f, g, c: Bool, n: Int): Unit =
    let h = if c then f else g
    h!()
    if n <= 0 then () else b!(f, g, c, n - 1)
`);
    expect(divergences).toEqual([]);
    expect(reports).toBeGreaterThan(0);
  });

  it("at a knot refused for handing on a function it made, silenced on both colours", () => {
    // Its close's tie report is discarded on each colour: the fail colour's
    // copy left behind would be a report of its own.
    expect(mirrored(`fun b(f, g, c: Bool, n: Int): Unit =
    let h = if c then f else g
    h!()
    if n <= 0 then () else b!(f, g, c, n - 1)
    if n <= 0 then () else b!(() => (), g, c, n - 1)
`).divergences).toEqual([]);
  });

  it("at a constraint seat whose body does more than its contract", () => {
    const { divergences, reports } = mirrored(`constraint Each<a> =
    each(r: a, f: () ->! Unit) >-> Unit
export record Job = { n: Int }
honor Each<Job> =
    each(job, f) =
        save!("x")
        f!()
`);
    expect(divergences).toEqual([]);
    expect(reports).toBeGreaterThan(0);
  });
});

describe("the mirror check", () => {
  const arrow = (effect: unknown, fail: unknown) => ({ kind: "Function", parameters: [], result: {}, effect, fail });

  it("refuses a fail colour that is the world colour itself", () => {
    expect(mirrorDivergence([arrow({ variable: 1 }, { variable: 1 })])).toContain("stands on both colours");
    expect(mirrorDivergence([arrow({ variable: 1 }, { variable: 2 }), arrow({ variable: 2 }, { variable: 3 })]))
      .toContain("stands on both colours");
  });

  it("refuses a variable twinned two ways, and names the earlier twin", () => {
    expect(mirrorDivergence([arrow({ variable: 1 }, { variable: 2 }), arrow({ variable: 1 }, { variable: 4 })]))
      .toContain("already twinned with fail v2");
  });

  it("pairs a join's parts by their twins, whatever order they were made in", () => {
    expect(mirrorDivergence([
      arrow({ variable: 3 }, { variable: 2 }),
      arrow({ join: [1, 3] }, { join: [2, 4] }),
      arrow({ variable: 1 }, { variable: 4 }),
    ])).toBeUndefined();
  });
});
