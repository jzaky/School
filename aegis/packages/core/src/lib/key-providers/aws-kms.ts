import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { env } from "../../env.js";
import type { KeyProvider } from "../keyring.js";

/**
 * AWS KMS key provider (official AWS SDK, Apache-2.0). The data key is wrapped with a symmetric KMS
 * key (AEGIS_KMS_KEY_ID); region and credentials come from the standard AWS settings (AWS_REGION,
 * an instance or task role, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY). An encryption context
 * binds the wrapped blob to AEGIS, so a blob wrapped for another purpose under the same KMS key is
 * refused. In the UAE, AWS's region is me-central-1.
 */
export const AWS_ENCRYPTION_CONTEXT = { purpose: "aegis-data-key" };

export function awsKmsProvider(client = new KMSClient({})): KeyProvider {
  const keyId = env().AEGIS_KMS_KEY_ID;
  return {
    name: "aws-kms",
    async unwrap(wrapped) {
      const out = await client.send(new DecryptCommand({ CiphertextBlob: wrapped, EncryptionContext: AWS_ENCRYPTION_CONTEXT, ...(keyId ? { KeyId: keyId } : {}) }));
      if (!out.Plaintext) throw new Error("AWS KMS returned no plaintext");
      return Buffer.from(out.Plaintext);
    },
    async wrap(dataKey) {
      if (!keyId) throw new Error("AEGIS_KMS_KEY_ID is required to wrap a data key with AWS KMS");
      const out = await client.send(new EncryptCommand({ KeyId: keyId, Plaintext: dataKey, EncryptionContext: AWS_ENCRYPTION_CONTEXT }));
      if (!out.CiphertextBlob) throw new Error("AWS KMS returned no ciphertext");
      return Buffer.from(out.CiphertextBlob);
    },
  };
}
