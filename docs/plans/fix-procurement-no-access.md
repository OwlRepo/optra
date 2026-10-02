# Fix B14 — a non-member sees a no-access state, not an empty workspace

Owner instruction 2026-10-02: continue through the bug list without waiting; pull the owner in only when a decision is needed.

- **Classification:** BUG_FIX · Express (one page, one helper, one presentational component; no API, schema or auth change) · Procurement UI.
- **Contract areas:** none. The API already answers 403 `Not a member of this workspace` (`WorkspaceMemberGuard`); only the page's reading of it changes.
- **Root cause:** `ProcurementPage.loadPage` caught every failure the same way: an error toast, then `isLoading = false`, with the document lists still `[]`. A non-member following a shared or stale link therefore saw an error toast, then "No purchase orders yet", then the Compare card, as if the workspace were simply empty.
- **Fix:**
  - `isForbidden(err)` (`handle-unauthorized.ts`) recognises a 403.
  - On first load, a 403 sets `accessDenied`, and the page renders `WorkspaceAccessDenied` in place of tabs, lists and Compare. That shared component reads "You don't have access to this workspace" and offers "Go to your workspaces".
  - A 401 still redirects to `/login`.
  - Any other failure still shows the toast.
- **Not changed (residual):** the overview, discrepancies, vendors, catalog-matches, members and settings pages have the same load pattern. Each needs the same three lines and a browser test. That work is recorded in the risk register and is out of this slice's scope.
- **Tests first (RED `222b4fc`):**
  - Web page (3).
  - `isForbidden` (3).
  - Component (1).
  - The S4 Playwright case was updated to the new state on purpose.
