/**
 * Sync eligibility rules: ignored paths (with glob support), excluded file types
 * and a configurable maximum file size.
 *
 * A file rejected by this filter is invisible to the sync engine on this device:
 * it is never uploaded, downloaded, or deleted (locally or remotely).
 */

/** Hard ceiling: Obsidian reads whole files into memory and cannot read more than 2 GiB. */
export const HARD_MAX_FILE_SIZE_MB = 1900;
export const DEFAULT_MAX_FILE_SIZE_MB = 500;

export type SyncFilterSettings = {
  ignoredPaths: string;
  excludedExtensions: string;
  maxFileSizeMB: number;
};

export type ExclusionReason = "path" | "type" | "size";

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
}

function hasGlob(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

function escapeRegExp(char: string): string {
  return char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Glob syntax: `*` = any characters except "/", `**` = any characters,
 * `**` followed by "/" = zero or more folders, `?` = exactly one character.
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`, "i");
}

type CompiledPattern = (path: string) => boolean;

function compilePattern(rawPattern: string): CompiledPattern | null {
  const clean = normalize(rawPattern.trim());
  if (!clean) return null;
  if (hasGlob(clean)) {
    const folderGlob = clean.endsWith("/");
    const regex = globToRegExp(folderGlob ? `${clean}**` : clean);
    const matchBasename = !clean.includes("/");
    return (path) => {
      if (regex.test(path)) return true;
      if (matchBasename) return regex.test(path.split("/").pop() ?? path);
      return false;
    };
  }
  // Legacy behaviour (kept identical): exact path or folder prefix.
  if (clean.endsWith("/")) return (path) => path.startsWith(clean);
  return (path) => path === clean || path.startsWith(`${clean}/`);
}

export function compileIgnorePatterns(value: string): CompiledPattern[] {
  return value
    .split(/\r?\n/)
    .map((line) => compilePattern(line))
    .filter((pattern): pattern is CompiledPattern => pattern !== null);
}

export function matchesIgnorePatterns(path: string, patterns: string[]): boolean {
  const normalized = normalize(path);
  return compileIgnorePatterns(patterns.join("\n")).some((matches) => matches(normalized));
}

/** Accepts "mp4, .m4a; *.MOV mkv" -> {mp4, m4a, mov, mkv}. */
export function parseExtensionList(value: string): Set<string> {
  return new Set(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase().replace(/^\*?\./, ""))
      .filter(Boolean)
  );
}

function extensionOf(path: string): string {
  const last = path.split("/").pop() ?? "";
  const index = last.lastIndexOf(".");
  return index > 0 ? last.slice(index + 1).toLowerCase() : "";
}

export function effectiveMaxFileSizeMB(value: number): number {
  const mb = Number(value);
  if (!Number.isFinite(mb) || mb <= 0) return HARD_MAX_FILE_SIZE_MB;
  return Math.min(mb, HARD_MAX_FILE_SIZE_MB);
}

export class SyncFilter {
  private cacheKey = "";
  private patterns: CompiledPattern[] = [];
  private extensions = new Set<string>();

  constructor(private getSettings: () => SyncFilterSettings) {}

  private refresh(): SyncFilterSettings {
    const settings = this.getSettings();
    const key = `${settings.ignoredPaths}\u0000${settings.excludedExtensions}`;
    if (key !== this.cacheKey) {
      this.patterns = compileIgnorePatterns(settings.ignoredPaths ?? "");
      this.extensions = parseExtensionList(settings.excludedExtensions ?? "");
      this.cacheKey = key;
    }
    return settings;
  }

  maxBytes(): number {
    const settings = this.refresh();
    return Math.floor(effectiveMaxFileSizeMB(settings.maxFileSizeMB) * 1024 * 1024);
  }

  /** Reason a path is excluded by its name alone (ignored path or file type), or null. */
  pathExclusionReason(path: string): ExclusionReason | null {
    this.refresh();
    const normalized = normalize(path);
    if (this.patterns.some((matches) => matches(normalized))) return "path";
    const extension = extensionOf(normalized);
    if (extension && this.extensions.has(extension)) return "type";
    return null;
  }

  isPathExcluded(path: string): boolean {
    return this.pathExclusionReason(path) !== null;
  }

  isSizeExcluded(size: number | undefined): boolean {
    return typeof size === "number" && Number.isFinite(size) && size > this.maxBytes();
  }

  exclusionReason(path: string, size?: number): ExclusionReason | null {
    return this.pathExclusionReason(path) ?? (this.isSizeExcluded(size) ? "size" : null);
  }
}
