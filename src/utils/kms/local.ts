// src/utils/kms/local.ts
import crypto from "crypto";
import { KmsAdapter } from "../apiKey"; // your interface with wrap/unwrap

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
