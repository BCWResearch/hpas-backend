import { Hbar, HbarUnit } from "@hashgraph/sdk";
import { fetchUsdPerHbar } from "./drip/getDripAndFees";

export async function fetchPartnerBalanceFromApi(accountId: string) {
    const res = await fetch(`https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`);
    const data = await res.json();
    return Hbar.fromTinybars(data.balance.balance).toString();
}

export async function fetchPartnerBalanceInUsdAndHbarFromApi(accountId: string) {
    const res = await fetch(`https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`);
    const data = await res.json();
    const hbar_balance = Hbar.fromTinybars(data.balance.balance).toString();
    const usdPerHbar = await fetchUsdPerHbar();

    const usd_balance = Hbar.fromTinybars(data.balance.balance).toBigNumber().toNumber() * usdPerHbar;
    return { hbar_balance, usd_balance }
}