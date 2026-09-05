export interface PlaygroundExample {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  readonly specificationReferences: readonly string[];
}

export const helloWorld: PlaygroundExample = {
  id: "hello-world",
  title: "A Tour of Hexagon",
  description: "A commented tour of the language slices implemented so far.",
  source: `// Every file declares its module, and the name is the module's identity.
module Main

// Unions describe a closed set of alternatives.
union Suit =
    | Clubs
    | Diamonds
    | Hearts
    | Spades

// Tuples combine values with different types.
let card = (10, Hearts)

// Patterns unpack structured values.
let (rank, suit) = card

// Module-level parameters form an explicit inference boundary.
let greet(name: String) = "Hello, " ++ name ++ "!"

// Private constraints remain inferred.
let greet2(thing: a) = "Hello, \${thing}!"

// Private return types remain inferred.
let plus(x: Int, y: Int) = x + y

// Recursive functions use fun.
fun factorial(n: Int) =
    if n <= 1 then
        1
    else
        n * factorial(n - 1)

// Match handles every union alternative.
let color(suit: Suit) = match suit
    Clubs => "black"
    Diamonds => "red"
    Hearts => "red"
    Spades => "black"

// log writes to the debugging console; the call produces Unit.
Debug.log(greet("Hexagon"))
Debug.log(greet2(5))
`,
  specificationReferences: [],
};
