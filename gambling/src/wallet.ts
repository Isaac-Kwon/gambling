import type { Wallet } from "./types";

export interface WalletImpl extends Wallet {
  /** Used when resuming: replaces the balance and notifies listeners. */
  restore(balance: number): void;
}

function check(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`wallet.${what}: amount must be a non-negative integer, got ${n}`);
}

export function createWallet(initial: number): WalletImpl {
  check(initial, "init");
  let balance = initial;
  const subs = new Set<(balance: number, delta: number) => void>();
  const emit = (delta: number): void => { for (const cb of [...subs]) cb(balance, delta); };
  return {
    get balance() { return balance; },
    canBet: (a) => Number.isSafeInteger(a) && a > 0 && a <= balance,
    debit(a) {
      check(a, "debit");
      if (a > balance) throw new RangeError(`wallet.debit: ${a} exceeds balance ${balance}`);
      if (a === 0) return;
      balance -= a;
      emit(-a);
    },
    credit(a) {
      check(a, "credit");
      if (a === 0) return;
      balance += a;
      emit(a);
    },
    onChange(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    restore(b) {
      check(b, "restore");
      const d = b - balance;
      balance = b;
      if (d !== 0) emit(d);
    },
  };
}
