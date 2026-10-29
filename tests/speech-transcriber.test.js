import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { SpeechTranscriber } from "../src/services/speech-transcriber.js";

test("speech transcriber sends an OpenAI-compatible multipart request", async () => {
  let captured;
  const transcriber = new SpeechTranscriber({
    apiUrl: "https://speech.example.test/v1/audio/transcriptions",
    apiKey: "speech-secret",
    model: "speech-model",
    language: "zh",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ text: "我想了解国企岗位" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const text = await transcriber.transcribe({ buffer: Buffer.from("audio"), mimeType: "audio/webm", name: "voice.webm" });

  assert.equal(text, "我想了解国企岗位");
  assert.equal(captured.url, "https://speech.example.test/v1/audio/transcriptions");
  assert.equal(captured.options.headers.Authorization, "Bearer speech-secret");
  assert.equal(captured.options.body.get("model"), "speech-model");
  assert.equal(captured.options.body.get("language"), "zh");
  assert.equal(captured.options.body.get("file").name, "voice.webm");
});

test("draft preview uploads audio and sends its transcription to the Agent pipeline", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-speech-preview-"));
  const calls = [];
  const speechTranscriber = {
    isConfigured: () => true,
    async transcribe(input) {
      calls.push(input);
      return "我想了解国企岗位";
    }
  };
  const context = createApp({ databasePath: path.join(directory, "test.sqlite"), agentTimeoutMs: 5000, deliveryMaxAttempts: 1 }, { speechTranscriber });
  const server = context.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    context.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const previewResponse = await fetch(`${baseUrl}/api/admin/deployments/wuhe-miniapp-assistant/preview`);
  const preview = await previewResponse.json();
  assert.equal(preview.endpoints.publicMedia, "/api/admin/deployments/wuhe-miniapp-assistant/preview/media");

  const uploadResponse = await fetch(`${baseUrl}${preview.endpoints.publicMedia}`, {
    method: "POST",
    headers: { "content-type": "audio/webm", "x-file-name": "voice.webm" },
    body: Buffer.from("recorded-audio")
  });
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json();

  const messageResponse = await fetch(`${baseUrl}${preview.endpoints.assistantMessages}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId: "speech-conversation",
      userId: "speech-visitor",
      displayName: "语音测试访客",
      message: { id: "speech-message", type: "audio", text: "[语音消息 2 秒]", attachments: [upload.attachment] }
    })
  });
  assert.equal(messageResponse.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].buffer.toString(), "recorded-audio");

  const inbound = context.db.prepare("SELECT message_type, content, metadata_json FROM messages WHERE direction = 'inbound' ORDER BY id DESC LIMIT 1").get();
  assert.equal(inbound.message_type, "audio");
  assert.equal(inbound.content, "我想了解国企岗位");
  assert.equal(JSON.parse(inbound.metadata_json).transcription, "我想了解国企岗位");
});
