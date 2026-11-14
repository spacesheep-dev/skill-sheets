# Functions the engine knows

Write formulas in Excel's syntax. The engine in the space computes them, and the .xlsx
download keeps them, so Excel, Numbers and LibreOffice compute them again on open. Use only
the functions below. Any other name shows `#NAME?` in the space.

## Syntax

- Operators: `+ - * / ^`, `&` (joins text), `%` (`20%` is 0.2), and the comparisons
  `= <> < > <= >=`. Precedence is Excel's, so `-2^2` is 4.
- References: `B2`, `$B$2`, `B2:D9`, `B:B` (a whole column), `Sales!B2`,
  `'Q1 plan'!B2:D9`. `$` fixes a row or column in highlight rules.
- Text in quotes: `"open"`. A quote inside text is doubled: `"say ""hi"""`. Inside the
  JSON block, escape each quote: `"=IF(E2=\"done\",1,0)"`.
- `TRUE` and `FALSE`. A ticked checkbox is `TRUE`.
- Dates are day numbers, as in Excel. A cell written `"2027-03-01"` is a date.
  `B2+7` is a week later.

## The list

| Group | Functions |
|---|---|
| Sums and counts | `SUM` `PRODUCT` `AVERAGE` `MIN` `MAX` `COUNT` `COUNTA` `COUNTBLANK` |
| With conditions | `COUNTIF` `COUNTIFS` `SUMIF` `SUMIFS` `AVERAGEIF` `AVERAGEIFS` `MAXIFS` `MINIFS` |
| Arrays | `SUMPRODUCT` (the only place where `(A2:A9="x")*(B2:B9)` sums element by element) |
| Logic | `IF` `IFS` `IFERROR` `IFNA` `AND` `OR` `NOT` |
| Numbers | `ROUND` `ROUNDUP` `ROUNDDOWN` `INT` `ABS` `MOD` `POWER` `SQRT` |
| Dates | `DATE` `YEAR` `MONTH` `DAY` `WEEKDAY` `TODAY` `EDATE` `EOMONTH` |
| Text | `CONCAT` `CONCATENATE` `LEN` `UPPER` `LOWER` `TRIM` `LEFT` `RIGHT` `MID` |
| Checks | `ISBLANK` `ISNUMBER` `ISTEXT` `ISERROR` |
| Lookups | `VLOOKUP` `XLOOKUP` `INDEX` `MATCH` |

## Conditions (COUNTIF, SUMIFS and the rest)

- `"paid"` is an exact match, ignoring case. `"<>paid"` means anything else.
- `">=100"`, `"<0"`: numbers. Build one from a cell with `">="&B$1`.
- `"*smith*"`, `"Q?"`: `*` matches any run of characters, and `?` matches one.
- `""` matches empty cells. `"<>"` matches cells that aren't empty.
- Every range in one COUNTIFS or SUMIFS must be the same size.

## Patterns that come up

| Need | Formula |
|---|---|
| Total of a column on another tab | `=SUM(Costs!C2:C200)` |
| Count by status | `=COUNTIF(Tasks!D2:D200,"open")` |
| Count by owner and status | `=COUNTIFS(Tasks!B2:B200,$A2,Tasks!D2:D200,B$1)` |
| Sum by month (month starts in row 1) | `=SUMIFS(Data!D:D,Data!A:A,">="&B$1,Data!A:A,"<"&EDATE(B$1,1))` |
| Change on the row above, as a rate | `=IF(B2=0,"",B3/B2-1)` |
| Cost per unit, safe from zero | `=IF(C2=0,"",B2/C2)` |
| Quarter of a date | `=ROUNDUP(MONTH(B2)/3,0)` |
| Months of a year counted from a start month | `=IF(YEAR(B2)<>2027,0,13-MONTH(B2))` |
| Overdue and not done (a highlight rule) | `=AND($C2<>"",$C2<TODAY(),$E2<>TRUE)` |
| Look up a rate by name | `=XLOOKUP(A2,Rates!A:A,Rates!B:B,0)` |
| Ticked boxes on a tab | `=COUNTIF(Tasks!E2:E200,TRUE)` |

## Differences from Excel to know

- Nothing spills: a formula gives one value. Array maths work only inside SUMPRODUCT.
  Elsewhere, a range given to a one-value function uses its first cell.
- Not supported: `TEXT`, `TEXTJOIN`, `FILTER`, `SORT`, `UNIQUE`, `OFFSET`, `INDIRECT`,
  `NETWORKDAYS`, `PMT` and the other finance functions, and named ranges. Use a helper
  column or a summary tab instead.
- `SUM(A1)` on a single text cell gives `#VALUE!`. Excel gives 0. Sum ranges, not lone
  text cells.
- A formula that refers back to itself shows `#CYCLE!`.
- `TODAY()` is the reader's date when the space opens, so highlights based on it update
  daily.
- The errors you may see are `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#N/A`, `#NUM!`,
  `#CYCLE!` and `#CALC!` (the sheet asks for millions of cell reads: use smaller ranges).
  A range past row 10,000 or column ALL is `#REF!`, and text past 32,767 characters is
  `#VALUE!`, as in Excel. The status line under the buttons lists every error cell.
