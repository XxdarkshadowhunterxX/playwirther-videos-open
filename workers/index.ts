// workers/index.ts — Entry point de todos os workers
// Executar com: npm run worker:start

import "dotenv/config";
import { transcriptionWorker } from "./transcriptionWorker";
import { exportWorker } from "./exportWorker";
import { motionWorker } from "./motionWorker";

console.log("🚀 Workers iniciados:");
console.log("  ✅ transcriptionWorker — ouvindo fila 'video-processing'");
console.log("  ✅ exportWorker        — ouvindo fila 'video-export'");
console.log("  ✅ motionWorker        — ouvindo fila 'motion-graphics'");

async function shutdown() {
  console.log("\n⏹️  Encerrando workers graciosamente...");
  await Promise.all([
    transcriptionWorker.close(),
    exportWorker.close(),
    motionWorker.close(),
  ]);
  console.log("✅ Workers encerrados.");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
