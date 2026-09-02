import type { PlaygroundExample } from "./hello-world";

export const records: PlaygroundExample = {
  id: "records",
  title: "Records and Rows",
  description: "Annotate open records, update them immutably, and destructure selected fields.",
  source: `fun guestName(reservation: {guest: String, ...}) = reservation.guest

fun renameGuest(reservation: {guest: String, ...rest}, guest: String) =
    {reservation with guest = guest}

fun confirmedGuest(reservation: {guest: String, confirmed: Bool}) = match reservation
    {confirmed = True, guest} => guest
    {guest} => guest

let dinner = {guest = "Ada", seats = 2}
let lunch = {guest = "Grace", vegetarian = True, seats = 1}
let note = "window table"
let preference = {note}
let renamedDinner = renameGuest(dinner, "Augusta")
let updatedDinner = {renamedDinner with seats = 3}
let {guest, seats} = updatedDinner

Debug.log("\${guest} now has \${seats} seats")
Debug.log("Preference: \${preference.note}")
Debug.log(guestName(lunch))
Debug.log(confirmedGuest({guest = "Lin", confirmed = True}))
`,
  specificationReferences: ["spec/products.md"],
};
