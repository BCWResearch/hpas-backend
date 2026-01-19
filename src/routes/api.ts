// Move to HPAS

import express from "express";
import dotenv from "dotenv";
import { PartnerDripStatus, PrismaClient } from "@prisma/client";
import { AccountBalanceQuery, Client, Hbar, HbarUnit, PrivateKey, PublicKey, Status, TransferTransaction } from "@hashgraph/sdk";
import { makeGcpKmsAdapter, makeLocalKmsAdapter } from "../utils/kms/local";
import { getDripAndFees } from "../utils/balance/drip/getDripAndFees";
import { requireApiKeyAuthentication } from "../middleware/apiAuth";
import { sendEmail } from "../utils/email/email";
const prisma = new PrismaClient();
dotenv.config();
const router = express.Router();
const operatorId = process.env.HEDERA_TREASURY_ACCOUNT_ID;

const kmsAdapter =
    process.env.KEY_ENV === "gcp"
        ? makeGcpKmsAdapter()
        : makeLocalKmsAdapter();

async function logApiRequest(partner_id: string, key_id: string, route: string, statusCode: number, costUnits: number, ip: string, success: boolean) {
    try {
        await prisma.apiRequestLog.create({
            data: {
                apiPartnerId: partner_id,
                apiKeyId: key_id,
                route,
                statusCode,
                costUnits,
                ipHash: hashIp(ip),
                success,
            },
        });
        // lightweight "last used" update (don’t await)
        prisma.apiKey.update({ where: { id: key_id }, data: { lastUsedAt: new Date() } }).catch(() => { });
    } catch (e) {
        // swallow logging errors
        console.warn("request log write failed", e);
    }
}


export async function getPartnerKeyFromKMS(sender_account_id: string): Promise<{ sender_account_pkey: PrivateKey; sender_account_pbkey: PublicKey } | { sender_account_pkey: string; sender_account_pbkey: string }> {

    const encrypted_pvt_key = await prisma.apiPartner.findFirst({
        where: {
            accountId: sender_account_id
        },
        select: { encryptedPrivateKey: true, publicKey: true }
    });
    // decrypt pvt key
    if (!encrypted_pvt_key) { return { sender_account_pkey: 'fail', sender_account_pbkey: 'fail' } }
    const sender_account_pvt_key_raw = await kmsAdapter.unwrap(Buffer.from(encrypted_pvt_key.encryptedPrivateKey));
    return { sender_account_pkey: PrivateKey.fromBytes(sender_account_pvt_key_raw), sender_account_pbkey: PublicKey.fromStringECDSA(encrypted_pvt_key.publicKey) };
}




async function sendLowBalanceEmail(
    partnerEmails: string[],
    hbars: Hbar,
    thresholdHbar: number
) {
    const balance = hbars.toBigNumber().toFormat(2);

    const subject = "⚠️ Faucet Balance Below Threshold";

    const html = `
    <p>
      Your organization's Faucet account balance is
      <strong>${balance} HBAR</strong>, which has fallen below your configured
      threshold of <strong>${thresholdHbar} HBAR</strong>.
    </p>
    <p>
      Please refill your balance to avoid interrupted faucet service.
    </p>
  `;

    await sendEmail(partnerEmails, subject, html);
}


function hashIp(ip: string | undefined): string | undefined {
    if (!ip) return undefined;
    try {
        return require("crypto").createHash("sha256").update(ip).digest("hex");
    } catch {
        return undefined;
    }
}
// Checks DB to ensure that a partner can be created + Creates a new partner account + adds them to the DB

// Admin control routes

// add new partners



// Partner Portal routes

// Partner API routes

