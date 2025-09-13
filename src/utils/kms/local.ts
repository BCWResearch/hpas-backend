// src/utils/kms/local.ts
import crypto from "crypto";
import { KmsAdapter } from "../apiKey"; // your interface with wrap/unwrap
import { KeyManagementServiceClient } from "@google-cloud/kms";

// Load a single master key from env (32 bytes for AES-256)
const MASTER_KEY = Buffer.from(
  process.env.LOCAL_KMS_MASTER_KEY ?? crypto.randomBytes(32).toString("hex"),
  "hex"
);

/**
 * Local dev "KMS" adapter.
 * Not secure for prod — just simulates wrap/unwrap using AES-GCM with one master key.
 */
export function makeLocalKmsAdapter(): KmsAdapter {
  return {
    kmsKeyId: "local-dev", // fixed identifier

    async wrap(dek: Buffer): Promise<Buffer> {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", MASTER_KEY, iv);
      const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, ct]);
    },

    async unwrap(wrappedDek: Buffer): Promise<Buffer> {
      const iv = wrappedDek.subarray(0, 12);
      const tag = wrappedDek.subarray(12, 28);
      const ct = wrappedDek.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", MASTER_KEY, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    },
  };
}



const KEY_NAME = process.env.GCP_KMS_KEY_NAME ?? "";

if (!KEY_NAME) {
  throw new Error(
    "GCP_KMS_KEY_NAME is not set. Expected format: projects/<PROJECT>/locations/<LOC>/keyRings/<RING>/cryptoKeys/<KEY>"
  );
}
/**
 * Local dev "KMS" adapter.
 * Not secure for prod — just simulates wrap/unwrap using AES-GCM with one master key.
 */

export function makeGcpKmsAdapter(): KmsAdapter {
  const KEY_NAME = process.env.GCP_KMS_KEY_NAME;
  if (!KEY_NAME) {
    throw new Error(
      "GCP_KMS_KEY_NAME is not set. Expected: projects/<PROJECT>/locations/<LOC>/keyRings/<RING>/cryptoKeys/<KEY>"
    );
  }

  const client = new KeyManagementServiceClient(
    process.env.GCP_KMS_ENDPOINT ? { apiEndpoint: process.env.GCP_KMS_ENDPOINT } : undefined
  );

  return {
    kmsKeyId: KEY_NAME,

    async wrap(dek: Buffer): Promise<Buffer> {
      const [resp] = await client.encrypt({
        name: KEY_NAME,
        plaintext: dek,
      });
      if (!resp.ciphertext) throw new Error("KMS encrypt returned no ciphertext");
      return Buffer.from(resp.ciphertext);
    },

    async unwrap(wrappedDek: Buffer): Promise<Buffer> {
      const [resp] = await client.decrypt({
        name: KEY_NAME,
        ciphertext: wrappedDek,
      });
      if (!resp.plaintext) throw new Error("KMS decrypt returned no plaintext");
      return Buffer.from(resp.plaintext);
    },
  };
}