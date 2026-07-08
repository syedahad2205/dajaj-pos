/**
 * Thin fetch wrappers for /api/mobile/v1/finance/closing/... routes.
 * (design §3 — modules/daily-closing/api.ts)
 *
 * These are used by the offline-aware mutation hooks (hooks/mutations.ts)
 * through the shared apiClient. This file exists as a typed facade over
 * apiClient.ts — keeping the route path strings in one module-local place
 * rather than scattered across individual hook files.
 *
 * All actual HTTP work is delegated to core/api/apiClient.ts.
 * No business logic lives here — only path constants and typed request shapes.
 */
import { apiCall, type MutationResponse } from '@/core/api/apiClient';
import type { CashDepositType } from '@/constants/finance';

// ── Route path builders ──────────────────────────────────────────────────────

function closingBase(date: string) {
  return `/finance/closing/${date}`;
}

// ── Request types ────────────────────────────────────────────────────────────

export interface AddExpenseRequest {
  categoryId: string;
  amount: number;
  remarks?: string;
  idempotencyKey?: string;
  deviceTime?: string;
}

export interface AddDepositRequest {
  type: CashDepositType;
  amount: number;
  remarks?: string;
  idempotencyKey?: string;
  deviceTime?: string;
}

export interface UpdateSalesRequest {
  upiSales?: number;
  zomatoSales?: number;
  swiggySales?: number;
  otherIncome?: number;
  idempotencyKey?: string;
  deviceTime?: string;
}

export interface SetOpeningCashRequest {
  openingCash: number;
  idempotencyKey?: string;
  deviceTime?: string;
}

export interface CloseDailyClosingRequest {
  closingCash: number;
  idempotencyKey?: string;
  deviceTime?: string;
}

// ── API calls ────────────────────────────────────────────────────────────────

export async function addExpense(
  date: string,
  body: AddExpenseRequest,
  idToken: string,
): Promise<MutationResponse> {
  return apiCall({ method: 'POST', path: `${closingBase(date)}/expenses`, body, idToken, idempotencyKey: body.idempotencyKey });
}

export async function removeExpense(
  date: string,
  entryId: string,
  idToken: string,
  idempotencyKey?: string,
): Promise<MutationResponse> {
  return apiCall({ method: 'DELETE', path: `${closingBase(date)}/expenses/${entryId}`, idToken, idempotencyKey });
}

export async function addDeposit(
  date: string,
  body: AddDepositRequest,
  idToken: string,
): Promise<MutationResponse> {
  return apiCall({ method: 'POST', path: `${closingBase(date)}/deposits`, body, idToken, idempotencyKey: body.idempotencyKey });
}

export async function removeDeposit(
  date: string,
  entryId: string,
  idToken: string,
  idempotencyKey?: string,
): Promise<MutationResponse> {
  return apiCall({ method: 'DELETE', path: `${closingBase(date)}/deposits/${entryId}`, idToken, idempotencyKey });
}

export async function updateSales(
  date: string,
  body: UpdateSalesRequest,
  idToken: string,
): Promise<MutationResponse> {
  return apiCall({ method: 'PATCH', path: `${closingBase(date)}/sales`, body, idToken, idempotencyKey: body.idempotencyKey });
}

export async function setOpeningCash(
  date: string,
  body: SetOpeningCashRequest,
  idToken: string,
): Promise<MutationResponse> {
  return apiCall({ method: 'PATCH', path: `${closingBase(date)}/opening-cash`, body, idToken, idempotencyKey: body.idempotencyKey });
}

export async function closeDailyClosing(
  date: string,
  body: CloseDailyClosingRequest,
  idToken: string,
): Promise<MutationResponse> {
  return apiCall({ method: 'PATCH', path: closingBase(date), body, idToken, idempotencyKey: body.idempotencyKey });
}

export async function getDailyClosing(
  date: string,
  idToken: string,
): Promise<MutationResponse> {
  return apiCall({ method: 'GET', path: closingBase(date), idToken });
}
