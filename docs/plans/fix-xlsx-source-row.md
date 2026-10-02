# Fix B1 — XLSX lines cite their true spreadsheet row

RCA and plan approved by the owner 2026-10-02.

- Classification: BUG_FIX · Deep (Bull parse processor) · Procurement · Jobs. Contract areas: API — none (the `sourceRow` value becomes correct; shape unchanged); DB — none.
- Root cause: `convertXlsxToCsv` (`procurement-parse.processor.ts`) uses `XLSX.utils.sheet_to_json`, which skips blank rows; `parseCsvRows` then set `sourceRow = index + 2`, counting CSV records rather than sheet rows. Proven after a real XLSX round trip: rows A1, (blank), A3, (empty cells), A5 → SheetJS `__rowNum__` 1, 3, 4, 5 → true rows 2, 4, 6 for the kept lines; the old code cited 2, 3, 5.
- Correction recorded while building: the RCA also claimed "a sheet whose data starts at row 2 is off by one". That was observed only on an in-memory sheet with a hand-set range; SheetJS re-anchors a written workbook at A1, so no test was written for it. The fix (use `__rowNum__`) covers that case regardless.
- Fix: `convertXlsxToCsv` also returns `sourceRows` (`__rowNum__ + 1` per row); `parseCsvRows(csv, sheet, sourceRows)` uses it when present, CSV keeps `index + 2`.
- Tests first: unit `procurement-parse.processor.spec.ts` `describe('XLSX source rows (B1)')` (2 `regression:` cases, both RED on the old code); API e2e `procurement.e2e-spec.ts` `describe('XLSX citations (B1)')` (price flag on an XLSX line below a blank row cites row 4). Browser layer not touched: no page or BFF change.
- Branch `fix/no-ticket-xlsx-source-row`, stacked on `fix/no-ticket-zero-row-files` (same function).
