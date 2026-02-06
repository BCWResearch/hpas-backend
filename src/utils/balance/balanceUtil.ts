import { AccountBalanceQuery, Hbar, HbarUnit } from "@hashgraph/sdk";
import { fetchUsdPerHbar } from "./drip/getDripAndFees";
import { getHederaClient } from "../getHederaClient";

export async function fetchPartnerBalanceFromApi(accountId: string) {
    const res = await fetch(`https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`);
    const data = await res.json();
    return Hbar.fromTinybars(data.balance.balance).toString();
}

export async function fetchPartnerBalanceInUsdAndHbarFromApi(accountId: string) {
    const client = getHederaClient('mainnet');
    const query = new AccountBalanceQuery().setAccountId(accountId);
    const accountBalance = await query.execute(client);
    /*
    const res = await fetch(`https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`);
    const data = await res.json();
    const hbar_balance = Hbar.fromTinybars(data.balance.balance).toString();
    */
   //console.log(accountBalance.hbars.toString());
   const hbar_balance = accountBalance.hbars.toString();
    const usdPerHbar = await fetchUsdPerHbar();

    const usd_balance = (accountBalance.hbars).toBigNumber().toNumber() * usdPerHbar;
    return { hbar_balance, usd_balance }
}