# Three worked cases

Each case shows the moves, not a sheet to copy. The JSON fragments leave out the fields
that don't change. `references/sheet-format.md` has the full block.

## 1. A sheet from one ask

> "Make a sheet for our flat's shared bills. Three of us: Ana, Ben, Cat. Each bill has a
> date, what it was, who paid and the amount. I want to see what each person paid and
> what they owe."

What you do:

1. **Plan the tabs.** "Bills" is where people type: date, item, paid by, amount. "Balance"
   is calculated: one row per person.
2. **Make "Paid by" a drop-down** of exactly the three names, because the Balance formulas
   match on them.
3. **Add three example bills,** marked as examples, because the ask gave no rows.
4. **Compute the balances.** Each person's share is the total over three. Their balance is
   what they paid minus their share. Both are formulas.

```json
{"name": "Bills", "freeze": 1,
 "cols": [{"w": 110, "fmt": "date"}, {"w": 200}, {"w": 110}, {"w": 110, "fmt": "money2"}],
 "cells": {"A1": "Date", "B1": "What", "C1": "Paid by", "D1": "Amount",
   "A2": "2026-11-01", "B2": "Example: rent", "C2": "Ana", "D2": 1800,
   "A3": "2026-11-03", "B3": "Example: electricity", "C3": "Ben", "D3": 96.4,
   "A4": "2026-11-05", "B4": "Example: broadband", "C4": "Cat", "D4": 38},
 "lists": [{"range": "C2:C500", "values": ["Ana", "Ben", "Cat"]}]},
{"name": "Balance", "freeze": 1,
 "cols": [{"w": 120}, {"w": 120, "fmt": "money2"}, {"w": 120, "fmt": "money2"}, {"w": 140, "fmt": "money2"}],
 "cells": {"A1": "Person", "B1": "Paid", "C1": "Share", "D1": "Owed to them",
   "A2": "Ana", "B2": "=SUMIF(Bills!C2:C500,A2,Bills!D2:D500)", "C2": "=SUM(Bills!D2:D500)/3", "D2": "=B2-C2",
   "A3": "Ben", "B3": "=SUMIF(Bills!C2:C500,A3,Bills!D2:D500)", "C3": "=SUM(Bills!D2:D500)/3", "D3": "=B3-C3",
   "A4": "Cat", "B4": "=SUMIF(Bills!C2:C500,A4,Bills!D2:D500)", "C4": "=SUM(Bills!D2:D500)/3", "D4": "=B4-C4",
   "A6": "Check: balances sum to zero", "D6": "=ROUND(SUM(D2:D4),2)"},
 "rules": [{"range": "D2:D4", "if": "=D2<0", "style": "warn"}]}
```

The reply: "Your bills sheet is ready. Type each bill on Bills; Balance works out what
everyone paid and owes. The three bills are examples, so replace them. To let Ben and Cat
add bills, use Share and add them."

## 2. A change, with its record

> "Rent isn't equal any more: Ana has the big room and pays 40%, Ben and Cat 30% each.
> Only rent; split everything else equally. What changes?"

What you do:

1. **Read the JSON block** with `find: 'id="sheet-data"'`.
2. **Change only the formulas involved.** That means the Share column. Add an input column
   for the rent split at the right of Balance, so nothing people typed moves.
3. **Mark which bills are rent** without touching people's cells. Put the rule in the
   formula: a bill is rent when its "What" contains "rent".
4. **Record the change:** `saved_at`, `edited`, `before` and `change_note`.

