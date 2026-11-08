import type { PlaygroundExample } from "./hello-world";

export const regexes: PlaygroundExample = {
  id: "regexes",
  title: "Regular Expressions",
  description:
    "Compile a pattern, test strings against it, read named captures from a match, and check a pattern that arrives as data.",
  source: `module Regexes

import Regex
import Regex.Syntax

// A pattern written into the program is compiled with Regex.compile. The
// dialect is RE2's, so matching takes time linear in the text. A pattern
// written as a literal is compiled when the program is, and the program
// carries it already built, even inside a function called many times.
//
// A malformed pattern here would be a bug in the program, not a failure a
// caller can plan for. Written as a literal, it is refused when the program
// compiles, underlined where it goes wrong, with what to write instead. A
// pattern compile only meets when the program runs throws a fault,
// RegexCompileFault, so the call wears no mark.
//
// (?<year>...) captures under a name as well as a number. ^ and $ anchor the
// match to the whole string.
let isoDate: Regex = Regex.compile("^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})$")

// find answers the leftmost match, or None. named reads one named group from
// it, which is an Option too: a name the pattern does not define has none, and
// neither does a group in an alternative the match did not take. Both are
// called with a dot, on the regex and on the match.
let check(text: String) = match isoDate.find(text)
    None => Debug.log("\${text}: not an ISO date")
    Some(found) =>
        let part(name: String) = match found.named(name)
            Some(group) => group.text
            None => "?"
        Debug.log("\${text}: year \${part("year")}, month \${part("month")}, day \${part("day")}")

check("2026-10-31")
check("31/10/2026")
check("2026-1-5")
check("x2026-10-31")

// The pattern checks the shape, not the calendar: month 13 still matches.
check("2026-13-45")

// When only yes or no matters, isMatch answers a Bool.
Debug.log("is 1999-12-31 a date? \${isoDate.isMatch("1999-12-31")}")

// A pattern that arrives while the program runs, typed by a user, say, goes
// through Regex.parse. A bad one is a failure the program should plan for, so
// parse throws the exception RegexError, and its call is marked. Read with ?,
// the call answers an Option: None for text that is not a pattern.
let tryPattern(pattern: String) = match Regex.parse?(pattern)
    Some(regex) => Debug.log("\${pattern} is a pattern; on abc it says \${regex.isMatch("abc")}")
    None => Debug.log("\${pattern} is not a pattern")

tryPattern("a.c")
tryPattern("(a")

// To say why, catch RegexError by name: its message, and the position in the
// pattern of the defect it names. The other arm takes anything else.
let explain(pattern: String) =
    try
        Debug.log("\${pattern} has \${Regex.parse^(pattern).groupCount()} groups")
    catch
        Syntax.RegexError(message, position, _) => Debug.log("\${pattern}: \${message}, at position \${position}")
        other => Debug.log("\${pattern}: \${other}")

explain("(a)(b)")
explain("[z-a]")
`,
  specificationReferences: ["spec/regex.md", "spec/exceptions.md"],
};
