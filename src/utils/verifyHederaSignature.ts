import { PublicKey } from "@hashgraph/sdk";
import { proto } from "@hashgraph/proto";

/** identical to HWC logic, backend-safe */
function prefixMessageToSign(message: string) {
  return '\x19Hedera Signed Message:\n' + message.length + message
}

/** backend-safe parser for SignatureMap base64 */
function base64StringToSignatureMap(sigMapB64: string) {
    const bytes = Buffer.from(sigMapB64, "base64");
    return proto.SignatureMap.decode(bytes);
}
export async function verifyHederaSignature({
    accountId,
    nonce,
    sigMapB64,
}: {
    accountId: string;
    nonce: string;
    sigMapB64: string;
}): Promise<boolean> {
    // fetch account keys from mirror node
    const resp = await fetch(`https://mainnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`);
    if (!resp.ok) throw new Error(`Mirror returned ${resp.status}`);
    const data = await resp.json();
    const keys: string[] = [];
    if (data.key?.key) keys.push(data.key.key);
    if (data.key?.key_list?.keys) {
        for (const k of data.key.key_list.keys) if (k.key) keys.push(k.key);
    }
    if (!keys.length) return false;
    // decode signatureMap from base64 string
    const signatureMap = base64StringToSignatureMap(sigMapB64)
    const signature = signatureMap.sigPair[0].ed25519 || signatureMap.sigPair[0].ECDSASecp256k1
    if (!signature) throw new Error('Signature not found in signature map')
    // try verifying with each key
    for (const k of keys) {
        try {
            const pub = PublicKey.fromString(k);
            if (pub.verify(Buffer.from(prefixMessageToSign(nonce)), signature)) return true;
        } catch {
            // ignore bad pubkey
        }
    }

    return false;
}
