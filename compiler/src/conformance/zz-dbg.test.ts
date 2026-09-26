import { it } from "vitest";
import { compileFiles } from "../support/test-project.js";
it("dbg", () => {
  compileFiles([["/w.js", ""], ["/main.hex", `module Main

extern from "./w.js"
    export fun save(document: String) ->! Unit

export let f(h: (Option((Int) ->? Int)) -> Int): Int = h(Some((x) =>
    save!("x")
    x))
`]]);
});
