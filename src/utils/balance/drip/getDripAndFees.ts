// dripAmount.ts
import dotenv from "dotenv";
dotenv.config();

const ONE_HOUR = 60 * 60 * 1000;
let cachedDrip: { drip: number; tinydrip: number } | null = null;
let lastFetched: number | null = null;
let lastGoodUsdPerHBAR: number | null = null;


// TODO: THE PROBLEM IS HERE, THE DRIP + FEES != TOTAL SO ITS REJECTIGN THE TRANSACTION. DRIP + 
export async function getDripAndFees(
    drip_amount_in_usd: number
): Promise<{
    dripTinybar: number;
    feeTinybar: number;
    totalTinybar: number;
}> {
    const usdPerHBAR = await fetchUsdPerHbar();

    const fee_amount_in_usd = drip_amount_in_usd / 10;

    const { tinybar_drip: dripTinybar } =
        calcDripFromUsd(drip_amount_in_usd, usdPerHBAR);

    const { tinybar_drip: feeTinybar } =
        calcDripFromUsd(fee_amount_in_usd, usdPerHBAR);

    return {
        dripTinybar,
        feeTinybar,
        totalTinybar: dripTinybar + feeTinybar,
    };
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
