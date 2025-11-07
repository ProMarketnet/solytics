// Solscan API helpers for Solana Analytics

export async function getAccountDetail(address, apiKey) {
  const url = `https://pro-api.solscan.io/v2.0/account/detail?address=${address}`;
  const res = await fetch(url, {
    headers: { token: apiKey }
  });
  if (!res.ok) throw new Error(`Account detail error (${res.status})`);
  return await res.json();
}

export async function getBalanceChanges(address, apiKey, from, to, page = 1, pageSize = 100) {
  const url = `https://pro-api.solscan.io/v2.0/account/balance_change?address=${address}&from_time=${from}&to_time=${to}&page=${page}&page_size=${pageSize}`;
  const res = await fetch(url, {
    headers: { token: apiKey }
  });
  if (!res.ok) throw new Error(`Balance changes error (${res.status})`);
  return await res.json();
}

// Async generator to iterate paginated transactions
export async function* iterTransactions(address, apiKey, limit = 50) {
  let beforeHash = undefined, loaded = 0;
  for (;;) {
    const qp = [
      `address=${address}`,
      `limit=${limit}`
    ];
    if (beforeHash) qp.push(`beforeHash=${beforeHash}`);
    const url = `https://pro-api.solscan.io/v2.0/account/transactions?${qp.join("&")}`;
    const res = await fetch(url, {
      headers: { token: apiKey }
    });
    if (!res.ok) throw new Error(`Transactions error (${res.status})`);
    const out = await res.json();
    const list = out?.data || [];
    if (!list.length) break;
    yield list;
    loaded += list.length;
    beforeHash = list[list.length - 1]?.txHash;
    if (!beforeHash) break;
  }
}
