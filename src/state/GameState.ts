export type RoomId = "reception" | "clock" | "security" | "interrogation" | "archive" | "break" | "mirror";

export type ItemId =
  | "blankForm"
  | "rubberStamp"
  | "stampedForm"
  | "visitorBadge"
  | "timeToken"
  | "paperCup"
  | "memoryCup"
  | "misfiledFolder"
  | "mirrorShard"
  | "serverFuse"
  | "rainCipher"
  | "securityKey"
  | "auditWarrant"
  | "selfFile";

export type EndingId = "filed" | "escaped" | "audited";

export interface SaveData {
  room: RoomId;
  inventory: ItemId[];
  flags: Record<string, boolean>;
  ending?: EndingId;
  audioVolume: number;
  muted: boolean;
  largeText: boolean;
  reducedMotion: boolean;
}

interface PreferencesData {
  audioVolume: number;
  muted: boolean;
  largeText: boolean;
  reducedMotion: boolean;
}

const STORAGE_KEY = "department-misplaced-hours-save-v1";
const PREFERENCES_KEY = "department-misplaced-hours-preferences-v1";
const ROOM_IDS: RoomId[] = ["reception", "clock", "security", "interrogation", "archive", "break", "mirror"];
const ITEM_IDS: ItemId[] = [
  "blankForm",
  "rubberStamp",
  "stampedForm",
  "visitorBadge",
  "timeToken",
  "paperCup",
  "memoryCup",
  "misfiledFolder",
  "mirrorShard",
  "serverFuse",
  "rainCipher",
  "securityKey",
  "auditWarrant",
  "selfFile"
];
const ENDING_IDS: EndingId[] = ["filed", "escaped", "audited"];

function isRoomId(value: unknown): value is RoomId {
  return typeof value === "string" && ROOM_IDS.includes(value as RoomId);
}

function isItemId(value: unknown): value is ItemId {
  return typeof value === "string" && ITEM_IDS.includes(value as ItemId);
}

function isEndingId(value: unknown): value is EndingId {
  return typeof value === "string" && ENDING_IDS.includes(value as EndingId);
}

function normalizeVolume(value: unknown, fallback = 0.72): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function normalizeMuted(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeLargeText(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeReducedMotion(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function defaultReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, data: SaveData | PreferencesData): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    // Some privacy modes disable localStorage. The game remains playable without saves.
    return false;
  }
}

function clearStorage(key: string): boolean {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    // Ignore unavailable storage.
    return false;
  }
}

function parseStoredObject(raw: string | null): Partial<SaveData> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<SaveData>) : undefined;
  } catch {
    return undefined;
  }
}

export class GameState {
  room: RoomId = "reception";
  inventory = new Set<ItemId>();
  flags: Record<string, boolean> = {};
  ending?: EndingId;
  audioVolume = 0.72;
  muted = false;
  largeText = false;
  reducedMotion = defaultReducedMotion();
  private storageWriteFailed = false;

  has(item: ItemId): boolean {
    return this.inventory.has(item);
  }

  add(item: ItemId): boolean {
    const hadItem = this.inventory.has(item);
    this.inventory.add(item);
    return !hadItem;
  }

  remove(item: ItemId): void {
    this.inventory.delete(item);
  }

  flag(name: string): boolean {
    return Boolean(this.flags[name]);
  }

  setFlag(name: string, value = true): void {
    this.flags[name] = value;
  }

  toJSON(): SaveData {
    return {
      room: this.room,
      inventory: [...this.inventory],
      flags: this.flags,
      ending: this.ending,
      audioVolume: this.audioVolume,
      muted: this.muted,
      largeText: this.largeText,
      reducedMotion: this.reducedMotion
    };
  }

  save(): void {
    this.trackStorageResult(writeStorage(STORAGE_KEY, this.toJSON()));
    this.savePreferences();
  }

  load(): boolean {
    this.loadPreferences();
    const raw = readStorage(STORAGE_KEY);
    if (!raw) {
      return false;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      this.room = isRoomId(parsed.room) ? parsed.room : "reception";
      this.inventory = new Set((Array.isArray(parsed.inventory) ? parsed.inventory : []).filter(isItemId));
      this.flags = Object.fromEntries(
        Object.entries(parsed.flags ?? {}).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")
      );
      this.ending = isEndingId(parsed.ending) ? parsed.ending : undefined;
      if (!readStorage(PREFERENCES_KEY)) {
        this.audioVolume = normalizeVolume(parsed.audioVolume, this.audioVolume);
        this.muted = normalizeMuted(parsed.muted, this.muted);
        this.largeText = normalizeLargeText(parsed.largeText, this.largeText);
        this.reducedMotion = normalizeReducedMotion(parsed.reducedMotion, this.reducedMotion);
        this.savePreferences();
      }
      this.repairInvariants();
      return true;
    } catch {
      return false;
    }
  }

  loadPreferences(): void {
    const parsed = parseStoredObject(readStorage(PREFERENCES_KEY)) ?? parseStoredObject(readStorage(STORAGE_KEY));
    if (!parsed) {
      return;
    }
    this.audioVolume = normalizeVolume(parsed.audioVolume, this.audioVolume);
    this.muted = normalizeMuted(parsed.muted, this.muted);
    this.largeText = normalizeLargeText(parsed.largeText, this.largeText);
    this.reducedMotion = normalizeReducedMotion(parsed.reducedMotion, this.reducedMotion);
  }

