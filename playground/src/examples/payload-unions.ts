import type { PlaygroundExample } from "./hello-world";

export const payloadUnions: PlaygroundExample = {
  id: "payload-unions",
  title: "Payload Unions",
  description: "Construct tagged values and bind their payloads in an exhaustive match.",
  source: `union Shape =
  | Circle(radius: Float)
  | Rectangle(width: Float, height: Float)
  | Point

fun area(shape: Shape): Float = match shape
  Circle(radius) when radius <= 0.0 => 0.0
  Circle(radius) => 3.14159 * radius * radius
  Rectangle(width, height) => width * height
  Point => 0.0

fun preserve(shape: Shape): Shape = match shape
  Circle(_) as whole => whole
  Rectangle(_, _) as whole => whole
  Point as whole => whole

console.log("Circle area:", area(preserve(Circle(3.0))))

union Reply =
  | Accepted(details: (String, Int))
  | Rejected(error: {message: String, code: Int})

fun describe(reply: Reply): String = match reply
  Accepted((name, _)) => name
  Rejected({message: reason}) => reason

console.log(describe(Accepted(("Ada", 2))))
`,
  specificationReferences: ["spec/unions.md", "spec/pattern-matching.md"],
};
