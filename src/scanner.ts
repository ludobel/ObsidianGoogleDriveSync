import { TFile, Vault } from "obsidian";
import { SyncFilter } from "./filter";
import { LocalFileMeta } from "./types";
import { byteSize, getExtension, isLikelyText, sha256Hex } from "./utils";

export type ScanExclusionStats = { path: number; type: number; size: number };

export class LocalVaultScanner {
  /** Counts of files skipped by the last scan, per reason (for logs and status). */
  lastExclusions: ScanExclusionStats = { path: 0, type: 0, size: 0 };

  constructor(private vault: Vault, private filter: SyncFilter) {}

  async scan(): Promise<Record<string, LocalFileMeta>> {
    const stats: ScanExclusionStats = { path: 0, type: 0, size: 0 };
    const result: Record<string, LocalFileMeta> = {};
    for (const file of this.vault.getFiles()) {
      // Size comes from file.stat, so oversized files are skipped before being read into memory.
      const reason = this.filter.exclusionReason(file.path, file.stat?.size);
      if (reason) {
        stats[reason] += 1;
        continue;
      }
      result[file.path] = await this.scanFile(file);
    }
    this.lastExclusions = stats;
    return result;
  }

  async read(path: string, forceBinary = false): Promise<string | ArrayBuffer> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Local file not found: ${path}`);
    if (!forceBinary && isLikelyText(path)) return this.vault.read(file);
    return this.vault.readBinary(file);
  }

  async readText(path: string): Promise<string> {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Local file not found: ${path}`);
    return this.vault.read(file);
  }

  private async scanFile(file: TFile): Promise<LocalFileMeta> {
    const isText = isLikelyText(file.path);
    const content = isText ? await this.vault.read(file) : await this.vault.readBinary(file);
    return {
      path: file.path,
      hash: await sha256Hex(content),
      size: byteSize(content),
      extension: getExtension(file.path),
      mtime: file.stat.mtime,
      isText
    };
  }
}
