import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";

const ProductDirectory = "restitutor";
const StandaloneProfile = "local";
const RollingBackupLimit = 10;

export type SaveStoreErrorCode = "missing" | "permission" | "io" | "invalid";

export class SaveStoreError extends Error {
   public constructor(
      public readonly code: SaveStoreErrorCode,
      public readonly targetPath: string,
      message: string,
   ) {
      super(message);
      this.name = "SaveStoreError";
   }
}

export type SaveStoreOperation =
   | "read"
   | "write"
   | "rolling-backup"
   | "archive-snapshot"
   | "replace";

export type SaveStoreOperationLog = {
   timestamp: string;
   operation: SaveStoreOperation;
   name: string;
   outcome: "success" | "failure";
   bytes?: number;
   hash?: string;
   errorCode?: SaveStoreErrorCode;
};

export type SaveStoreOptions = {
   dataHome?: string;
   now?: () => Date;
};

export class SaveStore {
   private readonly now: () => Date;
   public readonly profileRoot: string;
   public readonly rollingRoot: string;
   public readonly archiveRoot: string;
   private readonly logPath: string;

   public constructor(options: SaveStoreOptions = {}) {
      const dataHome = options.dataHome ?? process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share");
      this.profileRoot = path.join(path.resolve(dataHome), ProductDirectory, "saves", StandaloneProfile);
      this.rollingRoot = path.join(this.profileRoot, "rolling");
      this.archiveRoot = path.join(this.profileRoot, "archive");
      this.logPath = path.join(this.profileRoot, "operations.jsonl");
      this.now = options.now ?? (() => new Date());
   }

   public primaryPath(name: string): string {
      return path.join(this.profileRoot, this.safeName(name));
   }

   public async read(name: string): Promise<Buffer> {
      const targetPath = this.primaryPath(name);
      try {
         const data = await readFile(targetPath);
         await this.record({
            timestamp: this.now().toISOString(),
            operation: "read",
            name,
            outcome: "success",
            bytes: data.byteLength,
            hash: this.hash(data),
         });
         return data;
      } catch (error) {
         const saveError = this.toSaveError(error, targetPath, `Unable to read ${name}`);
         await this.record({ timestamp: this.now().toISOString(), operation: "read", name, outcome: "failure", errorCode: saveError.code });
         throw saveError;
      }
   }

   public async write(name: string, data: Uint8Array): Promise<void> {
      const targetPath = this.primaryPath(name);
      try {
         await this.atomicWrite(targetPath, data);
         await this.record({
            timestamp: this.now().toISOString(),
            operation: "write",
            name,
            outcome: "success",
            bytes: data.byteLength,
            hash: this.hash(data),
         });
      } catch (error) {
         const saveError = this.toSaveError(error, targetPath, `Unable to write ${name}`);
         await this.record({ timestamp: this.now().toISOString(), operation: "write", name, outcome: "failure", errorCode: saveError.code });
         throw saveError;
      }
   }

   public async createRollingBackup(name: string, data: Uint8Array): Promise<string> {
      const timestamp = this.timestamp();
      const backupName = `${this.safeName(name)}-${timestamp}-${randomUUID()}.bak`;
      const backupPath = path.join(this.rollingRoot, backupName);
      try {
         await this.atomicWrite(backupPath, data);
         await this.pruneRollingBackups(name);
         await this.record({
            timestamp: this.now().toISOString(),
            operation: "rolling-backup",
            name,
            outcome: "success",
            bytes: data.byteLength,
            hash: this.hash(data),
         });
         return backupPath;
      } catch (error) {
         const saveError = this.toSaveError(error, backupPath, `Unable to create rolling backup for ${name}`);
         await this.record({ timestamp: this.now().toISOString(), operation: "rolling-backup", name, outcome: "failure", errorCode: saveError.code });
         throw saveError;
      }
   }

   public async createArchiveSnapshot(label: string, name: string, data: Uint8Array): Promise<string> {
      const snapshotName = `${this.safeName(label)}-${this.safeName(name)}-${this.timestamp()}-${randomUUID()}.snapshot`;
      const snapshotPath = path.join(this.archiveRoot, snapshotName);
      try {
         await this.atomicWrite(snapshotPath, data);
         await this.record({
            timestamp: this.now().toISOString(),
            operation: "archive-snapshot",
            name,
            outcome: "success",
            bytes: data.byteLength,
            hash: this.hash(data),
         });
         return snapshotPath;
      } catch (error) {
         const saveError = this.toSaveError(error, snapshotPath, `Unable to archive ${name}`);
         await this.record({ timestamp: this.now().toISOString(), operation: "archive-snapshot", name, outcome: "failure", errorCode: saveError.code });
         throw saveError;
      }
   }

   public async replace(name: string, data: Uint8Array, reason: string): Promise<string | undefined> {
      let previous: Buffer | undefined;
      try {
         previous = await this.read(name);
      } catch (error) {
         if (!(error instanceof SaveStoreError) || error.code !== "missing") {
            throw error;
         }
      }
      const archivePath = previous ? await this.createArchiveSnapshot(reason, name, previous) : undefined;
      await this.write(name, data);
      await this.record({ timestamp: this.now().toISOString(), operation: "replace", name, outcome: "success", bytes: data.byteLength, hash: this.hash(data) });
      return archivePath;
   }

   private async atomicWrite(targetPath: string, data: Uint8Array): Promise<void> {
      await mkdir(path.dirname(targetPath), { recursive: true });
      const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
      try {
         await writeFile(temporaryPath, data, { flag: "wx", mode: 0o600 });
         await rename(temporaryPath, targetPath);
      } catch (error) {
         await unlink(temporaryPath).catch(() => undefined);
         throw error;
      }
   }

   private async pruneRollingBackups(name: string): Promise<void> {
      const prefix = `${this.safeName(name)}-`;
      const entries = await readdir(this.rollingRoot, { withFileTypes: true });
      const backups = await Promise.all(
         entries
            .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
            .map(async (entry) => ({ name: entry.name, modified: (await stat(path.join(this.rollingRoot, entry.name))).mtimeMs })),
      );
      backups.sort((a, b) => b.modified - a.modified);
      await Promise.all(backups.slice(RollingBackupLimit).map((backup) => unlink(path.join(this.rollingRoot, backup.name))));
   }

   private async record(entry: SaveStoreOperationLog): Promise<void> {
      try {
         await mkdir(this.profileRoot, { recursive: true });
         await writeFile(this.logPath, `${JSON.stringify(entry)}\n`, { flag: "a", mode: 0o600 });
      } catch {
         // A diagnostic failure must never turn a successful save operation into a save failure.
      }
   }

   private timestamp(): string {
      return this.now().toISOString().replace(/[:.]/g, "-");
   }

   private hash(data: Uint8Array): string {
      return createHash("sha256").update(data).digest("hex");
   }

   private safeName(name: string): string {
      if (!name || name === "." || name === ".." || path.basename(name) !== name || name.includes("\0")) {
         throw new SaveStoreError("invalid", this.profileRoot, `Invalid save name: ${name}`);
      }
      return name;
   }

   private toSaveError(error: unknown, targetPath: string, message: string): SaveStoreError {
      if (error instanceof SaveStoreError) return error;
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      const errorCode: SaveStoreErrorCode = code === "ENOENT" ? "missing" : code === "EACCES" || code === "EPERM" ? "permission" : "io";
      return new SaveStoreError(errorCode, targetPath, message);
   }
}
