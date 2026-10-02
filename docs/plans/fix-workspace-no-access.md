# Fix B18: every workspace page shows the no-access state on a 403

Owner instruction 2026-10-03: "just finish the whole plan now" (B14's recorded residual).

- **Classification:** BUG_FIX · Express (seven pages, one branch each; no API change) · Workspace UI.
- **Contract areas:** none.
- **Root cause:** same as B14. Each page caught every first-load failure as an error toast over empty content, so a non-member, or someone following a link to a deleted workspace, saw an "empty" workspace.
- **Fix:** each page gets `accessDenied` state, `isForbidden(err)` in its load catch, and `<WorkspaceAccessDenied />` in place of its content.
  - A 401 still redirects to `/login`.
  - Any other failure keeps its toast.
- **Pages:**
  - overview
  - discrepancies
  - vendors
  - vendor detail
  - catalog-matches
  - members
  - settings
- **Tests first (RED `8c45d18`):**
  - Web page specs: 14 cases.
  - Playwright: one test across all seven paths.
