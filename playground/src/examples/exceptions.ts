import type { PlaygroundExample } from "./hello-world";

export const exceptions: PlaygroundExample = {
  id: "exceptions",
  title: "Exceptions",
  description:
    "Throw and catch exceptions, bind their payloads, and let the ones a catch does not name rethrow themselves.",
  source: `// A file may declare several modules (Modules §2.2), and a module sees only
// what it imports — so this one is written first and imported below.
module Ledger

export exception Overdrawn(balance: Int, message: String)

export let withdraw(balance: Int, amount: Int): Int =
    if amount > balance then
        throw(Overdrawn(balance, "insufficient funds"))
    else
        balance - amount

end module Ledger

module Main

import Ledger

// An exception declaration adds one constructor to Exn, the language's only
// open sum -- which is what lets every union stay closed. A message slot must
// be a String, and it becomes the underlying Error's own message, so uncaught
// output reads "SettingError: no such setting".
exception SettingError(setting: String, message: String)
exception NoSettings

let settings = Map.fromVector([("host", "localhost"), ("port", "8080")])

// throw is an ordinary function, not a keyword. It never returns, so it types
// as whatever its position asks for -- here, the String the other arm gives.
let setting(key: String): String = match Map.get(settings, key)
    Some(value) => value
    None => throw(SettingError(key, "no such setting"))

// Constructing is not throwing: an Exn is an ordinary value. The stack is
// captured here, at the construction, not at the throw below.
let complaint = SettingError("theme", "no such setting")

// try/catch is an expression -- the body and every arm agree on one type. Arms
// are match arms: constructor patterns binding the payload slots positionally.
let excuse = try
    throw(complaint)
catch
    SettingError(key, why) => "\${key}: \${why}"

Debug.log(excuse)

// No _ arm, and none is wanted: whatever a catch does not name is rethrown for
// you. The inner catch names only NoSettings, so this SettingError walks
// straight past it into the outer one.
let report = try
    try
        setting("locale")
    catch
        NoSettings => "no settings were loaded"
catch
    SettingError(key, _) => "\${key} is unset"

Debug.log(report)

// The prelude throws too, and its exceptions are caught by their qualified
// names. In the JS view the brand names the declaring module, so this arm
// catches Vector's IndexError and no other module's.
let sizes = [10, 20, 30]

let clamped = try
    sizes.at(4)
catch
    Vector.IndexError(_, size) => sizes.at(size)

Debug.log("the fourth of three sizes: \${clamped}")

// The module declared at the top of this file is imported like any other, and
// its exception is caught the same qualified way.
let remaining = try
    "\${Ledger.withdraw(100, 250)} left"
catch
    Ledger.Overdrawn(balance, why) => "\${why}; \${balance} left"

Debug.log(remaining)
`,
  specificationReferences: ["spec/exceptions.md", "spec/pattern-matching.md"],
};
