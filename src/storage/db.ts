import Dexie,{type EntityTable,type Transaction}from"dexie";
import type{Character,CharacterSnapshot,CharacterVersion,ContentEntry,ContentEntryVersion,ContentPack,ContentPackVersion,MigrationRecord,OverrideDecision,RulesetProfile,Source,ValidationIssue}from"@/src/domain/model";
import type{CharacterActionRecord,CharacterDerivedSnapshotRecord,CharacterDraftRecord,CharacterOverrideRecord,CharacterRecord,CharacterRuntimeStateRecord,CharacterSnapshotRecord,CharacterVersionRecord}from"@/src/domain/character-record";
import {inferPackCoverage,migrateContentEntryToV2}from"@/src/migrations/content-pack-v2";
import {upgradeCharactersToM21}from"@/src/migrations/character-m2-1";

export class LedgerDB extends Dexie{
  /** M2.1 durable committed characters. Legacy v1 rows are upgraded in version 5. */
  characters!:EntityTable<CharacterRecord,"id">;
  characterVersions!:EntityTable<CharacterVersionRecord,"id">;
  characterSnapshots!:EntityTable<CharacterSnapshotRecord,"id">;
  characterDrafts!:EntityTable<CharacterDraftRecord,"id">;
  characterRuntimeStates!:EntityTable<CharacterRuntimeStateRecord,"characterId">;
  characterActions!:EntityTable<CharacterActionRecord,"id">;
  characterOverrides!:EntityTable<CharacterOverrideRecord,"id">;
  characterDerivedSnapshots!:EntityTable<CharacterDerivedSnapshotRecord,"characterId">;
  sources!:EntityTable<Source,"id">;
  contentPacks!:EntityTable<ContentPack,"id">;
  contentEntries!:EntityTable<ContentEntry,"id">;
  contentPackVersions!:EntityTable<ContentPackVersion,"id">;
  contentEntryVersions!:EntityTable<ContentEntryVersion,"id">;
  rulesetProfiles!:EntityTable<RulesetProfile,"id">;
  validationIssues!:EntityTable<ValidationIssue,"id">;
  overrideDecisions!:EntityTable<OverrideDecision,"id">;
  migrationRecords!:EntityTable<MigrationRecord,"id">;

  constructor(name="adventurer-ledger"){
    super(name);
    this.version(1).stores({characters:"id,name,level,status,kind,rulesetProfileId,updatedAt,*tags",characterVersions:"id,characterId,sequence",characterSnapshots:"id,characterId,characterVersionId",sources:"id,name,edition,priority,visibility,enabledByDefault",contentPacks:"id,name,version,schemaVersion,visibility,exportRestricted",contentEntries:"id,slug,name,category,rulesEdition,sourceId,visibility,legacy,private,exportRestricted,*aliases,*tags",rulesetProfiles:"id,name,*activeSourceIds",validationIssues:"id,characterId,severity,code,resolvedAt",overrideDecisions:"id,validationIssueId,characterId",migrationRecords:"id,area,fromVersion,toVersion,status"});
    this.version(2).stores({contentPackVersions:"id,packId,sequence,updatedAt",contentEntryVersions:"id,entryId,revision,updatedAt"});
    this.version(3).stores({contentEntries:"id,slug,name,category,rulesEdition,sourceId,visibility,reviewStatus,legacy,private,exportRestricted,*aliases,*tags",contentPacks:"id,name,version,schemaVersion,visibility,exportRestricted,*dependencies,*optionalDependencies"}).upgrade(async transaction=>{
      await transaction.table<Record<string,unknown>,string>("contentEntries").toCollection().modify(entry=>{Object.assign(entry,migrateContentEntryToV2(entry));});
      await transaction.table<Record<string,unknown>,string>("contentPacks").toCollection().modify(pack=>{pack.schemaVersion=2;pack.dependencies=Array.isArray(pack.dependencies)?pack.dependencies:[];pack.optionalDependencies=Array.isArray(pack.optionalDependencies)?pack.optionalDependencies:[]});
    });
    this.version(4).stores({contentPacks:"id,name,version,schemaVersion,coverage,visibility,exportRestricted,*dependencies,*optionalDependencies"}).upgrade(async transaction=>{
      await transaction.table<Record<string,unknown>,string>("contentPacks").toCollection().modify(pack=>{pack.coverage=inferPackCoverage(pack)});
    });
    // M2.1: character drafts, revision-bearing durable characters, runtime state,
    // session action log, typed overrides and safe derived snapshots. Content,
    // packs and sources are untouched. Dexie runs the upgrade inside the version
    // change transaction, so a throw rolls the whole step back.
    this.version(5).stores({
      characters:"id,name,level,status,kind,rulesetProfileId,revision,updatedAt,*tags",
      characterVersions:"id,characterId,sequence,operationId,[characterId+sequence]",
      characterSnapshots:"id,characterId,characterVersionId,kind,createdAt",
      characterDrafts:"id,status,rulesetProfileId,editingCharacterId,updatedAt",
      characterRuntimeStates:"characterId,revision,updatedAt",
      characterActions:"id,characterId,sequence,operationId,[characterId+sequence]",
      characterOverrides:"id,characterId,targetPath,status,[characterId+targetPath]",
      characterDerivedSnapshots:"characterId,characterRevision,updatedAt",
    }).upgrade(transaction=>upgradeCharactersToM21(transaction as Transaction));
  }
}

export const db=new LedgerDB();
