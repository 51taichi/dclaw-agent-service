import "dotenv/config";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const { app, services } = createApp(config);
const server = app.listen(config.port, config.host, () => {
  console.log(`DClaw Agent Service listening on ${config.publicBaseUrl}`);
});
services.activation.start();

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  services.activation.stop();
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
