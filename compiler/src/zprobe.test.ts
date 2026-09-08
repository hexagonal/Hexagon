/** Scratch probe — deleted before delivery. */
import { test } from "vitest";
import { writeFileSync } from "node:fs";
const OUT: string[] = [];
import { compileFiles } from "./support/test-project.js";
import { AnalysisSession } from "./analysis/session.js";

const IO = 'extern from "./io.js"\n    export fun readIt(path: String): String\n\n';

function report(label: string, source: string): void {
  const text = "module Main\n\n" + source;
  const result = compileFiles([["/main.hex", text], ["/io.js", ""]]);
  OUT.push(`\n=== ${label} ===`);
  for (const d of result.diagnostics) {
    OUT.push(
      `  [${d.severity}] ${d.message}\n      @ ${JSON.stringify(text.slice(d.primary.start.offset, d.primary.end.offset))}`,
    );
  }
  if (result.diagnostics.length === 0) OUT.push("  (clean)");
}

function hover(source: string, needle: string): void {
  const text = "module Main\n\n" + source;
  const session = new AnalysisSession();
  session.setFile("/io.js", "");
  session.setFile("/main.hex", text);
  OUT.push(`  hover ${JSON.stringify(needle)}: ${session.hover("/main.hex", text.indexOf(needle))?.displayedType}`);
}

test("probe", () => {
  // 1a — nested `->?` under a `->!` outer arrow, body narrows it.
  report(
    "1a narrower acceptance under ->! outer",
    "constraint Within<t> =\n" +
    "    within(t: t, action: () ->? Unit) ->! Unit\n" +
    "export record Db = { name: String }\n" +
    "fun force(f: () -> Unit): Unit = f()\n" +
    "honor Within<Db> =\n    within(t, action) = force(action)\n",
  );
  // 1b — two callers, one `->!` one `->`.
  report(
    "1b two callers of a nested-linked member",
    IO +
    "constraint Within<t> =\n" +
    "    within(t: t, action: () ->? Unit) ->! Unit\n" +
    "export record Db = { name: String }\n" +
    "honor Within<Db> =\n    within(t, action) = action?()\n" +
    "export let a(d: Db): Unit = within!(d, () => Debug.log(\"x\"))\n" +
    "export let b(d: Db): Unit = within!(d, () => readIt!(\"x\") |> Debug.log)\n",
  );
  // 1c — join-shaped contract.
  report(
    "1c join-shaped contract",
    IO +
    "constraint Within<t> =\n" +
    "    within(t: t, action: () ->? Unit) ->! Unit\n" +
    "export record Db = { name: String }\n" +
    "honor Within<Db> =\n    within(db, action) =\n        Debug.log(readIt!(db.name))\n        action?()\n",
  );
  // 2 — `->?` member with a widens door.
  report(
    "2 door on a `->?` member",
    "constraint Run<t> =\n" +
    "    go(t: t, action: () ->? Unit) ->? Unit\n" +
    "export record Job = { id: BigInt }\n" +
    "widens Run.go(t: Job, action: () ->? Unit): Unit = action?()\n" +
    "honor Run<Job> =\n    go = widened\n",
  );
  // 4 — data-nested arrow frame.
  report(
    "4 data-nested arrow",
    IO +
    "constraint Fns<a> =\n" +
    "    fns(x: a) -> Vector((Int) -> String)\n" +
    "export record P = { name: String }\n" +
    "honor Fns<P> =\n    fns(x) = [(n: Int) => readIt!(\"x\")]\n",
  );
  // 5 — article.
  report(
    "5 article",
    "constraint R<t> =\n" +
    "    go(t: t, cb: () ->? Unit) -> Unit\n" +
    "export record P = { name: String }\n" +
    "fun force(f: () -> Unit): Unit = f()\n" +
    "honor R<P> =\n    go(t, cb) = force(cb)\n",
  );
  // 6 — Invalid leaks.
  report("6a bare arrow", "constraint R<a> =\n    m(x: a) ->\n");
  report("6b fat arrow", "constraint R<a> =\n    m(x: a) => String\n");
  // 3 — nested-arrow refusal placement.
  report(
    "3 nested-arrow placement",
    IO +
    "constraint Mk<a> =\n" +
    "    make(x: a) -> ((Int) -> String)\n" +
    "export record P = { name: String }\n" +
    "honor Mk<P> =\n    make(x) = (n: Int) => readIt!(\"x\")\n",
  );
  hover(
    "constraint Run<t> =\n" +
    "    go(t: t, action: () ->? Unit) ->? Unit\n" +
    "export record Job = { id: BigInt }\n" +
    "widens Run.go(t: Job, action: () ->? Unit): Unit = action?()\n" +
    "honor Run<Job> =\n    go = widened\n",
    "widens Run.go",
  );
  writeFileSync("/tmp/probe.txt", OUT.join("\n"));
});
