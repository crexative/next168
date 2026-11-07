// True only in a build made with VITE_ACCOUNTS=1 (config/accountsFlag.ts). Every account feature starts from this
// constant, so a build without the flag never loads, requests or stores anything of accounts and sync.
export const ACCOUNTS_ENABLED: boolean = import.meta.env.VITE_ACCOUNTS === '1'
