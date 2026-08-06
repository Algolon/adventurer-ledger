/**
 * M2.1 character repository contracts and their Dexie adapters.
 *
 * Repositories accept domain records or typed commands and expose no React
 * concepts. They never calculate derived values and never open their own
 * transaction: the calling application service opens one Dexie transaction and
 * every repository call inside that callback joins it, so a throw rolls back the
 * whole operation. Compare-and-swap helpers return `false` on a revision
 * mismatch so services can produce a typed stale outcome instead of an exception
 * string.
 */
import type {
  CharacterActionRecord,
  CharacterDerivedSnapshotRecord,
  CharacterDraftRecord,
  CharacterOverrideRecord,
  CharacterRecord,
  CharacterRuntimeStateRecord,
  CharacterSnapshotRecord,
  CharacterVersionRecord,
} from "@/src/domain/character-record";
import type { ContentEntry, ContentPack, ID, ISODate, RulesetProfile } from "@/src/domain/model";
import type { LedgerDB } from "@/src/storage/db";

export interface CharacterRepository {
  get(id: ID): Promise<CharacterRecord | undefined>;
  list(): Promise<CharacterRecord[]>;
  /** Fails when the record already exists; used for the must-not-exist precondition. */
  add(record: CharacterRecord): Promise<void>;
  /** Compare-and-swap. Returns false when the stored revision differs. */
  replace(record: CharacterRecord, expectedRevision: number): Promise<boolean>;
}

export interface CharacterVersionRepository {
  listByCharacter(characterId: ID): Promise<CharacterVersionRecord[]>;
  latestSequence(characterId: ID): Promise<number>;
  /** Appends immutable history. Rejects a duplicate sequence or operation ID. */
  append(version: CharacterVersionRecord): Promise<void>;
  get(id: ID): Promise<CharacterVersionRecord | undefined>;
}

export interface CharacterSnapshotRepository {
  listByCharacter(characterId: ID): Promise<CharacterSnapshotRecord[]>;
  get(id: ID): Promise<CharacterSnapshotRecord | undefined>;
  add(snapshot: CharacterSnapshotRecord): Promise<void>;
}

export interface CharacterRuntimeStateRepository {
  get(characterId: ID): Promise<CharacterRuntimeStateRecord | undefined>;
  put(state: CharacterRuntimeStateRecord): Promise<void>;
  /** Compare-and-swap on the runtime revision. */
  replace(state: CharacterRuntimeStateRecord, expectedRevision: number): Promise<boolean>;
  delete(characterId: ID): Promise<void>;
}

export interface CharacterActionLogRepository {
  /** Bounded history, newest first. Note bodies are omitted from summaries by the service. */
  listByCharacter(characterId: ID, limit?: number): Promise<CharacterActionRecord[]>;
  latestSequence(characterId: ID): Promise<number>;
  get(id: ID): Promise<CharacterActionRecord | undefined>;
  append(action: CharacterActionRecord): Promise<void>;
  /** Marks an action as no longer reversible once an undo consumed it. */
  markConsumed(id: ID): Promise<void>;
  /**
   * Discards a character's session history. Used only where the aggregate is
   * replaced wholesale, so the old log cannot be presented as history of the
   * incoming state.
   */
  deleteByCharacter(characterId: ID): Promise<void>;
}

export interface CharacterDraftRepository {
  get(id: ID): Promise<CharacterDraftRecord | undefined>;
  list(): Promise<CharacterDraftRecord[]>;
  /** Drafts bound to one committed character, newest first. */
  listByEditingCharacter(characterId: ID): Promise<CharacterDraftRecord[]>;
  add(draft: CharacterDraftRecord): Promise<void>;
  /** Compare-and-swap on the draft revision. */
  replace(draft: CharacterDraftRecord, expectedRevision: number): Promise<boolean>;
}

export interface CharacterOverrideRepository {
  listByCharacter(characterId: ID): Promise<CharacterOverrideRecord[]>;
  put(override: CharacterOverrideRecord): Promise<void>;
  delete(id: ID): Promise<void>;
  deleteByCharacter(characterId: ID): Promise<void>;
}

export interface CharacterDerivedSnapshotRepository {
  get(characterId: ID): Promise<CharacterDerivedSnapshotRecord | undefined>;
  put(snapshot: CharacterDerivedSnapshotRecord): Promise<void>;
}

/** Read-only content and ruleset access for planners and the derived resolver. */
export interface ContentQueryPort {
  listEntries(): Promise<ContentEntry[]>;
  getRuleset(id: ID): Promise<RulesetProfile | undefined>;
  listRulesets(): Promise<RulesetProfile[]>;
  listPacks(): Promise<ContentPack[]>;
}

