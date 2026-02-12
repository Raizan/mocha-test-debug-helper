import { exec } from "node:child_process";
import * as path from "node:path";

export class ScriptExecutionError extends Error {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, exitCode: number | null, stdout: string, stderr: string) {
    super(message);
    this.name = "ScriptExecutionError";
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function getConfiguredScriptCommand(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new Error("Setting 'scriptRunner.command' must be a string.");
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function escapeShellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildScriptCommand(baseCommand: string, filePath: string): string {
  return `${baseCommand} ${escapeShellSingleQuote(filePath)}`;
}

export async function runScriptCommand(
  command: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new ScriptExecutionError(
            `Script failed with exit code ${error.code ?? "unknown"}.`,
            typeof error.code === "number" ? error.code : null,
            stdout,
            stderr,
          ),
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export function shouldRunOnSaveForFile(filePath: string, rawExtensions: unknown): boolean {
  if (rawExtensions === undefined || rawExtensions === null) {
    return true;
  }
  if (!Array.isArray(rawExtensions)) {
    throw new Error("Setting 'scriptRunner.runOnSaveExtensions' must be an array of strings.");
  }

  const normalizedExtensions = rawExtensions
    .map((value) => {
      if (typeof value !== "string") {
        throw new Error("Setting 'scriptRunner.runOnSaveExtensions' must contain only strings.");
      }
      const trimmed = value.trim().toLowerCase();
      if (trimmed.length === 0) {
        return "";
      }
      if (trimmed === "*") {
        return "*";
      }
      return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
    })
    .filter((value) => value.length > 0);

  if (normalizedExtensions.length === 0) {
    return true;
  }
  if (normalizedExtensions.includes("*")) {
    return true;
  }

  const fileExtension = path.extname(filePath).toLowerCase();
  return normalizedExtensions.includes(fileExtension);
}
