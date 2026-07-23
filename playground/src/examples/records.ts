import type { PlaygroundExample } from "./hello-world";

export const records: PlaygroundExample = {
  id: "records",
  title: "Records and Rows",
  description: "Annotate open records, update them immutably, and destructure selected fields.",
  source: `fun guestName(reservation: {guest: String, ...}) = reservation.guest

fun renameGuest(reservation: {guest: String, ...rest}, guest: String) =
    {...reservation, guest: guest}

fun confirmedGuest(reservation: {guest: String, confirmed: Bool}) = match reservation
    {confirmed: true, guest} => guest
    {guest} => guest

let dinner = {guest: "Ada", seats: 2}
let lunch = {guest: "Grace", vegetarian: true, seats: 1}
let note = "window table"
let preference = {note}
let renamedDinner = renameGuest(dinner, "Augusta")
let updatedDinner = {...renamedDinner, seats: 3}
let {guest, seats} = updatedDinner

console.log(guest, "now has", seats, "seats")
console.log("Preference:", preference.note)
console.log(guestName(lunch))
console.log(confirmedGuest({guest: "Lin", confirmed: true}))
`,
  specificationReferences: ["spec/products.md"],
};
