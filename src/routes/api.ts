// Move to HPAS

import express from "express";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { getHederaClient } from "../utils/getHederaClient";
import { AccountBalance, AccountBalanceQuery, AccountCreateTransaction, Client, Hbar, PrivateKey, PublicKey, TransferTransaction } from "@hashgraph/sdk";
import { makeGcpKmsAdapter, makeLocalKmsAdapter } from "../utils/kms/local";
import { getDripAndFees } from "../utils/drip/getDripAndFees";
const prisma = new PrismaClient();
dotenv.config();
const router = express.Router();
const operatorId = process.env.HEDERA_TREASURY_ACCOUNT_ID;
const operatorKey = process.env.HEDERA_TREASURY_PVT_KEY;

const kmsAdapter =
    process.env.KEY_ENV === "gcp"
        ? makeGcpKmsAdapter()
        : makeLocalKmsAdapter();

// Checks DB to ensure that a partner can be created + Creates a new partner account + adds them to the DB

// Admin control routes

// add new partners


// Partner Portal routes

// Partner API routes

// controls drips for partners
router.post('/drip', async (req, res) => {

    const api_key = req.headers['X-API-KEY'];

    // verify api key here or in middleware

    const { recipient_account_id, sender_account_id, drip_amount_in_usd, partner_id } = req.body;

    // verification that recipient_account_id is correct, we will obtain the sender_account_id from the middleware, and set the drip amount here

    // Get the pvt key from the kms to use here.
    const { sender_account_pkey } = await getPartnerKeyFromKMS(sender_account_id);

    // get the drip_amount_in_hbar + fee_amount_in_hbar
    const { drip_amount_in_hbar, fee_amount_in_hbar, total_amount_in_hbar } = await getDripAndFees(drip_amount_in_usd);

    // create a client using the sender_account_id and the sender_account_id from the kms
    const client = Client.forMainnet();
    client.setOperator(
        sender_account_id,
        sender_account_pkey
    );


    // Batch transaction 
    const transaction = new TransferTransaction()
        .addHbarTransfer(sender_account_id, new Hbar(-total_amount_in_hbar))
        .addHbarTransfer(operatorId!, new Hbar(fee_amount_in_hbar))
        .addHbarTransfer(recipient_account_id, new Hbar(drip_amount_in_hbar));

    const txResponse = await transaction.execute(client);

    const txId = txResponse.transactionId.toString();

    const receipt = await txResponse.getReceipt(client);

    // Check Balance of Sender Account, then compare to threshold. If threshold is reached, we can 
    const query = new AccountBalanceQuery()
        .setAccountId(sender_account_id);
    const accountBalance = await query.execute(client);

    // Alert everyone on the team that is a admin or owner rank!
    const email_list = await prisma.apiPartnerUser.findMany({
        where: {
            partnerId: partner_id,
            OR: [
                { role: 'OWNER' },
                { role: 'ADMIN' },
            ]
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
    if (accountBalance.hbars < new Hbar(threshold_info.threshold) && !threshold_info.thresholdTriggered) {
        // send a low balance email to the partner's email
        await sendLowBalanceEmail(email_list, accountBalance.hbars, threshold_info.threshold);
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
        txId,
        status: receipt.status.toString(),
        sender_account_id,
        recipient_account_id,
        amount: total_amount_in_hbar,
    });

    return res.status(200).json({ code: 'DRIP_SUCCESSFUL', transactionId: txId });


});


export default router;

async function getPartnerKeyFromKMS(sender_account_id: string): Promise<{ sender_account_pkey: PrivateKey; sender_account_pbkey: PublicKey } | { sender_account_pkey: string; sender_account_pbkey: string }> {

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




function sendLowBalanceEmail(partner_email: any, hbars: Hbar, threshold: any) {
    throw new Error("Function not implemented.");
}

