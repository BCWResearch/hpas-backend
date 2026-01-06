// dripAmount.ts
import dotenv from "dotenv";
dotenv.config();

const ONE_HOUR = 60 * 60 * 1000;
let cachedDrip: { drip: number; tinydrip: number } | null = null;
let lastFetched: number | null = null;
let lastGoodUsdPerHBAR: number | null = null;

export async function getDripAndFees(drip_amount_in_usd: any): Promise<{ drip_amount_in_hbar: number; fee_amount_in_hbar: number; total_amount_in_hbar: number; } | { drip_amount_in_hbar: number; fee_amount_in_hbar: number; total_amount_in_hbar: number; }> {
    const now = Date.now();

    const fee_amount_in_usd = drip_amount_in_usd / 10;

    // Cache this!!
    const usdPerHBAR = await fetchUsdPerHbar(); // USD per 1 HBAR

    const { hbar_drip: dripHBAR, tinybar_drip: dripTiny } = calcDripFromUsd(drip_amount_in_usd, usdPerHBAR);
    const { hbar_drip: feeHBAR, tinybar_drip: feeTiny } = calcDripFromUsd(fee_amount_in_usd, usdPerHBAR);

    return { drip_amount_in_hbar: dripHBAR, fee_amount_in_hbar: feeHBAR, total_amount_in_hbar: dripHBAR + feeHBAR };
}

function calcDripFromUsd(dripUSD: number, usdPerHBAR: number) {
    // compute tinybars first to avoid float mismatch after rounding
    const tinybar = Math.round((dripUSD / usdPerHBAR) * 1e8); // 1 HBAR = 1e8 tinybars
    const hbar = tinybar / 1e8;
    return { hbar_drip: hbar, tinybar_drip: tinybar };
}

// We should cache this instead
export async function fetchUsdPerHbar(): Promise<number> {
    const res = await fetch("https://mainnet.mirrornode.hedera.com/api/v1/network/exchangerate");
    if (!res.ok) throw new Error(`Exchange rate fetch failed: ${res.status}`);
    const j = await res.json();

    // endpoint can be { current_rate: { cent_equivalent, hbar_equivalent } } or flat
    const rate = j.current_rate ?? j;
    const centEq = Number(rate.cent_equivalent);
    const hbarEq = Number(rate.hbar_equivalent);
    if (!Number.isFinite(centEq) || !Number.isFinite(hbarEq) || hbarEq <= 0) {
        throw new Error(`Bad exchangerate payload: ${JSON.stringify(j)}`);
    }

    // cents per HBAR = centEq / hbarEq; convert to USD by /100
    const usdPerHBAR = (centEq / hbarEq) / 100;

    // sanity guardrails
    if (usdPerHBAR < 0.01 || usdPerHBAR > 10) {
        throw new Error(`Suspicious USD/HBAR ${usdPerHBAR}`);
    }
    return usdPerHBAR;
}
