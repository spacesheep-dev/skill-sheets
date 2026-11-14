# The sheet's JSON block

The space's whole sheet is one JSON object inside
`<script type="application/json" id="sheet-data">`. With a shell you write it as
`data.json` plus `cells/NN-<what>.json` batches, and `sheet.js` puts it in the page. It
must stay valid JSON: no comments, no trailing commas, and double quotes everywhere.

In `data.json` only, two more fields are the page's words, kept out of the block: `lede`
(one or two sentences above the grid) and `description` (one line for links and search).
In `data.json` and in a batch, a key may be one column or one row (`"F2:F200"`,
`"B5:M5"`): its value goes in every cell of it, a formula with its relative references
moved for each cell, as Excel's fill does.

## The top level

| Field | What it holds | Example |
|---|---|---|
| `title` | The sheet's name, also used for download file names | `"Office move budget"` |
| `currency` | `GBP`, `USD` or `EUR`, from the person's own words or symbols | `"EUR"` |
| `locale` | How numbers and dates read: `en-GB`, `en-US`, `de-DE`, `fr-FR` | `"en-GB"` |
| `saved_at` | When you last saved, UTC, ISO 8601 | `"2026-11-12T09:30:00Z"` |
| `edited` | Cells you changed, each with the `saved_at` of that change. Keep old entries | `{"Costs!C4": "2026-11-12T09:30:00Z"}` |
| `before` | This version only: each changed input cell's old value, `null` if it was empty | `{"Costs!C4": 1200}` |
| `change_note` | One line on this version's change; leave out for a new sheet | `"Movers' quote raised to €1,450"` |
| `tabs` | The tabs, in order | see below |

A key in `edited` can be a cell (`"Costs!C4"`), a range (`"Costs!C2:C9"`) or a whole tab
(`"Quotes"`). The page outlines the cells whose time equals `saved_at`, and lets that
change win over people's edits made before it.

## A tab

| Field | What it holds |
|---|---|
| `name` | The tab's name: short, at most 31 characters, none of `[ ] : * ? / \` |
| `freeze` | How many top rows stay visible while scrolling, usually `1` |
| `cols` | One entry per column from A: `{"w": 140, "fmt": "money"}`. `w` is the width in px; `fmt` is optional |
| `cells` | A map from address to content. See "Cells" |
| `lists` | Drop-downs: `[{"range": "D2:D200", "values": ["planned", "booked", "paid"]}]` |
| `checks` | Checkbox ranges: `["F2:F200"]`. A ticked box is `true` |
| `rules` | Highlights: `[{"range": "A2:F200", "if": "=$E2>$D2", "style": "bad"}]` |
| `charts` | `[{"type": "bar", "title": "…", "labels": "A2:A13", "series": [{"name": "Rent", "range": "B2:B13"}], "fmt": "money"}]` |

Give `lists` and `checks` ranges that run past the data, so new rows get the control too.

## Cells

The address is in capitals (`"B2"`). The content is one of these:

- **A number:** `1200`, `0.2`. Never `"£1,200"`.
- **Text:** `"Movers"`.
- **A date:** `"2027-03-01"`, always year-month-day. It is stored as a real date, so
  formulas, sorting and the .xlsx all treat it as one.
- **A formula:** a string starting with `=`, such as `"=SUM(C2:C40)"`. Escape inner quotes
  in JSON: `"=COUNTIF(D2:D200,\"paid\")"`.
- **true or false:** for checkbox cells.
- **An object,** when one cell needs more: `{"v": 1200, "fmt": "money2", "b": true}`.
  `v` is the value (or formula), `fmt` overrides the column's format, and `b` makes it bold.

Leave empty cells out of `cells`.

## Formats (`fmt`)

| `fmt` | Shows | In the .xlsx |
|---|---|---|
| `money` | £1,200 (the sheet's currency, no pence) | `"£"#,##0` |
| `money2` | £1,200.50 | `"£"#,##0.00` |
| `int` | 1,200 | `#,##0` |
| `num` | 1,200.50 | `#,##0.00` |
| `pct` | 20% (the cell holds 0.2) | `0%` |
| `pct1` | 20.5% | `0.0%` |
| `date` | 1 Mar 2027 | `d mmm yyyy` |
| `month` | Mar 2027 | `mmm yyyy` |

With no format, numbers show as they are. Dates with no format show as `date`. Formats
apply only to numbers, so a header row in a `money` column is fine.

## Highlight styles

`bad` (red tint), `warn` (amber), `good` (green). Use `bad` only for what the ask calls a
problem (overdue, over budget). The first rule that matches a cell wins.

## Charts

`type` is `bar` or `line`. `labels` is the range of the category names (months, teams).
Each series is one range of numbers the same length as `labels`, and it is drawn from
computed values. Charts appear under the grid of their own tab. They are not in the .xlsx.

## A full small example

An office-move budget with a quote list and a summary.

```json
{
  "title": "Office move budget",
  "currency": "EUR",
  "locale": "en-GB",
  "saved_at": "2026-11-12T09:30:00Z",
  "edited": {},
  "tabs": [
    {
      "name": "Costs",
      "freeze": 1,
      "cols": [{"w": 180}, {"w": 120}, {"w": 110, "fmt": "money"}, {"w": 110, "fmt": "money"}, {"w": 110}, {"w": 90}],
      "cells": {
        "A1": "Item", "B1": "Supplier", "C1": "Quote", "D1": "Paid", "E1": "Status", "F1": "Due",
        "A2": "Movers", "B2": "Example supplier", "C2": 1450, "D2": 0, "E2": "booked", "F2": "2027-01-15",
        "A3": "New desks", "B3": "Example supplier", "C3": 3200, "D3": 3200, "E3": "paid", "F3": "2026-12-01",
        "A4": "Cabling", "B4": "Example supplier", "C4": 900, "D4": 0, "E4": "planned", "F4": "2026-12-20"
      },
      "lists": [{"range": "E2:E200", "values": ["planned", "booked", "paid"]}],
      "checks": [],
      "rules": [{"range": "A2:F200", "if": "=AND($F2<>\"\",$F2<TODAY(),$E2<>\"paid\")", "style": "bad"}],
      "charts": []
    },
    {
      "name": "Summary",
      "freeze": 1,
      "cols": [{"w": 160}, {"w": 120, "fmt": "money"}],
      "cells": {
        "A1": "Measure", "B1": "Amount",
        "A2": "Quoted", "B2": "=SUM(Costs!C2:C200)",
        "A3": "Paid", "B3": "=SUM(Costs!D2:D200)",
        "A4": "Still to pay", "B4": "=B2-B3",
        "A5": "Items not booked", "B5": {"v": "=COUNTIF(Costs!E2:E200,\"planned\")", "fmt": "int"}
      },
      "lists": [], "checks": [], "rules": [], "charts": []
    }
  ]
}
```

The same sheet after "the movers now want €1,600" changes one input cell, and records it:

```json
  "saved_at": "2026-11-12T11:05:00Z",
  "edited": {"Costs!C2": "2026-11-12T11:05:00Z"},
  "before": {"Costs!C2": 1450},
  "change_note": "Movers' quote raised to €1,600",
```

Here `Costs!C2` becomes `1600`. The space outlines C2 and lists Summary!B2 (Quoted) and
Summary!B4 (Still to pay), each with its old and new value.
