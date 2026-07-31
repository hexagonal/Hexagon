/**
 * Conformance for Lexer & Layout §2.2's group-closing rule: a `)`/`]`/`}` ends
 * every layout block its group opened.
 *
 * This was defect-log finding 5. The offside rule closes blocks on dedented
 * lines, and a group's closer may share a line with the block's last item, so
 * `Seq({ pull = () => match x` … `A => y })` left the arm block open at the `}`
 * — the parser then read `}` as the next arm's pattern. The design note's
 * canonical `Seq` combinators (`seq-core-representation.md` §4.1) are written in
 * exactly that shape and did not compile as printed.
 *
 * The assertions are byte-identity of emitted JavaScript against the spelling
 * that closes by dedent. Accepting both spellings is not the claim; the claim is
 * that they are the same program.
 */
import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";

function compile(source: string) {
  const project = compileProject([new Source.File(Source.fileId(0), "/main.hex", source)]);
  const module = project.modules.find(({ source: file }) => file.path === "/main.hex");
  return {
    diagnostics: project.diagnostics.map(({ message }) => message),
    javascript: module?.javascript.text,
  };
}

const PRELUDE = "export let step(source: Seq(Int)): Option((Int, Seq(Int))) =\n";

describe("a closing delimiter ends the blocks its group opened", () => {
  test("a match arm block closed by `})` is the same program as one closed by dedent", () => {
    const trailing = compile(
      PRELUDE +
      "    Seq.next(Seq.map(source, x => x)) \n" +
      "export let m(source: Seq(Int)): Seq(Int) =\n" +
      "    Seq.map(source, value => match Some(value)\n" +
      "        None => 0\n" +
      "        Some(v) => v)\n",
    );
    const dedented = compile(
      PRELUDE +
      "    Seq.next(Seq.map(source, x => x)) \n" +
      "export let m(source: Seq(Int)): Seq(Int) =\n" +
      "    Seq.map(source, value =>\n" +
      "        match Some(value)\n" +
      "            None => 0\n" +
      "            Some(v) => v\n" +
      "    )\n",
    );

    expect(trailing.diagnostics).toEqual([]);
    expect(dedented.diagnostics).toEqual([]);
    expect(trailing.javascript).toBe(dedented.javascript);
  });

  test("a record-literal field value behaves the same as a call argument", () => {
    const record = compile(
      "export record Box = { value: Int }\n" +
      "export let b(flag: Bool): Box =\n" +
      "    Box({ value = match flag\n" +
      "        True => 1\n" +
      "        False => 0 })\n",
    );
    const call = compile(
      "export record Box = { value: Int }\n" +
      "export let b(flag: Bool): Box =\n" +
      "    Box({ value = match flag\n" +
      "        True => 1\n" +
      "        False => 0\n" +
      "    })\n",
    );

    expect(record.diagnostics).toEqual([]);
    expect(record.javascript).toBe(call.javascript);
  });

  test("one closer unwinds nested blocks, and the result still typechecks", () => {
    const { diagnostics } = compile(
      "let identity(value: Int): Int = value\n" +
      "export let f(a: Bool, b: Bool): Int =\n" +
      "    identity(match a\n" +
      "        True => match b\n" +
      "            True => 1\n" +
      "            False => 2\n" +
      "        False => 3)\n",
    );

    expect(diagnostics).toEqual([]);
  });

  test("blocks opened before the group are untouched by its closer", () => {
    // The arm block predates the `{`, so `}` must not close it — `False` is
    // still a sibling arm, not a stray item after the match.
    const { diagnostics } = compile(
      "export record Box = { value: Int }\n" +
      "export let f(flag: Bool): Int =\n" +
      "    match flag\n" +
      "        True => Box({ value = 1 }).value\n" +
      "        False => 0\n",
    );

    expect(diagnostics).toEqual([]);
  });

  test("an unmatched closer is still an error, not an unwind", () => {
    const { diagnostics } = compile(
      "export let f(flag: Bool): Int =\n" +
      "    match flag\n" +
      "        True => 1)\n" +
      "        False => 0\n",
    );

    expect(diagnostics).not.toEqual([]);
  });
});