/**
 * Ruleset profile writes and the explicit active-ruleset decision.
 *
 * Separate from the read port because installing a ruleset is a mutation the
 * content services own, while every planner and the resolver only ever read.
 */
export interface RulesetWritePort {
  put(profile: RulesetProfile): Promise<void>;
  /** The explicitly chosen ruleset, or undefined when the user has not chosen. */
  getActiveRulesetId(): Promise<ID | undefined>;
  setActiveRulesetId(id: ID, now: ISODate): Promise<void>;
  clearActiveRulesetId(): Promise<void>;
}

export class DexieCharacterRepository implements CharacterRepository {
  constructor(private readonly database: LedgerDB) {}
  get(id: ID) {
    return this.database.characters.get(id);
  }
  list() {
    return this.database.characters.orderBy("updatedAt").reverse().toArray();
  }
  async add(record: CharacterRecord) {
    await this.database.characters.add(record);
  }
  async replace(record: CharacterRecord, expectedRevision: number) {
    const current = await this.database.characters.get(record.id);
    if (!current || current.revision !== expectedRevision) return false;
    await this.database.characters.put(record);
    return true;
  }
}

export class DexieCharacterVersionRepository implements CharacterVersionRepository {
  constructor(private readonly database: LedgerDB) {}
  listByCharacter(characterId: ID) {
    return this.database.characterVersions.where("characterId").equals(characterId).sortBy("sequence");
  }
  async latestSequence(characterId: ID) {
    const versions = await this.listByCharacter(characterId);
    return versions.reduce((highest, version) => Math.max(highest, version.sequence), 0);
  }
  get(id: ID) {
    return this.database.characterVersions.get(id);
  }
  async append(version: CharacterVersionRecord) {
    const existingSequence = await this.database.characterVersions
      .where("[characterId+sequence]")
      .equals([version.characterId, version.sequence])
      .count();
    if (existingSequence) throw new Error(`Character version sequence ${version.sequence} already exists for ${version.characterId}`);
    const duplicateOperation = await this.database.characterVersions.where("operationId").equals(version.operationId).count();
    if (duplicateOperation) throw new Error(`Character version operation ${version.operationId} already exists`);
    await this.database.characterVersions.add(version);
  }
}

export class DexieCharacterSnapshotRepository implements CharacterSnapshotRepository {
  constructor(private readonly database: LedgerDB) {}
  listByCharacter(characterId: ID) {
    return this.database.characterSnapshots.where("characterId").equals(characterId).sortBy("createdAt");
  }
  get(id: ID) {
    return this.database.characterSnapshots.get(id);
  }
  async add(snapshot: CharacterSnapshotRecord) {
    await this.database.characterSnapshots.add(snapshot);
  }
}

export class DexieCharacterRuntimeStateRepository implements CharacterRuntimeStateRepository {
  constructor(private readonly database: LedgerDB) {}
  get(characterId: ID) {
    return this.database.characterRuntimeStates.get(characterId);
  }
  async put(state: CharacterRuntimeStateRecord) {
    await this.database.characterRuntimeStates.put(state);
  }
  async replace(state: CharacterRuntimeStateRecord, expectedRevision: number) {
    const current = await this.database.characterRuntimeStates.get(state.characterId);
    if (!current || current.revision !== expectedRevision) return false;
    await this.database.characterRuntimeStates.put(state);
    return true;
  }
  async delete(characterId: ID) {
    await this.database.characterRuntimeStates.delete(characterId);
  }
}

export class DexieCharacterActionLogRepository implements CharacterActionLogRepository {
  constructor(private readonly database: LedgerDB) {}
  async listByCharacter(characterId: ID, limit = 50) {
    const actions = await this.database.characterActions.where("characterId").equals(characterId).sortBy("sequence");
    return actions.reverse().slice(0, limit);
  }
  async latestSequence(characterId: ID) {
    const actions = await this.database.characterActions.where("characterId").equals(characterId).sortBy("sequence");
    return actions.reduce((highest, action) => Math.max(highest, action.sequence), 0);
  }
  get(id: ID) {
    return this.database.characterActions.get(id);
  }
  async append(action: CharacterActionRecord) {
    const duplicate = await this.database.characterActions.where("operationId").equals(action.operationId).count();
    if (duplicate) throw new Error(`Session action operation ${action.operationId} already exists`);
    await this.database.characterActions.add(action);
  }
  async markConsumed(id: ID) {
    const current = await this.database.characterActions.get(id);
    if (!current) return;
    await this.database.characterActions.put({ ...current, reversible: false });
  }
  async deleteByCharacter(characterId: ID) {
    await this.database.characterActions.where("characterId").equals(characterId).delete();
  }
}

