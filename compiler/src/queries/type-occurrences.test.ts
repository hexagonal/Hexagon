import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { check } from "../passes/checker/checker.js";
import { compileProject } from "../project.js";
import { collectTypeOccurrences } from "./type-occurrences.js";

describe("collectTypeOccurrences", () => {
  test("reports declarations and references throughout typed value syntax", () => {
    const text =
      "record Person = {name: String, age: Int}\n" +
      "honor Show<Person> =\n" +
      "    show(person) = person.name\n" +
      "let identity(value) = value\n" +
      "let ada = Person({name = \"Ada\", age = 36})\n" +
      "let answer = identity(ada).age\n" +
      "let numbers: Seq(Int) = Seq.iterate(1, number => number + 1)\n" +
      "let selected = numbers.map(number => number + 1)\n" +
      "let qualifiedRound = Float.roundEven(2.5)\n" +
      "let dottedRound = 2.5.roundEven()\n" +
      "for item in selected\n" +
      "    Debug.log(\"${item}\")\n";
    // Through `compileProject`, because `Seq(a)` is a prelude declaration now
    // (Loops §6.6) and the passes called directly cannot see the prelude.
    const HEADER = "module Hover\n\n";
    const project = compileProject([new Source.File(Source.fileId(0), "/hover.hex", HEADER + text)]);
    const module = project.modules.find(({ source }) => source.path === "/hover.hex")!.typed;

    expect(project.diagnostics).toEqual([]);
    const occurrences = collectTypeOccurrences(module);
    const at = (spelling: string, offset: number) =>
      occurrences.find(({ name, span }) => name === spelling && span.start.offset === HEADER.length + offset);

    expect(at("identity", text.indexOf("identity"))?.displayedType).toBe("a -> a");
    expect(at("identity", text.lastIndexOf("identity"))?.displayedType).toBe("a -> a");
    expect(at("value", text.indexOf("value"))?.displayedType).toBe("a");
    expect(at("value", text.indexOf("value", text.indexOf("value") + 1))?.displayedType).toBe("a");
    expect(at("Person", text.indexOf("Person"))?.displayedType).toBe(
      "{name: String, age: Int} -> Person",
    );
    expect(at("Person", text.lastIndexOf("Person"))?.displayedType).toBe(
      "{name: String, age: Int} -> Person",
    );
    expect(at("name", text.indexOf("name"))?.displayedType).toBe("String");
    expect(at("age", text.indexOf("age"))?.displayedType).toBe("Int");
    expect(at("show", text.indexOf("show"))?.displayedType).toBe("Person -> String");
    expect(at("age", text.lastIndexOf("age"))?.displayedType).toBe("Int");
    // Dot-call syntax supplies the first argument during elaboration, but the
    // operation identifier still denotes the declaration and therefore keeps
    // the declaration's complete scheme in hover.
    expect(at("map", text.indexOf("map"))?.displayedType).toBe(
      "(Seq(a), a -> b) -> Seq(b)",
    );
    const qualifiedRound = at("roundEven", text.indexOf("roundEven"));
    const dottedRound = at("roundEven", text.lastIndexOf("roundEven"));
    expect(qualifiedRound?.displayedType).toBe("Float -> Int");
    expect(dottedRound?.displayedType).toBe("Float -> Int");
    expect(dottedRound?.symbol).toBe(qualifiedRound?.symbol);
    expect(dottedRound?.receiverBound).toBe(true);
    expect(at("number", text.indexOf("number =>"))?.displayedType).toBe("Int");
    expect(at("item", text.indexOf("item"))?.displayedType).toBe("Int");
    expect(at("item", text.lastIndexOf("item"))?.displayedType).toBe("Int");
  });
});
