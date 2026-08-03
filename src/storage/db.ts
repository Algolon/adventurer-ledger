import Dexie,{type EntityTable}from"dexie";
import type{Character,CharacterSnapshot,CharacterVersion,ContentEntry,ContentEntryVersion,ContentPack,ContentPackVersion,MigrationRecord,OverrideDecision,RulesetProfile,Source,ValidationIssue}from"@/src/domain/model";
import {migrateContentEntryToV2}from"@/src/migrations/content-pack-v2";

export class LedgerDB extends Dexie{
  characters!:EntityTable<Character,"id">;
  characterVersions!:EntityTable<CharacterVersion,"id">;
  characterSnapshots!:EntityTable<CharacterSnapshot,"id">;
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
  }
}

export const db=new LedgerDB();
