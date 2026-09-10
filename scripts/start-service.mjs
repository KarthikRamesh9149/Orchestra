import { spawn } from "node:child_process";
import { resolveServiceCommands } from "./start-service-plan.mjs";

function startService(env = process.env) {
  const children = resolveServiceCommands(env).map(([executable, args]) =>
    spawn(executable, args, {
      stdio: "inherit",
      shell: process.platform === "win32"
    })
  );
  let stopping = false;

  const stopSiblings = (exitedChild, signal = "SIGTERM") => {
    for (const child of children) {
      if (child !== exitedChild && child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    }
  };

  for (const child of children) {
    child.on("error", (error) => {
      if (stopping) return;
      stopping = true;
      console.error(error);
      stopSiblings(child);
      process.exitCode = 1;
    });
    child.on("exit", (code, signal) => {
      if (stopping) return;
      stopping = true;
      stopSiblings(child);
      process.exitCode = signal ? 1 : (code ?? 0);
    });
  }

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      stopSiblings(undefined, signal);
    });
  }

  return children;
}

startService();
