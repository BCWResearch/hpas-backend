// Move to HPAS

import express from "express";
import dotenv from "dotenv";
import { PartnerDripStatus, PrismaClient } from "@prisma/client";
import { AccountBalanceQuery, Client, Hbar, HbarUnit, PrivateKey, PublicKey, Status, TransferTransaction } from "@hashgraph/sdk";
import { makeGcpKmsAdapter, makeLocalKmsAdapter } from "../utils/kms/local";
import { getDripAndFees } from "../utils/balance/drip/getDripAndFees";
import { requireApiKeyAuthentication } from "../middleware/apiAuth";
import { sendEmail } from "../utils/email/email";
import { logApiRequest } from "../utils/logger";
const prisma = new PrismaClient();
dotenv.config();
const router = express.Router();
const operatorId = process.env.HEDERA_TREASURY_ACCOUNT_ID;

const kmsAdapter =
    process.env.KEY_ENV === "gcp"
        ? makeGcpKmsAdapter()
        : makeLocalKmsAdapter();

const isHedera = (s: string) => /^\d+\.\d+\.\d+$/.test((s ?? "").trim());





export async function getPartnerKeyFromKMS(sender_account_id: string): Promise<{ sender_account_pkey: PrivateKey; sender_account_pbkey: PublicKey }> {

    const encrypted_pvt_key = await prisma.apiPartner.findFirst({
        where: {
            accountId: sender_account_id
        },
        select: { encryptedPrivateKey: true, publicKey: true }
    });
    // decrypt pvt key
    if (!encrypted_pvt_key) { throw new Error("PARTNER_KEY_NOT_FOUND"); }
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
            await logApiRequest(partner_id, key_id, 'drip', 400, 'RECIPIENT_ACCOUNT_MISSING', 0, req.ip!, false);
            return res.status(400).json({ code: 'RECIPIENT_ACCOUNT_REQUIRED' });
        }
        if (!isHedera(recipient_account_id)) {
            await logApiRequest(partner_id, key_id, 'drip', 400, 'INVALID_RECIPIENT_ACCOUNT_ID', 0, req.ip!, false);
            return res.status(400).json({ code: 'INVALID_RECIPIENT_ACCOUNT_ID' });
        }


        // Get email list + threshold info
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
            await logApiRequest(partner_id, key_id, 'drip', 404, 'THRESHOLD_NOT_FOUND', 0, req.ip!, false);
            return res.status(404).json({ code: 'THRESHOLD_NOT_FOUND' });
        }

        if (email_list.length === 0) {
            await logApiRequest(partner_id, key_id, 'drip', 404, 'EMAIL_LIST_NOT_FOUND', 0, req.ip!, false);
            return res.status(404).json({ code: 'EMAIL_LIST_NOT_FOUND' })
        }
        const emails = email_list.map(e => e.email);

        // Get the pvt key from the kms to use here.
        const { sender_account_pkey } = await getPartnerKeyFromKMS(sender_account_id);
        // get the drip_amount_in_hbar + fee_amount_in_hbar
        const { dripTinybar, feeTinybar, totalTinybar } = await getDripAndFees(drip_amount_in_usd);
        // create a client using the sender_account_id and the sender_account_id from the kms
        const client = Client.forMainnet();
        client.setOperator(
            sender_account_id,
            sender_account_pkey
        );


        if (totalTinybar !== dripTinybar + feeTinybar) {
            throw new Error("Invariant failed: drip + fee != total");
        }

        const payerBal = await new AccountBalanceQuery()
            .setAccountId(sender_account_id)
            .execute(client);

        const preBalanceTinybar = payerBal.hbars.toTinybars();
        if (preBalanceTinybar.lessThan(totalTinybar)) {
            await logApiRequest(partner_id, key_id, 'drip', 402, 'INSUFFICIENT_FUNDS', 0, req.ip!, false);
            return res.status(402).json({ code: 'INSUFFICIENT_FUNDS' });
        }
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

        const postBalanceTinybar = preBalanceTinybar.subtract(totalTinybar);

        const thresholdTinybar = Hbar.fromString(threshold_info.threshold.toString(), HbarUnit.Hbar).toTinybars();

        console.log('balanceTinybar:', postBalanceTinybar);
        console.log('thresholdTinybar:', thresholdTinybar);
        console.log('Triggered?:', threshold_info.thresholdTriggered);

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

        if (receipt.status !== Status.Success) {
            await logApiRequest(partner_id, key_id, 'drip', 502, `DRIP_FAILED, ${receipt.toString()}`, 0, req.ip!, false);
            return res.status(502).json({
                code: 'DRIP_FAILED',
                status: receipt.status.toString(),
                transactionId: txId
            });
        }
        //TODO: We should also update the insight requests here
        try {
            const postBalanceHbar = Hbar.fromTinybars(postBalanceTinybar);
            if (postBalanceTinybar.lessThan(thresholdTinybar) && !threshold_info.thresholdTriggered) {
                await sendLowBalanceEmail(emails, postBalanceHbar, threshold_info.threshold);
                await prisma.apiPartner.update({
                    where: { id: partner_id },
                    data: { thresholdTriggered: true },
                });
            }
        } catch (err) {
            console.error("Low balance alert failed", err);
        }

        await logApiRequest(partner_id, key_id, 'drip', 200, 'OK', 1, req.ip!, true);

        return res.status(200).json({ code: 'DRIP_SUCCESSFUL', transactionId: txId });
    } catch (e) {

        await logApiRequest(
            partner_id,
            key_id,
            'drip',
            500,
            `DRIP_INTERNAL_ERROR: ${e}`,
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
            return res.status(404).json({ code: 'TRANSACTIONS_NOT_FOUND' });
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
        await logApiRequest(partner_id, key_id, 'transactions', 200, 'OK', 0, req.ip!, true);

        return res.status(200).json({ transactions: safeTransactions });
    } catch (e) {
        await logApiRequest(
            partner_id,
            key_id,
            'transactions',
            500,
            `TRANSACTION_INTERNAL_ERROR: ${e}`,
            0,
            req.ip!,
            false
        );
        return res.status(500).json({ code: 'TRANSACTION_INTERNAL_ERROR' });
    }
});


export default router;

