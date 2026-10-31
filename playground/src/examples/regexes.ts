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
// compiled once per load, not at every call.
//
// (?P<year>...) captures under a name as well as a number; (?<year>...) is
// the same group. ^ and $ anchor the match to the whole string.
let isoDate = Regex.compile("^(?P<year>[0-9]{4})-(?P<month>[0-9]{2})-(?P<day>[0-9]{2})$")

// Regex.find answers the leftmost match, or None. Regex.named reads one named
// group from it, which is an Option too: a group in an alternative the match
// did not take has no text.
let check(text: String) = match isoDate
    Err(error) => Debug.log("bad pattern: \${error}")
    Ok(regex) => match Regex.find(regex, text)
        None => Debug.log("\${text}: not an ISO date")
        Some(found) =>
            let part(name: String) = match Regex.named(found, name)
                Some(group) => group.text
                None => "?"
            Debug.log("\${text}: year \${part("year")}, month \${part("month")}, day \${part("day")}")

check("2026-10-31")
check("31/10/2026")
check("2026-1-5")
check("x2026-10-31")

// The pattern checks the shape, not the calendar: month 13 still matches.
check("2026-13-45")

// When only yes or no matters, Regex.isMatch answers a Bool.
match isoDate
    Ok(regex) => Debug.log("is 1999-12-31 a date? \${Regex.isMatch(regex, "1999-12-31")}")
    Err(error) => Debug.log("bad pattern: \${error}")
`,
  specificationReferences: ["spec/regex.md"],
};
