import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain } from "../support/test-project.js";
import { STDLIB_SOURCES } from "../stdlib-sources.js";

/**
 * Conformance for **program I/O** (`spec/program-io.md`, #1461): `Hex.File`,
 * `Hex.Stdio` and `Hex.Process` as a program imports them, and the `String`
 * additions their writers rely on.
 *
 * What needs a process of its own — a writer's endings under a closed pipe and
 * a full disk, the arguments under each way of running Node, and the status a
 * program finishes with — is `scripts/test-program-io.mjs`'s, run after the
 * build. Everything here runs inside the test process: compiling, and `File`
 * against a directory of its own.
 */

describe("the three modules are imported, and carry their colours", () => {
  test("each resolves by import, and keeps its Node bindings private", () => {
    const project = compileMain(`module Main
import File
import Stdio
import Process
export let read(path: String): String = File.readText!(path)
export let say(text: String): Unit = Stdio.writeLine~(text)
export let count(): Int = Process.arguments~().length()
`);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    for (const [name, specifier] of [
      ["Hex.File", "node:fs"], ["Hex.Stdio", "node:fs"], ["Hex.Process", "node:process"],
    ] as const) {
      const module = project.modules.find((candidate) => candidate.name === name)!;
      expect(module.javascript.text).toContain(`from "${specifier}"`);
      expect(module.declarations.text).not.toMatch(/readFileSync|writeFileSync|writeSync|execArgv/u);
    }
  });

  test("a program that imports none of them imports no Node module", () => {
    const project = compileMain("module Main\nexport let answer: Int = 42\n");
    expect(project.diagnostics).toEqual([]);
    expect(project.modules.some(({ javascript }) => /from "node:/u.test(javascript.text))).toBe(false);
  });

  test("a module used without its import is refused as any unimported module is", () => {
    expect(projectDiagnostics('module Main\nexport let read(path: String): String = File.readText!(path)\n')
      .length).toBeGreaterThan(0);
  });

  test.each([
    ["File.readText(path)", "!"],
    ["File.readTextLossy(path)", "!"],
    ['File.writeText(path, "x")', "!"],
    ['File.writeTextBom(path, "x")', "!"],
    ["Stdio.write(path)", "~"],
    ["Stdio.writeLine(path)", "~"],
    ["Stdio.writeError(path)", "~"],
    ["Stdio.writeErrorLine(path)", "~"],
    ["Process.arguments()", "~"],
    ["Process.setExitStatus(1)", "~"],
  ])("an unmarked `%s` is refused, wanting `%s`", (call, mark) => {
    const diagnostics = projectDiagnostics(
      `module Main\nimport File\nimport Stdio\nimport Process\nexport let work(path: String) = ${call}\n`,
    );
    expect(diagnostics.join("\n")).toContain(`wants \`${mark}\``);
  });

  const originals = import.meta.glob("../../../stdlib/{File,Stdio,Process}.hex", {
    eager: true, query: "?raw", import: "default",
  }) as Record<string, string>;

  test("the embedded modules are their canonical sources", () => {
    expect(Object.keys(originals)).toHaveLength(3);
    for (const source of Object.values(originals)) {
      const name = /^module\s+(\S+)/u.exec(source)![1]!;
      expect(STDLIB_SOURCES[name]).toBe(source);
    }
  });
});

/**
 * `File` against a directory of its own. The program's exports take the path,
 * and each failure comes back as one line naming the reason, the path and the
 * message, so every pin reads as `spec/program-io.md` §3.4's tables do.
 */
const FILE_PROGRAM = `module Main
import File

let reasonOf(reason: File.FileErrorReason): String = match reason
    File.NotFound => "NotFound"
    File.PermissionDenied => "PermissionDenied"
    File.IsDirectory => "IsDirectory"
    File.NotDirectory => "NotDirectory"
    File.NotUtf8 => "NotUtf8"
    File.Other(code) => "Other(\${code})"

let failure(reason: File.FileErrorReason, path: String, message: String): String =
    "\${reasonOf(reason)} | \${path} | \${message}"

export let read(path: String): String = try "read: " ++ File.readText!(path) catch
    File.FileError(reason, path, message) => failure(reason, path, message)
    other => "unexpected: \${other}"

export let readLossy(path: String): String = try "read: " ++ File.readTextLossy!(path) catch
    File.FileError(reason, path, message) => failure(reason, path, message)
    other => "unexpected: \${other}"

export let write(path: String, text: String): String =
    try
        File.writeText!(path, text)
        "written"
    catch
        File.FileError(reason, path, message) => failure(reason, path, message)
        other => "unexpected: \${other}"

export let writeBom(path: String, text: String): String =
    try
        File.writeTextBom!(path, text)
        "written"
    catch
        File.FileError(reason, path, message) => failure(reason, path, message)
        other => "unexpected: \${other}"

export let missingOrEmpty(path: String): String = try File.readText!(path) catch
    File.FileError(File.NotFound, _, _) => ""

export let surrogateAt(path: String, text: String): String =
    try
        File.writeText!(path, text)
        "written"
    catch
        LoneSurrogateFault(message, position) => "\${position} | \${message}"

export let surrogateBomAt(path: String, text: String): String =
    try
        File.writeTextBom!(path, text)
        "written"
    catch
        LoneSurrogateFault(_, position) => "\${position}"

export let repaired(text: String): String = text.toWellFormed()
`;

describe("File", () => {
  let program: Record<string, (...values: string[]) => string>;
  let root: string;
  const at = (name: string): string => join(root, name);
  const bytes = (name: string, ...values: number[]): string => {
    writeFileSync(at(name), Buffer.from(values));
    return at(name);
  };

  beforeAll(async () => {
    program = await runMain(FILE_PROGRAM) as typeof program;
    root = mkdtempSync(join(tmpdir(), "hex-file-"));
    mkdirSync(at("dir"));
    writeFileSync(at("plain.txt"), "plain");
  }, 120_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("each reason, with a message naming the path", () => {
    expect(program.read!(at("missing.txt"))).toBe(`NotFound | ${at("missing.txt")} | not found: ${at("missing.txt")}`);
    expect(program.read!(at("dir"))).toBe(`IsDirectory | ${at("dir")} | is a directory: ${at("dir")}`);
    expect(program.read!(at("plain.txt/x"))).toBe(
      `NotDirectory | ${at("plain.txt/x")} | not a directory: ${at("plain.txt/x")}`,
    );
    expect(program.write!(at("nowhere/x.txt"), "x")).toBe(
      `NotFound | ${at("nowhere/x.txt")} | not found: ${at("nowhere/x.txt")}`,
    );
    const long = at("x".repeat(300));
    expect(program.read!(long)).toBe(`Other(ENAMETOOLONG) | ${long} | ENAMETOOLONG: name too long, open '${long}'`);
  });

  // Root reads through a missing permission, so this holds only for an ordinary user.
  test.skipIf(process.getuid?.() === 0)("a file the user may not read is PermissionDenied", async () => {
    const { chmodSync } = await import("node:fs");
    writeFileSync(at("private.txt"), "secret");
    chmodSync(at("private.txt"), 0o000);
    expect(program.read!(at("private.txt"))).toBe(
      `PermissionDenied | ${at("private.txt")} | permission denied: ${at("private.txt")}`,
    );
  });

  test("a strict read refuses bytes that aren't UTF-8, naming the first bad one", () => {
    const path = bytes("bad.txt", 0x61, 0xff, 0x62);
    expect(program.read!(path)).toBe(`NotUtf8 | ${path} | not UTF-8 at byte 2: ${path}`);
    expect(program.readLossy!(path)).toBe("read: a�b");
  });

  test.each([
    ["a sequence cut off at the end, at its first byte", [0x61, 0x62, 0xe2, 0x82], 3],
    ["a wrong continuation, at the sequence's first byte", [0x61, 0xe2, 0x28, 0xa1], 2],
    ["an overlong encoding", [0xc0, 0x80], 1],
    ["an encoded surrogate", [0xed, 0xa0, 0x80], 1],
    ["a codepoint past U+10FFFF", [0xf4, 0x90, 0x80, 0x80], 1],
    ["a lone continuation byte after a whole four-byte sequence", [0xf0, 0x9f, 0x98, 0x80, 0x80], 5],
    ["a bad byte after a BOM, counting the BOM", [0xef, 0xbb, 0xbf, 0xfe], 4],
  ])("the bad byte is found for %s", (_case, values, offset) => {
    const path = bytes("case.txt", ...values);
    expect(program.read!(path)).toBe(`NotUtf8 | ${path} | not UTF-8 at byte ${offset}: ${path}`);
  });

  test("both reads drop exactly one leading BOM, and keep everything else", () => {
    const one = bytes("bom.txt", 0xef, 0xbb, 0xbf, 0x61);
    expect(program.read!(one)).toBe("read: a");
    expect(program.readLossy!(one)).toBe("read: a");
    const two = bytes("bom2.txt", 0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61);
    expect(program.read!(two)).toBe("read: ﻿a");
    expect(program.readLossy!(two)).toBe("read: ﻿a");
    const only = bytes("bomonly.txt", 0xef, 0xbb, 0xbf);
    expect(program.read!(only)).toBe("read: ");
    writeFileSync(at("endings.txt"), "a\r\nb\rc\n\0d");
    expect(program.read!(at("endings.txt"))).toBe("read: a\r\nb\rc\n\0d");
  });

  test("writes are the text's exact bytes, replacing a longer file, with no BOM unless asked", () => {
    const text = "é😀﻿\0\r\nA";
    writeFileSync(at("out.txt"), "a much longer file than the text written over it");
    expect(program.write!(at("out.txt"), text)).toBe("written");
    expect(readFileSync(at("out.txt"))).toEqual(Buffer.from(text, "utf8"));
    expect(program.writeBom!(at("bom-out.txt"), text)).toBe("written");
    expect(readFileSync(at("bom-out.txt"))).toEqual(Buffer.from(`﻿${text}`, "utf8"));
    expect(program.read!(at("bom-out.txt"))).toBe(`read: ${text}`);
  });

  test("a program plans for a missing file by naming the reason", () => {
    expect(program.missingOrEmpty!(at("absent.txt"))).toBe("");
  });

  test("a lone surrogate is refused before anything is written", () => {
    writeFileSync(at("kept.txt"), "kept");
    expect(program.surrogateAt!(at("kept.txt"), "a😀b\uD800")).toBe(
      "4 | the text holds a lone surrogate at codepoint 4, which UTF-8 cannot write; " +
      "repair it with String.toWellFormed first",
    );
    expect(readFileSync(at("kept.txt"), "utf8")).toBe("kept");
    expect(program.surrogateBomAt!(at("kept.txt"), "\uDC00")).toBe("1");
    expect(readFileSync(at("kept.txt"), "utf8")).toBe("kept");
    expect(program.surrogateAt!(at("created.txt"), "\uD800")).toMatch(/^1 \| /u);
    expect(existsSync(at("created.txt"))).toBe(false);
  });

  test("toWellFormed replaces each lone surrogate, and keeps pairs and well-formed text", () => {
    expect(program.repaired!("a\uD800b😀\uDC00")).toBe("a�b😀�");
    expect(program.repaired!("plain é😀")).toBe("plain é😀");
  });
});

describe("Process.setExitStatus refuses a status Node would wrap", () => {
  test.each([256, -1])("%d throws ExitStatusFault before anything is set", async (status) => {
    const before = process.exitCode;
    const program = await runMain(`module Main
import Process
export let set(status: Int): String =
    try
        Process.setExitStatus~(status)
        "set"
    catch
        Process.ExitStatusFault(refused) => "refused \${refused}"
`) as { set: (status: number) => string };
    expect(program.set(status)).toBe(`refused ${status}`);
    expect(process.exitCode).toBe(before);
  }, 120_000);
});
