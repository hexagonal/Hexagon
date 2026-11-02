import type { PlaygroundExample } from "./hello-world";

export const regexes: PlaygroundExample = {
  id: "regexes",
  title: "Regular Expressions",
  description:
    "Compile a pattern, test strings against it, and read named captures from a match.",
  source: `module Regexes

import Regex

// A pattern is compiled by Regex.compile, which answers a Result: a pattern
// can be malformed, and the Err says why and where. The dialect is RE2's, so
// matching takes time linear in the text. A pattern written as a literal is
// compiled once per load, even inside a function called many times.
//
// (?<year>...) captures under a name as well as a number. ^ and $ anchor the
// match to the whole string.
//
// A pattern written into the program is unwrapped once, where it is compiled.
// A malformed one would be a bug in the program, not a failure a caller can
// plan for, so it is a fault, thrown with a plain throw: faults are not
// tracked, so the throw wears no ^ mark. Uncaught as the module loads, it
// stops the program before anything below runs, showing the Err's message
// and its position in the pattern. Every use below has the Regex itself. A
// pattern that arrives while the program runs, typed by a user, say, is
// unwrapped once where it arrives, with its Err shown rather than thrown.
fault BadPatternFault(message: String)

let isoDate: Regex = match Regex.compile("^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})$")
    Ok(regex) => regex
    Err(error) => throw(BadPatternFault(String.join([error.message, "(position: \${error.position})"], " ")))

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
`,
  specificationReferences: ["spec/regex.md", "spec/exceptions.md"],
};
