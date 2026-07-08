/**
 * Constants mirror — verbatim copy of the pure enums/constants from
 * lib/finance.ts in the web project that the mobile app needs.
 *
 * RULES for this file (enforced by design §9 / Requirement 6.1):
 *   - Values MUST be verbatim copies from lib/finance.ts. Do not derive,
 *     compute, or reorder anything.
 *   - No logic may be added here. This is a constants file only.
 *   - When lib/finance.ts changes CASH_DEPOSIT_TYPE_LABELS,
 *     SUPPORTED_CASH_DEPOSIT_TYPES, or DEFAULT_BRANCH_ID, this file
 *     must be updated to match.
 *
 * Source: /dajaj-pos/lib/finance.ts
 */

export type CashDepositType =
  | 'pigmi'
  | 'bank'
  | 'petty_cash'
  | 'owner_withdrawal'
  | 'safe';

/** Display label for every known deposit type. Verbatim from lib/finance.ts. */
export const CASH_DEPOSIT_TYPE_LABELS: Record<CashDepositType, string> = {
  pigmi: 'Pigmi',
  bank: 'Bank Deposit',
  petty_cash: 'Petty Cash',
  owner_withdrawal: 'Owner Withdrawal',
  safe: 'Returned to Safe',
};

/** Deposit types offered on the Daily Closing screen today. Verbatim from lib/finance.ts. */
export const SUPPORTED_CASH_DEPOSIT_TYPES: CashDepositType[] = ['pigmi'];

/** The default branch ID. Verbatim from lib/finance.ts. */
export const DEFAULT_BRANCH_ID = 'main';
