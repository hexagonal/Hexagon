import { describe, expect, test } from "vitest";

import * as Source from "../support/source.js";
import { applyLayout } from "../passes/layout/layout.js";
import { lex } from "../passes/lexer/lexer.js";
import { parse } from "../passes/parser/parser.js";
import { resolve } from "../passes/resolver/resolver.js";
import { check } from "../passes/checker/checker.js";
import { collectTypeOccurrences } from "./type-occurrences.js";

describe("collectTypeOccurrences", () => {
  test("reports declarations and references throughout typed value syntax", () => {
    const text =
      "record Person = {name: String, age: Int}\n" +
      "honor Show<Person> =\n" +
      "  show(person) = person.name\n" +
      "let identity(value) = value\n" +
      "let ada = Person({name: \"Ada\", age: 36})\n" +
      "let answer = identity(ada).age\n" +
      "let numbers: Seq(Int) = Seq.iterate(1, number => number + 1)\n" +
      "let selected = numbers.map(number => number + 1)\n" +
      "for item in selected\n" +
      "  console.log(item)\n";
    const source = new Source.File(Source.fileId(0), "hover.hex", text);
    const module = check(resolve(parse(applyLayout(lex(source)))));

    expect(module.diagnostics).toEqual([]);
    const occurrences = collectTypeOccurrences(module);
    const at = (spelling: string, offset: number) =>
      occurrences.find(({ name, span }) => name === spelling && span.start.offset === offset);

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
    expect(at("map", text.indexOf("map"))?.displayedType).toBe(
      "(Int -> Int) -> Seq(Int)",
    );
    expect(at("number", text.indexOf("number =>"))?.displayedType).toBe("Int");
    expect(at("item", text.indexOf("item"))?.displayedType).toBe("Int");
    expect(at("item", text.lastIndexOf("item"))?.displayedType).toBe("Int");
  });
});
