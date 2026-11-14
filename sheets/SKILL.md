---
name: sheets
description: Use when someone wants a spreadsheet that people will keep working in, such as a budget, a tracker, a plan or a cleaned-up export, or brings rows as a CSV file or pasted from Excel. It builds the sheet as a space with tabs, formulas across tabs, number formats, drop-downs, checkboxes, highlights and charts that signed-in people edit together, with .xlsx and CSV downloads.
---

# Sheets

**First, before you read on:** run `node <this skill's folder>/assets/sheet.js -C <folder>
start <link> "<title>" "<tab>" "<tab>" …`, with the space the person gave you
(`start --new "<title>" "<tab>" …` with none), where `<folder>` is an empty folder you
work in. The title is the sheet's name in the person's words. The tabs are one for each
thing people fill in, and, listed first, one for what they only read, if the sheet needs
it: short and plain names in the person's words, at most 31 characters, none of
`[ ] : * ? / \`. Name them from the ask in a few seconds; you can rename one later. It puts the title, the tabs and a status on the space at once, and
prints the format you write. To change a sheet already in a space, give the link alone:
`start` then prints what you need for that.

**The person watches the sheet fill in.** A status and the named tabs within 20 seconds,
their formatted headers within 45, something new at least every 45 seconds, saved by 3
minutes. Plan one tab, write it, push it, then plan the next: never plan the whole sheet,
or all its rows, before the first rows go in.

You write the sheet's data, never the page: `data.json` (the sheet without its rows) and
`cells/NN-<what>.json` (one batch of rows each). `sheet.js` builds the page from the
starter this skill ships, and the starter's engine works out every formula.

## The first push: headers and formats, nothing else

`start` wrote `data.json` with the title and the tabs. Within 30 seconds of it, add to
each tab people fill in its `freeze: 1`, its `cols` (each column's width and format)
and its header cells in row 1, and to the sheet its `lede` (one or two sentences: what it
holds, who updates it, that the figures are examples), `description`, `currency` and
`locale`. Then, in the same command, `sheet.js push "Writing <the first tab>"`.

- Decide only the layout: which columns, where each table starts, each column's width and
  format. No rows, no amounts, no formulas.
- A tab people only read keeps its name only. Its headers and layout come when you write
  it, last.
- Inputs on the left, calculated columns on the right, one header row, frozen.
- A header that is a date is a typed date with its format, `{"v": "<date>", "fmt":
  "month"}` or `"date"`, so it never shows as a number.

**The first push prints the rest of this skill,** `references/build.md`: the rows,
formulas, examples, checks and your reply. Read it then, before you write any row:
`push` refuses rows until it has printed it.
