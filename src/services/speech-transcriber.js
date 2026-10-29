export class SpeechTranscriber {
  constructor({ apiUrl = "", apiKey = "", model = "", language = "zh", timeoutMs = 60_000, fetchImpl = globalThis.fetch } = {}) {
    this.apiUrl = String(apiUrl || "").trim();
    this.apiKey = String(apiKey || "").trim();
    this.model = String(model || "").trim();
    this.language = String(language || "").trim();
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.apiUrl && this.model);
  }

  async transcribe({ buffer, mimeType = "audio/mpeg", name = "voice.mp3" }) {
    if (!this.isConfigured()) return "";
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError("Audio content is empty");

    const form = new FormData();
    form.set("file", new Blob([buffer], { type: mimeType }), name);
    form.set("model", this.model);
    if (this.language) form.set("language", this.language);

    const headers = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const response = await this.fetch(this.apiUrl, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 1000);
      const error = new Error(`Speech transcription failed (${response.status}): ${body}`);
      error.status = 502;
      throw error;
    }

    const payload = await response.json().catch(() => ({}));
    const text = String(payload?.text ?? payload?.data?.text ?? payload?.result?.text ?? "").trim();
    if (!text) {
      const error = new Error("Speech transcription returned no text");
      error.status = 502;
      throw error;
    }
    return text.slice(0, 20_000);
  }
}