  savePreferences(): void {
    this.trackStorageResult(
      writeStorage(PREFERENCES_KEY, {
        audioVolume: this.audioVolume,
        muted: this.muted,
        largeText: this.largeText,
        reducedMotion: this.reducedMotion
      })
    );
  }

  storageUnavailable(): boolean {
    return this.storageWriteFailed;
  }

  private trackStorageResult(saved: boolean): void {
    if (!saved) {
      this.storageWriteFailed = true;
    }
  }

  repairInvariants(): void {
    const ensureStampedForm = () => {
      this.inventory.delete("blankForm");
      this.inventory.delete("rubberStamp");
      this.inventory.add("stampedForm");
      this.flags.formStamped = true;
    };

    const ensureInnerFloorAccess = () => {
      ensureStampedForm();
      this.flags.clockUnlocked = true;
      this.flags.clockSolved = true;
    };

    const ensureAuditWarrant = () => {
      ensureInnerFloorAccess();
      this.inventory.add("auditWarrant");
      this.flags.evidenceSafeOpened = true;
    };

    const ensureArchiveRecords = () => {
      ensureInnerFloorAccess();
      this.flags.archiveSolved = true;
      this.flags.glassCaseCollected = true;
      this.inventory.add("misfiledFolder");
      this.inventory.add("selfFile");
      if (!this.flag("mirrorShardInstalled")) {
        this.inventory.add("mirrorShard");
      }
    };

    const ensureVendingRewards = () => {
      ensureInnerFloorAccess();
      this.flags.vendingSolved = true;
      this.inventory.delete("timeToken");
      this.inventory.delete("paperCup");
      this.inventory.add("memoryCup");
      if (!this.flag("fuseInstalled")) {
        this.inventory.add("serverFuse");
      }
    };

    const ensureMirrorEntry = () => {
      ensureAuditWarrant();
      ensureArchiveRecords();
      ensureVendingRewards();
    };

    const hasAny = (...items: ItemId[]) => items.some((item) => this.inventory.has(item));
    const endingReached = this.ending !== undefined;

    if (this.flag("formStamped") || this.flag("clockUnlocked")) {
      ensureStampedForm();
    }

    if (
      this.flag("clockSolved") ||
      this.flag("evidenceSafeOpened") ||
      this.flag("archiveSolved") ||
      this.flag("vendingSolved") ||
      hasAny("securityKey", "auditWarrant", "timeToken", "paperCup", "rainCipher", "memoryCup", "serverFuse")
    ) {
      ensureInnerFloorAccess();
    }

    if (this.flag("evidenceSafeOpened") || this.has("auditWarrant") || this.flag("identityVerifiedByWarrant")) {
      ensureAuditWarrant();
    }

    if (this.flag("archiveSolved")) {
      ensureInnerFloorAccess();
      this.flags.archiveSolved = true;
    }

    if (this.flag("glassCaseCollected") || this.flag("mirrorShardInstalled") || hasAny("misfiledFolder", "selfFile", "mirrorShard")) {
      ensureArchiveRecords();
    }

    if (this.flag("vendingSolved") || hasAny("memoryCup", "serverFuse")) {
      ensureVendingRewards();
    }

    if (
      this.flag("mirrorShardInstalled") ||
      this.flag("fuseInstalled") ||
      this.flag("identityVerified") ||
      this.flag("identityVerifiedByWarrant") ||
      this.flag("hourVerified") ||
      this.flag("serverSolved") ||
      endingReached
    ) {
      ensureMirrorEntry();
    }

    if (this.flag("identityVerifiedByWarrant")) {
      this.flags.identityVerified = true;
      ensureAuditWarrant();
    }

    if (this.flag("mirrorShardInstalled") || this.flag("serverSolved") || endingReached) {
      this.flags.mirrorShardInstalled = true;
      this.flags.mirrorClueSeen = true;
      this.inventory.delete("mirrorShard");
    }

    if (this.flag("fuseInstalled") || this.flag("serverSolved") || endingReached) {
      this.flags.fuseInstalled = true;
      this.inventory.delete("serverFuse");
    }

    if (this.flag("identityVerified") || this.flag("serverSolved") || endingReached) {
      this.flags.identityVerified = true;
    }

    if (this.flag("hourVerified") || this.flag("serverSolved") || endingReached) {
      this.flags.hourVerified = true;
      this.flags.hourPresented = true;
      this.inventory.add("memoryCup");
    }

    if (this.flag("serverSolved") || endingReached) {
      this.flags.serverSolved = true;
      this.flags.fuseInstalled = true;
      this.flags.identityVerified = true;
      this.flags.hourVerified = true;
      this.flags.mirrorClueSeen = true;
      this.flags.mirrorShardInstalled = true;
      this.inventory.delete("serverFuse");
      this.inventory.delete("mirrorShard");
      this.inventory.add("memoryCup");
    }
  }

  reset(): void {
    const preferences = {
      audioVolume: this.audioVolume,
      muted: this.muted,
      largeText: this.largeText,
      reducedMotion: this.reducedMotion
    };
    this.room = "reception";
    this.inventory.clear();
    this.flags = {};
    this.ending = undefined;
    this.audioVolume = preferences.audioVolume;
    this.muted = preferences.muted;
    this.largeText = preferences.largeText;
    this.reducedMotion = preferences.reducedMotion;
    this.trackStorageResult(clearStorage(STORAGE_KEY));
    this.savePreferences();
  }

  static hasSave(): boolean {
    return readStorage(STORAGE_KEY) !== null;
  }
}
