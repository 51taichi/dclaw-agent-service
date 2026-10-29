import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class CredentialVault {
  constructor(secret = "") {
    this.configured = Boolean(String(secret || "").trim());
    this.key = this.configured ? createHash("sha256").update(String(secret)).digest() : null;
  }

  isConfigured() {
    return this.configured;
  }

  encrypt(value) {
    this.assertConfigured();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  decrypt(value) {
    this.assertConfigured();
    const [version, encodedIv, encodedTag, encodedValue, extra] = String(value || "").split(".");
    if (version !== "v1" || !encodedIv || !encodedTag || !encodedValue || extra) throw new Error("小程序密钥数据无效");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encodedIv, "base64url"));
      decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(encodedValue, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("小程序密钥无法解密，请检查主加密密钥");
    }
  }

  assertConfigured() {
    if (!this.configured) {
      const error = new Error("凭证主加密密钥尚未配置");
      error.status = 503;
      throw error;
    }
  }
}
