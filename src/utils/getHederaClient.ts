import { Client, PrivateKey } from "@hashgraph/sdk";

export function getHederaClient(network: string): Client {
    if (network === "mainnet") {
        const TREASURY_KEY = PrivateKey.fromStringDer(process.env.HEDERA_TREASURY_PVT_KEY!);

        const client = Client.forMainnet();
        client.setOperator(
            process.env.HEDERA_TREASURY_ACCOUNT_ID!,
            TREASURY_KEY
        );
        return client;
    } else {
        const client = Client.forTestnet();
        client.setOperator(
            process.env.HEDERA_TESTNET_ACCOUNT_ID!,
            process.env.HEDERA_TESTNET_PVT_KEY!
        );
        return client;
    }
}
