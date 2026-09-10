export function resolveServiceCommands(env = process.env) {
  const isBetaWebService =
    env.RAILWAY_SERVICE_NAME === "beta-web" ||
    (Boolean(env.VITE_API_URL) && !env.DATABASE_URL);
  if (isBetaWebService) return [["node", ["apps/beta-web/server.mjs"]]];

  if (env.RAILWAY_SERVICE_NAME === "orchestra-worker") {
    return [["node", ["dist/src/worker.js"]]];
  }

  return [["node", ["dist/src/server.js"]]];
}
