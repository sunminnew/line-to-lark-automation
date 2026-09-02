'use strict';
/**
 * peakHandler.js
 * Integrates with PEAK Account API to find an invoice by amount
 * and record a payment from a bank transfer slip.
 *
 * Required env vars:
 *   PEAK_CONNECT_ID          -- connectId (from PEAK Application settings)
 *   PEAK_CONNECT_KEY         -- connectKey (from PEAK Application settings)
 *   PEAK_USER_TOKEN          -- User Token (generated in PEAK dashboard)
 *   PEAK_PAYMENT_METHOD_CODE -- payment method code in your PEAK chart of accounts
 *                               (e.g. "TRF001" for bank transfer; check PEAK settings)
 *
 * Auth flow per PEAK API docs:
 *   1. Time-Stamp  : yyyyMMddHHmmss (Bangkok UTC+7)
 *   2. Time-Signature : HMAC-SHA1(Time-Stamp, key=connectId) as hex
 *   3. POST /api/v1/ClientToken -> get short-lived Client-Token
 *   4. Pass Time-Stamp, Time-Signature, User-Token, Client-Token on every request.
 */

const crypto = require('crypto');
const axios  = require('axios');

const BASE_URL = 'https://api.peakaccount.com';

// Auth helpers

/** Bangkok timestamp string yyyyMMddHHmmss */
function bangkokTimestamp() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().replace(/\D/g, '').slice(0, 14);
}

/** Build the four auth headers required by PEAK. clientToken optional for /ClientToken itself. */
function peakHeaders(clientToken) {
  const connectId = process.env.PEAK_CONNECT_ID;
  const ts  = bangkokTimestamp();
  const sig = crypto.createHmac('sha1', connectId).update(ts).digest('hex');
  const h = {
    'Content-Type':   'application/json',
    'Time-Stamp':     ts,
    'Time-Signature': sig,
    'User-Token':     process.env.PEAK_USER_TOKEN,
  };
  if (clientToken) h['Client-Token'] = clientToken;
  return h;
}

// Step 1: Client Token

async function getClientToken() {
  const res = await axios.post(
    `${BASE_URL}/api/v1/ClientToken`,
    {
      peakClientToken: {
        connectId:  process.env.PEAK_CONNECT_ID,
        connectKey: process.env.PEAK_CONNECT_KEY,
      },
    },
    { headers: peakHeaders(), timeout: 12000 }
  );
  const token = res.data?.PeakClientToken?.token;
  if (!token) throw new Error('[PEAK] ClientToken response missing token');
  return token;
}

// Step 2: Find invoice by amount

/**
 * Search all invoices with remainAmount > 0 and find one within +-1 THB of slipAmount.
 */
async function findMatchingInvoice(slipAmount, clientToken) {
  const res = await axios.get(`${BASE_URL}/api/v1/Invoices/list`, {
    headers: peakHeaders(clientToken),
    params:  { includeRemainAmount: 1, limit: 100 },
    timeout: 12000,
  });

  const invoices = res.data?.PeakInvoices?.invoices ?? [];
  console.log(`[PEAK] ${invoices.length} invoice(s) fetched. Looking for ${slipAmount} THB.`);

  const match = invoices.find(
    (inv) => Number(inv.remainAmount) > 0 &&
             Math.abs(Number(inv.remainAmount) - slipAmount) < 1
  );
  return match ?? null;
}

// Step 3: Record payment

/**
 * Record a payment on the matched invoice.
 * slipDate: yyyyMMdd string from slip reader (or today as fallback).
 * Returns the PEAK transaction code on success, null on failure.
 */
async function recordPayment(invoice, slipAmount, slipDate, clientToken) {
  const paymentDate = slipDate && /^\d{8}$/.test(slipDate)
    ? slipDate
    : bangkokTimestamp().slice(0, 8);

  const body = {
    peakPaidPayments: {
      transactionCode: invoice.code,
      paymentDate,
      payments: [{
        paymentMethodCode: process.env.PEAK_PAYMENT_METHOD_CODE || 'TRF001',
        amount: slipAmount,
      }],
    },
  };

  const res = await axios.post(`${BASE_URL}/api/v1/Invoices/paidpayment`, body, {
    headers: peakHeaders(clientToken),
    timeout: 12000,
  });

  const result = res.data?.PeakPaidPayments;
  if (result?.resCode === '200') {
    return result.transactionCode || invoice.code;
  }
  console.error('[PEAK] paidpayment error:', result?.resCode, result?.resDesc);
  return null;
}

// Public entry point

/**
 * Given slip data, find a matching PEAK invoice and record the payment.
 *
 * @param {number} slipAmount  Amount from slip (THB)
 * @param {string} slipDate    Date from slip (yyyyMMdd), or '' for today
 * @returns {{ success: boolean, amount?: number, invoiceCode?: string }}
 */
async function processSlipPayment(slipAmount, slipDate) {
  if (!process.env.PEAK_CONNECT_ID ||
      !process.env.PEAK_CONNECT_KEY ||
      !process.env.PEAK_USER_TOKEN) {
    console.log('[PEAK] Credentials not set -- skipping PEAK integration.');
    return { success: false };
  }

  try {
    const clientToken = await getClientToken();
    const invoice     = await findMatchingInvoice(slipAmount, clientToken);

    if (!invoice) {
      console.log(`[PEAK] No unpaid invoice matching ${slipAmount} THB.`);
      return { success: false };
    }
    console.log(`[PEAK] Matched invoice ${invoice.code} (remain: ${invoice.remainAmount} THB)`);

    const txCode = await recordPayment(invoice, slipAmount, slipDate, clientToken);
    if (!txCode) return { success: false };

    console.log(`[PEAK] Payment recorded. TX: ${txCode}`);
    return { success: true, amount: slipAmount, invoiceCode: invoice.code };

  } catch (err) {
    console.error('[PEAK] Unexpected error:', err.response?.data ?? err.message);
    return { success: false };
  }
}

module.exports = { processSlipPayment };