// controls drips for partners
router.post('/drip', requireApiKeyAuthentication, async (req, res) => {
    const { sender_account_id, drip_amount_in_usd, partner_id, key_id } = (req as any).partner;
    try {
        const { recipient_account_id } = req.body;
        // verification that recipient_account_id is correct, we will obtain the sender_account_id from the middleware, and set the drip amount here
        if (!recipient_account_id) {
            await logApiRequest(partner_id, key_id, 'drip', 400, 0, req.ip!, false);
            return res.status(400).json({ code: 'RECIPIENT_ACCOUNT_REQUIRED' });
        }

        // Get the pvt key from the kms to use here.
        const { sender_account_pkey } = await getPartnerKeyFromKMS(sender_account_id);
        // get the drip_amount_in_hbar + fee_amount_in_hbar
        const { dripTinybar, feeTinybar, totalTinybar } = await getDripAndFees(drip_amount_in_usd);
        console.log('DRIP AMNT HBAR:', dripTinybar);
        console.log('FEE AMNT HBAR:', feeTinybar);
        console.log('TOTAL AMNT HBAR:', totalTinybar);
        // create a client using the sender_account_id and the sender_account_id from the kms
        const client = Client.forMainnet();
        client.setOperator(
            sender_account_id,
            sender_account_pkey
        );

        console.log("PAYER:", sender_account_id);
        console.log({
            sender_account_id,
            operatorIdUsedByClient: client._operator?.accountId?.toString()
        });

        if (totalTinybar !== dripTinybar + feeTinybar) {
            throw new Error("Invariant failed: drip + fee != total");
        }

        const payerBal = await new AccountBalanceQuery()
            .setAccountId(sender_account_id)
            .execute(client);

        console.log("PAYER BAL:", payerBal.hbars.toString());
        console.log("PAYER tinybar:", payerBal.hbars.toTinybars().toString());


        // Batch transaction 
        const transaction = new TransferTransaction()
            .setMaxTransactionFee(new Hbar(1))
            .addHbarTransfer(
                sender_account_id,
                new Hbar(`-${totalTinybar}`, HbarUnit.Tinybar)
            )
            .addHbarTransfer(
                operatorId!,
                new Hbar(`${feeTinybar}`, HbarUnit.Tinybar)
            )
            .addHbarTransfer(
                recipient_account_id,
                new Hbar(`${dripTinybar}`, HbarUnit.Tinybar)
            );

        const txResponse = await transaction.execute(client);

        const txId = txResponse.transactionId.toString();
        let status: PartnerDripStatus;

        const receipt = await txResponse.getReceipt(client);
        switch (receipt.status) {
            case Status.Success:
                status = PartnerDripStatus.SUCCESS;
                break;

            case Status.Unknown:
                status = PartnerDripStatus.PENDING;
                break;

            default:
                status = PartnerDripStatus.FAILED;
        }
        // Check Balance of Sender Account, then compare to threshold. If threshold is reached, we can 
        const query = new AccountBalanceQuery()
            .setAccountId(sender_account_id);
        const accountBalance = await query.execute(client);

        // Alert everyone on the team that is a admin or owner rank!
        const email_list = await prisma.email.findMany({
            where: {
                partnerId: partner_id,
                verified: true
            },
            select: {
                email: true,
            }
        });
        const threshold_info = await prisma.apiPartner.findUnique({
            where: { id: partner_id },
            select: { threshold: true, thresholdTriggered: true }
        });

        if (!threshold_info) {
            return res.status(404).json({ code: 'THRESHOLD_NOT_FOUND' });
        }

        if (!email_list) {
            return res.status(404).json({ code: 'EMAIL_LIST_NOT_FOUND' })
        }
        const emails = email_list.map(e => e.email);

        const balanceTinybar = accountBalance.hbars.toTinybars();
        const thresholdTinybar = Hbar.fromString(threshold_info.threshold.toString(), HbarUnit.Hbar).toTinybars();

        console.log('balanceTinybar:', balanceTinybar);
        console.log('thresholdTinybar:', thresholdTinybar);
        console.log('Triggered?:', threshold_info.thresholdTriggered);
        if (balanceTinybar.lessThan(thresholdTinybar) && !threshold_info.thresholdTriggered) {
            // send a low balance email to the partner's email
            await sendLowBalanceEmail(emails, accountBalance.hbars, threshold_info.threshold);
            await prisma.apiPartner.update({
                where: {
                    id: partner_id
                },
                data: {
                    thresholdTriggered: true,
                },
            });
        }

        // update the api transaction history table:
        await prisma.partnerTransactionHistory.create({
            data: {
                txId,
                status,
                sender_account_id,
                recipient_account_id,
                amountTinybar: BigInt(totalTinybar),
                partnerId: partner_id,
                timestamp: new Date()
            },
        });

        //TODO: We should also update the insight requests here
        await logApiRequest(partner_id, key_id, 'drip', 200, 1, req.ip!, true);

        return res.status(200).json({ code: 'DRIP_SUCCESSFUL', transactionId: txId });
    } catch (e) {

        await logApiRequest(
            partner_id,
            key_id,
            'drip',
            500,
            0,
            req.ip!,
            false
        );
        return res.status(500).json({ code: 'DRIP_INTERNAL_ERROR' });
    }
});

router.get('/transactions', requireApiKeyAuthentication, async (req, res) => {
    const { partner_id, key_id } = (req as any).partner;
    try {
        // verification that recipient_account_id is correct, we will obtain the sender_account_id from the middleware, and set the drip amount here

        const transactions = await prisma.partnerTransactionHistory.findMany({
            where: { partnerId: partner_id },
            select: { txId: true, status: true, sender_account_id: true, recipient_account_id: true, amountTinybar: true, timestamp: true }
        });

        if (!transactions) {
            return res.status(404).json({ code: 'THRESHOLD_NOT_FOUND' });
        }

        const safeTransactions = transactions.map(tx => ({
            transactionId: tx.txId,
            status: tx.status,
            sender_account_id: tx.sender_account_id,
            recipient_account_id: tx.recipient_account_id,
            amount: new Hbar(tx.amountTinybar.toString(), HbarUnit.Tinybar).toString(),
            timestamp: tx.timestamp.toISOString(),
        }));

        // update the api transaction history table:

        //TODO: We should also update the insight requests here
        await logApiRequest(partner_id, key_id, 'transactions', 200, 0, req.ip!, true);

        return res.status(200).json({ transactions: safeTransactions });
    } catch (e) {

        await logApiRequest(
            partner_id,
            key_id,
            'transactions',
            500,
            0,
            req.ip!,
            false
        );
        return res.status(500).json({ code: 'TRANSACTION_INTERNAL_ERROR' });
    }
});


export default router;

