import type { PlaygroundExample } from "./hello-world";

export const patterns: PlaygroundExample = {
  id: "patterns",
  title: "Unions and Match",
  description: "A closed union handled by an exhaustive match expression.",
  source: `// derives (Show) asks the compiler for the display operation
// interpolation needs, so a constructor can be printed by name.
union Direction derives (Show) =
    | North
    | East
    | South
    | West

let opposite(direction: Direction) = match direction
    North => South
    East => West
    South => North
    West => East

Debug.log("Opposite of North: \${opposite(North)}")

fun attendanceLabel(count: Int) = match count
    0 => "none"
    1 => "one"
    _ => "many"

Debug.log("Guests: \${attendanceLabel(1)}")

fun tupleLabel(pair: (Bool, Int)) = match pair
    (True, _) => "active"
    (_, _) => "inactive"

fun unitLabel(value: Unit) = match value
    () => "unit"

Debug.log("\${tupleLabel((True, 3))} \${unitLabel(())}")
`,
  specificationReferences: ["spec/unions.md", "spec/pattern-matching.md"],
};
