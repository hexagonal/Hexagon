import type { PlaygroundExample } from "./hello-world";

export const patterns: PlaygroundExample = {
  id: "patterns",
  title: "Unions and Match",
  description: "A closed union handled by an exhaustive match expression.",
  source: `union Direction =
    | North
    | East
    | South
    | West

let opposite(direction: Direction) = match direction
    North => South
    East => West
    South => North
    West => East

console.log("Opposite of North:", opposite(North))

fun attendanceLabel(count: Int) = match count
    0 => "none"
    1 => "one"
    _ => "many"

console.log("Guests:", attendanceLabel(1))

fun tupleLabel(pair: (Bool, Int)) = match pair
    (true, _) => "active"
    (_, _) => "inactive"

fun unitLabel(value: Unit) = match value
    () => "unit"

console.log(tupleLabel((true, 3)), unitLabel(()))
`,
  specificationReferences: ["spec/unions.md", "spec/pattern-matching.md"],
};
