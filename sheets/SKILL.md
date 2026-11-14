---
name: sheets
description: Use when someone wants a spreadsheet that people will keep working in, such as a budget, a tracker, a plan or a cleaned-up export, or brings rows as a CSV file or pasted from Excel. It builds the sheet as a space with tabs, formulas across tabs, number formats, drop-downs, checkboxes, highlights and charts that signed-in people edit together, with .xlsx and CSV downloads.
---

# Sheets

You build and change spreadsheets that live in a space. A sheet here is a real working
sheet: tabs, cells, formulas that recalculate, drop-downs, checkboxes, highlights and
charts. Everyone signed in who can open the space can type in it, and anyone can download
it as .xlsx or CSV.

You never write the spreadsheet machinery. It ships with this skill as a template. You
write the sheet's data (tabs, cells, formulas, formats) as one JSON block, and the
template's engine works out every formula, draws the grid and saves people's edits.

## What a sheet is made of

- **One space is one workbook.** It is a copy of `references/sheet-template.html` with
  its JSON block filled in.
- **The JSON block is the only part you write or change:**
  `<script type="application/json" id="sheet-data">`. It holds the tabs, cells,
  drop-down lists, checkboxes, highlight rules, charts and the change record.
  Read `references/sheet-format.md` before you write or change one.
- **The engine works out every formula** when the space opens. It uses Excel's syntax
  and the functions in `references/functions.md`, and it marks error cells. You never
  compute a total yourself and type it in.
- **People's edits** (typing, drop-downs, ticks) are saved in the space's shared records,
  in a collection called `cells`. Each person has one record holding their edits.
  Everyone sees everyone's edits within about 15 seconds, and the page draws them over
  your values. Only signed-in people can edit. Anyone else sees the sheet read-only.
- **You can't read people's edits.** No tool in your turn reads a space's records. The
  source holds your values, not theirs. Never claim to know what someone typed, and
  build formulas that keep working whatever people type into the input cells.
- **Downloads are built into the space:** "Download CSV (this tab)" and "Download .xlsx
  (all tabs)". The .xlsx keeps formulas, number formats, drop-downs, highlights (as
  conditional formatting), column widths and frozen header rows. Charts stay in the space
  and are not in the .xlsx.
- **Every save is a new version.** The space's history can put back any earlier one,
  and a restore is itself a new version, so nothing is lost. People's edits live in the
  records, not in versions, so they survive a restore.

## When to use it, and when not

| The ask | What to do |
|---|---|
| A budget, tracker, plan, roster, model or log people will update | This skill |
| "Clean up this export", "make this CSV usable", a file of rows | This skill |
| A table that is only read, inside a report or a deck | No sheet: a plain table in that space |
| Charts on live company data (a warehouse, analytics) | Not this skill: the data skill |
| Collecting answers from many people who shouldn't see each other's | A form, not a sheet |

## Say plainly what it can't do

These don't exist tonight. Don't fake them, and don't promise them. Offer the nearest
thing instead.

- Pivot tables: offer a summary tab built with SUMIFS or COUNTIFS.
- Filter views, find and replace, sorting by several columns, protected ranges.
- Live data from connected apps, importing a Google Sheet by its link, and sending the
  sheet to Airtable, Asana or similar tools.
- Comments on a range: a comment pins to one cell.
- Edits appear for others within about 15 seconds, not instantly.
- Size: the page draws every row, so keep a tab under about 5,000 rows. Each person can
  keep about 32 KB of edits (a few hundred cells). For bigger data use the data skill.
- Sharing: you can't share the space or invite anyone. The person does it from Share.

## Build a new sheet

**The person watches the sheet fill in.** A status on the space within 10 seconds, the
tabs and headers on screen within 30, every row in by 2 minutes, saved by 3. Write a
part, push it, write the next: never the whole sheet before the first push.

You run one script, written in full every time: `node <this skill's folder>/assets/sheet.js
-C <folder> <step>`, short `sheet.js <step>` below, where `<folder>` is an empty folder you
work in. It talks to the space through the spacesheep CLI. You write only `data.json` and
`cells/NN-<what>.json` in that folder; `sheet.js` builds the page from the starter. Never
read, copy or write `references/sheet-template.html` yourself.

1. **Start at once,** before you read anything else: `sheet.js start <link>` with the
   space the person gave you, or `sheet.js start --new "<title>"` with none. It puts a
   status on the space.
2. **Read the ask.** Don't ask questions first. Use the person's own rows, numbers and
   names when they give them. When they give no rows, add a few rows marked as examples
   ("Example role"), and say in the lede and your reply that they're examples to replace.
   Never invent figures and present them as real.
