# Payment SaaS: Project Overview

## What it is

A white-label **crypto deposit and managed-yield platform**, sold as software to
licensed operators internationally. End users deposit crypto, see their balance in
real time, and can invest in strategies the operator trades. Returns come from
measured trading performance (units × published NAV), never from balances typed in
by staff and never from a promised fixed rate.

The owner (Achiri Hilary) builds and sells the software. Each client operator runs
it under **their own licences and custodian account** (see `docs/ARCHITECTURE.md` §8–9).

## Origin and what it is NOT

It started from a screen recording of "Remedy Invest" (`video_to_reverse_engineer.mp4`,
gitignored). That app showed the hallmarks of a fake-bank / pig-butchering kit:
admin-set balances, "high-yield plans", grants, PIN-gated wires. This project is the
**legitimate counterpart**. Never reintroduce admin-editable balances, guaranteed
returns, withdrawal "unlock fees", or fake bank features (cheque deposit, US bill
pay, SWIFT wires that don't move money).

## Core user flow

1. Sign up with an email code, then enrol TOTP 2FA (mandatory).
2. Verify identity (Sumsub).
3. Deposit crypto to an address from the custodian (BTCPay on testnet).
4. The balance updates live once confirmed and screened.
5. *(Phase 2)* Invest in a strategy, receiving units at the next NAV.
6. Withdraw to a whitelisted address, after staff approval (two approvers above a limit).

Staff (ops, compliance, finance, support, admin) work in a separate console.

## In scope

User portal, staff console, double-entry ledger, KYC, deposits, withdrawals,
strategies/NAV, reconciliation, proof of reserves, statements, multi-tenant
white-labelling. All testing happens on testnets.

## Out of scope (for now)

Fiat on/off-ramps, card issuing, mobile apps, lending/fixed-interest products,
running real customer money (that needs licences, not code).

## Success criteria

- Every balance traces to an external event (tx hash, custodian event) or an
  approved NAV.
- The ledger always sums to zero; reconciliation can show custody ≥ liabilities.
- No single person can move money or change NAV.
- A licensed operator could pass a technical due-diligence review of the system.
