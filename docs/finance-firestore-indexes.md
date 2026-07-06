# Finance Module — Firestore Composite Indexes

The Finance module (`services/finance*.ts`, `app/api/finance/**`) runs a
handful of compound queries that need composite indexes. These are now
defined in `firestore.indexes.json` at the repo root (with `firebase.json`
and `.firebaserc` pointing the Firebase CLI at project `dajaj-pos`), so they
can be deployed up front instead of discovering them one "the query
requires an index" error at a time:

```
firebase deploy --only firestore:indexes
```

(Requires the [Firebase CLI](https://firebase.google.com/docs/cli) and
being logged in / authorized on the `dajaj-pos` project. `firestore.rules`
can be deployed the same way with `--only firestore:rules`, or both at once
with `--only firestore`.) If a new index is still missing at runtime,
Firestore's error includes a direct "create this index" console link —
add the same field combination to `firestore.indexes.json` afterwards so
it's captured for the next environment/deploy instead of only existing by
hand in the console.

| Collection | Fields | Used by |
|---|---|---|
| `fin_accounts` | `branchId` ASC, `displayOrder` ASC | `getFinanceAccounts` |
| `fin_expense_categories` | `branchId` ASC, `displayOrder` ASC | `getExpenseCategories` |
| `fin_expense_subcategories` | `categoryId` ASC, `displayOrder` ASC | `getExpenseSubcategories` |
| `fin_income_categories` | `branchId` ASC, `displayOrder` ASC | `getIncomeCategories` |
| `fin_vendors` | `branchId` ASC, `name` ASC | `getFinanceVendors` |
| `fin_transactions` | `branchId` ASC, `date` DESC | `listFinanceTransactions` |
| `fin_transactions` | `branchId` ASC, `date` ASC | `getPostedTransactionsForRange` |
| `fin_transactions` | `branchId` ASC, `date` ASC | `getPostedTransactionsForDate` (equality on both fields) |
| `fin_audit_logs` | `module` ASC, `timestamp` DESC | `getFinanceAuditLogs` (filtered by module) |
| `fin_audit_logs` | `entityId` ASC, `timestamp` DESC | `getFinanceAuditLogs` (filtered by entity) |
| `fin_daily_closing` | `branchId` ASC, `date` ASC | `getDailyClosingsForRange` (Reports, Dashboard, Pigmi/Lock settings) |
| `finance_defaults` | `branchId` ASC, `displayOrder` ASC | `getFinanceDefaults` |

## Why filters beyond these aren't all indexed

`listFinanceTransactions` intentionally only pushes `branchId` + the `date`
range into the Firestore query. Every other filter the Daily Ledger screen
offers (type, category, vendor, account, amount range, search text, created
by) is applied **in memory** on the page of results, bounded by the date
range the manager selected (defaults to today; reports typically scope to a
month). This is a deliberate trade-off documented in
`services/financeTransactionsService.ts`: a single restaurant's transaction
volume (tens to low hundreds of rows/day) makes this fast and avoids
maintaining a combinatorial explosion of composite indexes for every filter
combination. If DAJAJ ever needs to query across many months of history
with multiple simultaneous filters, move the hot filters (`type`,
`accountId`, `vendorId`) back into the Firestore query and add the
corresponding composite indexes here first.
