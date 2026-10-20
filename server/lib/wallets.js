'use strict';
// Address format checks for payout wallets. They catch typos and wrong-network
// addresses before an admin sends funds; they are not a substitute for checking on a block explorer.

const EVM = /^0x[0-9a-fA-F]{40}$/;
const PATTERNS = {
  TRC20: { re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, hint: 'Tron (TRC20) addresses start with T and are 34 characters long.' },
  ERC20: { re: EVM, hint: 'Ethereum addresses start with 0x followed by 40 letters or numbers.' },
  ETH: { re: EVM, hint: 'Ethereum addresses start with 0x followed by 40 letters or numbers.' },
  BEP20: { re: EVM, hint: 'BNB Smart Chain addresses start with 0x followed by 40 letters or numbers.' },
  POLYGON: { re: EVM, hint: 'Polygon addresses start with 0x followed by 40 letters or numbers.' },
  ARBITRUM: { re: EVM, hint: 'Arbitrum addresses start with 0x followed by 40 letters or numbers.' },
  BTC: { re: /^(?:bc1[02-9ac-hj-np-z]{11,71}|BC1[02-9AC-HJ-NP-Z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/, hint: 'Bitcoin addresses start with bc1, 1 or 3.' },
  TON: { re: /^(?:[A-Za-z0-9_-]{48}|-?\d:[0-9a-fA-F]{64})$/, hint: 'TON addresses are 48 characters long and usually start with UQ or EQ.' },
};
const GENERIC = /^[A-Za-z0-9:_-]{20,120}$/;

/** Returns an error message if the address doesn't look valid for the network, otherwise null. */
function walletProblem(network, address) {
  const value = String(address || '').trim();
  if (!value) return 'Enter a wallet address.';
  const rule = PATTERNS[String(network || '').toUpperCase()];
  if (rule) return rule.re.test(value) ? null : `This doesn't look like a valid address for this network. ${rule.hint}`;
  return GENERIC.test(value) ? null : 'Enter a valid wallet address.';
}

module.exports = { walletProblem };
