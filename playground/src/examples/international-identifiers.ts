import type { PlaygroundExample } from "./hello-world";

export const internationalIdentifiers: PlaygroundExample = {
  id: "international-identifiers",
  title: "International Names: T · C · M",
  description: "A later showcase of Hindi and Mandarin names using the optional T/C/M cultural convention.",
  source: `// Playground-only workspace block: a real virtual गणित.hex module.
// Its contents stay at column one; the repeated name closes it deliberately.
module Mगणित
export fun जोड़(left: Int, right: Int): Int = left + right
end module Mगणित

// Caseless scripts are ordinary term names. Uppercase Latin prefixes
// are a readable cultural convention for Hexagon's uppercase-start roles.

// T = type or constructor. The type name is Hindi; its fields mix Hindi and Chinese.
record Tउपयोगकर्ता = {नाम: String, 城市: String}

// C = constraint. The constraint and member names are Mandarin Chinese.
constraint C可显示<a> =
  显示(value: a): String

honor C可显示<Tउपयोगकर्ता> =
  显示(उपयोगकर्ता) = उपयोगकर्ता.नाम ++ " · " ++ उपयोगकर्ता.城市

let 展示<a: C可显示>(value: a): String = 显示(value)
let 用户 = Tउपयोगकर्ता({नाम: "अनाया", 城市: "上海"})

// JavaScript's $ and _ identifier starts are ordinary term bindings too.
let $税率 = 0.10
let _折扣 = 5

// M = module alias. The block above implicitly imports its virtual file.
console.log(展示(用户), Mगणित.जोड़(20, 22), $税率, _折扣)
`,
  specificationReferences: [
    "spec/lexer.md §3",
    "spec/constraints.md §2",
    "spec/modules.md §3.3",
  ],
};