3. **Plan the tabs.** Give each thing people update its own tab (one per team, one list
   of tasks). Put calculations people only read on their own tab ("Summary", "By
   month"). Keep inputs on the left and calculated columns on the right. Use one header
   row, frozen. Tab names are short and plain, at most 31 characters, with none of
   `[ ] : * ? / \`.
4. **Push the frame within 30 seconds.** Write `data.json` in one Write: the sheet's JSON
   (`references/sheet-format.md`) with every tab, its `freeze`, `cols` (widths and number
   formats), header cells, drop-downs (`lists`), checkboxes (`checks`), highlights
   (`rules`) and charts, plus `"lede"` (one or two sentences: what the sheet holds, who
   updates it, which rows are examples) and `"description"` (one line). No rows yet.
   Then `sheet.js push "Setting up <the tabs>"`: the page goes up and is saved.
5. **Push the rows in batches.** Each batch is one Write of `cells/01-<what>.json`, then
   `02-…` and on: `{"tab": "Transactions", "cells": {"A2": "2027-03-01", "B2": "Stock"}}`,
   one tab and at most 500 cells. Then `sheet.js push "<what is landing>"`, such as
   "Transactions: 12 example rows". Inputs first, then the formulas that read them, then
   summaries. Each batch shows on every open tab within a second, outlined.
   Write dates as `"2027-03-01"`, and numbers as plain numbers with no currency sign and
   no thousands commas. Every number that comes from other cells is a formula.
6. **Check once the first formulas are in,** not only at the end: `sheet.js check
   Summary!B4 Summary!B20` lists error cells and unknown functions, and prints each cell
   you name. Check two totals against what the rows should give. To fix a batch, write
   its file again and push.
7. **Save:** `sheet.js save "<what the sheet is>" "<one line: done>"`, then reply. The
   save sets `saved_at`; for a new sheet leave `edited` as `{}`, and leave out `before`
   and `change_note`.

Add a drop-down for any column with a fixed set of values (status, owner, priority,
channel), checkboxes for done or yes/no, highlights for anything the ask says should stand
out, and a chart only when the ask wants one or a trend is the point.

### Formulas

- Use Excel syntax: `=SUM(B2:B40)`, `=IF(D2="hired",C2,0)`. Use only the functions in
  `references/functions.md`. Anything else shows `#NAME?` in the space.
- Totals, counts, averages, rates, lookups and anything else derived are formulas.
  Never type a result.
- To refer to another tab, write `Sales!B2`, or quote a name with spaces:
  `'Q1 plan'!B2:B40`.
- Let ranges run past the data (to row 200) or use whole columns (`B:B`), so rows
  people add later are counted.
- Conditions in COUNTIFS, SUMIFS and the like are strings: `"open"`, `"<>done"`,
  `">="&B$1`.
- Work out dates with `DATE`, `EDATE`, `EOMONTH`, `YEAR` and `MONTH`. A date's quarter is
  `ROUNDUP(MONTH(B2)/3,0)`.
- One formula gives one value: nothing spills into other cells. Do sums over arrays only
  inside SUMPRODUCT, for example `=SUMPRODUCT((Tasks!C2:C200="Vlad")*(Tasks!E2:E200=TRUE))`.
- A highlight rule's `if` is written for the top-left cell of its range, and its relative
  references shift for every other cell. Use `$` to fix a column:
  `{"range": "A2:F200", "if": "=AND($C2<TODAY(),$E2<>TRUE)", "style": "bad"}`.
- Never make a formula refer to itself, directly or through other cells. It shows
  `#CYCLE!`.

## Change a sheet

1. **Read the JSON block.** Call `read_document_source` with `find: 'id="sheet-data"'`
   and `limit: 32000`. If the block goes on, read again from `next_offset`. A turn
   allows six reads, so read large windows.
2. **Change only what the ask names.** Make each change with `edit_document_source`:
   an exact old string and its new string, both inside the JSON block. Include enough
   of the line to match once. Batch related changes into one call (up to 20). Keep the
   JSON valid.
3. **Record the change** in the same batch:
   - `saved_at`: now, in UTC.
   - `edited`: for each input cell you changed, add `"Tab!A1": <saved_at>`. A range
     (`"Sales!B2:B9"`) or a whole new tab (`"Counts"`) works too. Keep the earlier
     entries.
   - `before`: the old value or formula of each input cell you changed in this version,
     with `null` for a cell that was empty. Replace the whole `before` map every time,
     because it holds only this version's changes.
   - `change_note`: one line saying what changed, in the person's words.
4. **Let the space show the effect.** The space outlines the cells you changed. Under
   the grid, "What changed in this version" lists every calculated cell whose value
   moved, with its old and new value, worked out by the engine. When the person asks
   what changed, point to that list. Don't work out new totals by hand.
5. **Keep people's edits in place.** People's edits are kept by cell address. Never
   insert rows or columns in the middle of data people edit, or their edits land on the
   wrong row. Add rows at the bottom and columns at the right. For a new layout, make a
   new tab.
6. **Know who wins a cell.** Your change to a cell beats edits people made to it before
   your change. Edits they make after it beat yours. If you change cells people fill in
   (a status, a tick, an owner), say so in your reply.

### Put back an earlier version

Point the person to the space's history to restore the version they want. The restore
saves a new version, and nothing is lost. If they ask you to undo your own last change
instead, do it in the JSON. Write each `before` value back, remove the cells and tabs
you added in that change (its `edited` entries carry that version's `saved_at`), and
record the undo as a new change. Either way, tell them that people's cell edits are kept
apart from versions, so they stay.

## Bring in rows from a file

When the person attaches a CSV or pastes rows, cleaning is your job, done while you write
the cells. Formulas can't delete rows or rewrite dates. You can't open an .xlsx file in a
turn: ask them to save it as CSV, or to copy the cells and paste them.

1. **Count the rows** you received, and say the number.
2. **Write every date as `YYYY-MM-DD`.** Note which formats you found. If a date like
   `03/04/2026` could be read two ways, follow the rest of the file and say which way you
   read it. If the file can't settle it, ask.
3. **Turn amounts into plain numbers.** Strip currency signs, thousands separators and
   stray spaces. Leave everything else as it was written.
4. **Remove duplicate rows after cleaning.** Two rows are duplicates when they match in
   every column once dates and amounts are cleaned. Keep the first of each, and note the
   original row numbers of the ones you removed.
5. **Lay out the tabs.** Put the clean rows in a data tab, under a frozen header row
   taken from the file. Add a "Notes" tab that lists what you changed: rows in, duplicates
   removed (with their original row numbers), date formats unified, rows kept.
6. **Build summaries as formulas over the data tab.** Use SUMIFS or COUNTIFS with month
   bounds, for example `=SUMIFS(Data!D:D,Data!B:B,$A2,Data!A:A,">="&B$1,Data!A:A,"<"&EDATE(B$1,1))`.
   Never use numbers you added up yourself.
7. **Lay out for a chart if one is wanted.** For "spend by channel by month", put months
   down the rows and one column per channel. The chart then reads each column as a series.

Files over about 5,000 rows don't belong in a sheet tonight. Say so, and suggest the data
skill.

## Working together

- Anyone signed in who can open the space can type in cells, pick from drop-downs and
  tick boxes. Their edits are saved for everyone. People who open it from a public link
  without signing in see it read-only.
- You can't share it. Tell the person how: Share, then add the person by email or
  @username. View access is enough to edit cells. Edit access also lets them change the
  sheet's layout through Shepherd.
- Give people controls rather than free text where you can: drop-downs for owners and
  statuses, checkboxes for done. They keep the data clean for COUNTIFS and highlights.
- A cell someone else edited shows a green mark on its left edge, with their name on
  hover. Cells you changed in the latest version are outlined.

## Questions about cells

- A comment pinned to a cell carries the cell's id, `c-<tab>-<cell>`. For example,
  `c-summary-b4` is Summary!B4 (the tab name is lowercased and spaces become hyphens).
  Answer about that cell first. Explain it from its formula and the cells it reads.
- For a range, the person names it in words or pins its first cell. Ask only if you
  can't tell which cells they mean.
- The JSON holds inputs and formulas, not computed values. When you state a computed
  value, say how you got it. When it depends on people's edits, ask them to read it in the
  space, because you can't see their edits.

## Checks before you finish

Go through every one, every time.

1. **The JSON parses.** Watch for trailing commas, unescaped quotes inside formulas
   (`\"`), and keys that are cell addresses in capitals (`"B2"`).
2. **Derived numbers are formulas.** No total, count or rate is a typed number.
3. **Formulas use only listed functions** and only ranges that exist. Cross-tab
   references use the exact tab names.
4. **Drop-downs hold exactly the values the ask gave,** spelled the same. A highlight or
   COUNTIF that tests a value uses the same spelling.
5. **For a change, only the asked-for cells moved,** and `saved_at`, `edited`, `before`
   and `change_note` are filled in.
6. **Look at the space if your turn can see it rendered.** Check the status line under
   the buttons: it must say "No error cells". If it lists cells, fix them. Look at it at
   phone and desktop widths. You can open a tab directly by adding `#tab=Summary` to the
   space's address.
7. **You wrote only `data.json` and `cells/`;** `sheet.js` built the page from the starter.

## Your reply

Keep it to two to five short lines. Say what is in the sheet: its tabs and what's
calculated. Say what to fill in, if anything, and which rows are examples. Say how to let
others edit (Share). Mention the downloads when they asked for a file. For a change, say
what you changed and point to "What changed in this version". Never paste the JSON, and
say "space", never "page".

## Never

- Never type a computed number where a formula belongs.
- Never edit the template's scripts, styles or records tag, or rename the `cells`
  collection. People's edits would vanish from view.
- Never insert rows or columns in the middle of data people edit.
- Never invent data and present it as real. Mark example rows as examples.
- Never promise pivots, live app data, sending to other tools, range comments or instant
  updates.
- Never put people's emails or private details in cells unless the ask gave them for
  that purpose.

## Reference files

- `references/sheet-format.md`: the JSON block, field by field, with a full small
  example. Read it before you write or change a sheet.
- `references/functions.md`: every function the engine knows, with notes on Excel
  differences. Read it before you write formulas you haven't used here.
- `assets/sheet.js`: the one script you run (start, push, save, check). Its header
  lists each step; you don't need to read it.
- `references/sheet-template.html`: the starter page `sheet.js` builds every sheet from.
  Never read or copy it.
- `references/examples.md`: three worked cases. They cover a sheet from one ask, a change
  with its record, and a cleaned import with a tracker. Read it when the ask is like one
  of them.