```json
"cells": { "...": "...",
  "F1": "Rent split", "F2": 0.4, "F3": 0.3, "F4": 0.3,
  "C2": "=SUMIF(Bills!B2:B500,\"*rent*\",Bills!D2:D500)*F2+SUMIF(Bills!B2:B500,\"<>*rent*\",Bills!D2:D500)/3",
  "C3": "=SUMIF(Bills!B2:B500,\"*rent*\",Bills!D2:D500)*F3+SUMIF(Bills!B2:B500,\"<>*rent*\",Bills!D2:D500)/3",
  "C4": "=SUMIF(Bills!B2:B500,\"*rent*\",Bills!D2:D500)*F4+SUMIF(Bills!B2:B500,\"<>*rent*\",Bills!D2:D500)/3" },
"saved_at": "2026-11-12T18:20:00Z",
"edited": {"Balance!C2:C4": "2026-11-12T18:20:00Z", "Balance!F1:F4": "2026-11-12T18:20:00Z"},
"before": {"Balance!C2": "=SUM(Bills!D2:D500)/3", "Balance!C3": "=SUM(Bills!D2:D500)/3", "Balance!C4": "=SUM(Bills!D2:D500)/3",
           "Balance!F1": null, "Balance!F2": null, "Balance!F3": null, "Balance!F4": null},
"change_note": "Rent split 40/30/30; other bills split equally"
```

Give column F the `pct` format. The reply: "Rent is now split 40/30/30 (column F on
Balance, so you can change it), and other bills still split three ways. The space lists
every balance that moved under 'What changed in this version'." Don't work out the new
balances yourself. The engine lists them with their old and new values.

## 3. A cleaned import that a team keeps working in

> "Here's last month's support export (pasted below). Clean it up, give me tickets per
> week by team, and let the team tick tickets off when they're resolved. Anything open
> more than 7 days should stand out."

What you do:

1. **Count and clean.** Count the rows, say 48. Remove exact duplicates (say 3, rows 12,
   30 and 41), and note them on a Notes tab. Write every date as YYYY-MM-DD: the export
   mixed `12/10/2026` and `2026-10-12`, and you read the slashes day-first because some
   days are over 12. Keep the 45 clean rows on "Tickets".
2. **Make "Resolved" a checkbox column,** and make "Team" a drop-down of the teams found
   in the file.
3. **Highlight open tickets older than 7 days** with a rule over the whole row.
4. **Build the weekly counts as formulas.** Put week starts down column A on "By week",
   one column per team, using COUNTIFS with the date bounds.

```json
{"name": "Tickets", "freeze": 1,
 "cols": [{"w": 90}, {"w": 110, "fmt": "date"}, {"w": 110}, {"w": 260}, {"w": 90}],
 "cells": {"A1": "Ticket", "B1": "Opened", "C1": "Team", "D1": "Subject", "E1": "Resolved",
   "A2": "T-1001", "B2": "2026-10-01", "C2": "Billing", "D2": "Card declined", "E2": true},
 "lists": [{"range": "C2:C500", "values": ["Billing", "Login", "Shipping"]}],
 "checks": ["E2:E500"],
 "rules": [{"range": "A2:E500", "if": "=AND($A2<>\"\",$E2<>TRUE,TODAY()-$B2>7)", "style": "bad"}]},
{"name": "By week", "freeze": 1,
 "cols": [{"w": 110, "fmt": "date"}, {"w": 90, "fmt": "int"}, {"w": 90, "fmt": "int"}, {"w": 90, "fmt": "int"}],
 "cells": {"A1": "Week of", "B1": "Billing", "C1": "Login", "D1": "Shipping",
   "A2": "2026-09-28", "A3": "=A2+7", "A4": "=A3+7", "A5": "=A4+7", "A6": "=A5+7",
   "B2": "=COUNTIFS(Tickets!$C$2:$C$500,B$1,Tickets!$B$2:$B$500,\">=\"&$A2,Tickets!$B$2:$B$500,\"<\"&$A2+7)"},
 "charts": [{"type": "bar", "title": "Tickets per week", "labels": "A2:A6",
   "series": [{"name": "Billing", "range": "B2:B6"}, {"name": "Login", "range": "C2:C6"}, {"name": "Shipping", "range": "D2:D6"}]}]}
```

B2's formula is repeated across B2:D6, with the references shifted. The reply gives the
counts first: "48 rows in, 3 duplicates removed, 45 kept, and dates unified." It then
names the three tabs, and says that ticks save for everyone signed in and red rows are
open over a week. A .xlsx comes from the download button. Don't attach one.