export class DexieCharacterDraftRepository implements CharacterDraftRepository {
  constructor(private readonly database: LedgerDB) {}
  get(id: ID) {
    return this.database.characterDrafts.get(id);
  }
  list() {
    return this.database.characterDrafts.orderBy("updatedAt").reverse().toArray();
  }
  async listByEditingCharacter(characterId: ID) {
    const drafts = await this.database.characterDrafts.where("editingCharacterId").equals(characterId).toArray();
    return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  async add(draft: CharacterDraftRecord) {
    await this.database.characterDrafts.add(draft);
  }
  async replace(draft: CharacterDraftRecord, expectedRevision: number) {
    const current = await this.database.characterDrafts.get(draft.id);
    if (!current || current.revision !== expectedRevision) return false;
    await this.database.characterDrafts.put(draft);
    return true;
  }
}

export class DexieCharacterOverrideRepository implements CharacterOverrideRepository {
  constructor(private readonly database: LedgerDB) {}
  listByCharacter(characterId: ID) {
    return this.database.characterOverrides.where("characterId").equals(characterId).sortBy("targetPath");
  }
  async put(override: CharacterOverrideRecord) {
    await this.database.characterOverrides.put(override);
  }
  async delete(id: ID) {
    await this.database.characterOverrides.delete(id);
  }
  async deleteByCharacter(characterId: ID) {
    await this.database.characterOverrides.where("characterId").equals(characterId).delete();
  }
}

export class DexieCharacterDerivedSnapshotRepository implements CharacterDerivedSnapshotRepository {
  constructor(private readonly database: LedgerDB) {}
  get(characterId: ID) {
    return this.database.characterDerivedSnapshots.get(characterId);
  }
  async put(snapshot: CharacterDerivedSnapshotRecord) {
    await this.database.characterDerivedSnapshots.put(snapshot);
  }
}

export class DexieContentQueryPort implements ContentQueryPort {
  constructor(private readonly database: LedgerDB) {}
  listEntries() {
    return this.database.contentEntries.toArray();
  }
  getRuleset(id: ID) {
    return this.database.rulesetProfiles.get(id);
  }
  listRulesets() {
    return this.database.rulesetProfiles.toArray();
  }
  listPacks() {
    return this.database.contentPacks.toArray();
  }
}

const ACTIVE_RULESET_KEY = "activeRulesetId" as const;

export class DexieRulesetWritePort implements RulesetWritePort {
  constructor(private readonly database: LedgerDB) {}
  async put(profile: RulesetProfile) {
    await this.database.rulesetProfiles.put(profile);
  }
  async getActiveRulesetId() {
    const stored = await this.database.appPreferences.get(ACTIVE_RULESET_KEY);
    return stored?.value;
  }
  async setActiveRulesetId(id: ID, now: ISODate) {
    const existing = await this.database.appPreferences.get(ACTIVE_RULESET_KEY);
    await this.database.appPreferences.put({
      key: ACTIVE_RULESET_KEY,
      value: id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }
  async clearActiveRulesetId() {
    await this.database.appPreferences.delete(ACTIVE_RULESET_KEY);
  }
}

/** Every repository a character service may need, wired to one database instance. */
export interface CharacterRepositories {
  characters: CharacterRepository;
  versions: CharacterVersionRepository;
  snapshots: CharacterSnapshotRepository;
  runtime: CharacterRuntimeStateRepository;
  actions: CharacterActionLogRepository;
  drafts: CharacterDraftRepository;
  overrides: CharacterOverrideRepository;
  derivedSnapshots: CharacterDerivedSnapshotRepository;
  content: ContentQueryPort;
  rulesets: RulesetWritePort;
}

export function createCharacterRepositories(database: LedgerDB): CharacterRepositories {
  return {
    characters: new DexieCharacterRepository(database),
    versions: new DexieCharacterVersionRepository(database),
    snapshots: new DexieCharacterSnapshotRepository(database),
    runtime: new DexieCharacterRuntimeStateRepository(database),
    actions: new DexieCharacterActionLogRepository(database),
    drafts: new DexieCharacterDraftRepository(database),
    overrides: new DexieCharacterOverrideRepository(database),
    derivedSnapshots: new DexieCharacterDerivedSnapshotRepository(database),
    content: new DexieContentQueryPort(database),
    rulesets: new DexieRulesetWritePort(database),
  };
}
