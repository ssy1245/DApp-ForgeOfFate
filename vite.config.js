import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createPriceService, priceMiddleware } from "./server/prices.js";
import { createHistoryService, historyMiddleware } from "./server/history.js";

export default defineConfig(({ mode }) => {
  // This key stays in the Node process and is never exposed through VITE_*.
  const env = loadEnv(mode, process.cwd(), "COIN_");
  const middleware = priceMiddleware(createPriceService({ apiKey: env.COIN_API_KEY }));
  const history = historyMiddleware(createHistoryService({ apiKey: env.COIN_API_KEY }));
  return {
    plugins: [
      react(),
      {
        name: "market-prices-api",
        configureServer(server) { server.middlewares.use(middleware); server.middlewares.use(history); },
        configurePreviewServer(server) { server.middlewares.use(middleware); server.middlewares.use(history); },
      },
    ],
  };
});
