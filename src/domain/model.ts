export type ID=string;export type ISODate=string;
export type Edition="2014"|"2024"|"mixed"|"homebrew";
export type Ability="strength"|"dexterity"|"constitution"|"intelligence"|"wisdom"|"charisma";
export type Visibility="public-srd"|"public-free-rules"|"public-original"|"private-user-entered"|"private-full-text"|"private-summary"|"local-reference-only"|"unavailable-reference-only";
export type LicenseType="CC-BY-4.0"|"official-free"|"original"|"private-reference"|"private-owned-source"|"unknown"|"export-restricted"|"do-not-distribute";
export type Category="class"|"class-feature"|"subclass"|"species"|"race"|"lineage"|"background"|"feat"|"spell"|"item"|"weapon"|"armor"|"tool"|"fighting-style"|"weapon-mastery"|"maneuver"|"invocation"|"metamagic"|"infusion"|"pact-boon"|"condition"|"resource"|"rule"|"monster"|"proficiency"|"spell-list";
export type Comparison="eq"|"neq"|"gt"|"gte"|"lt"|"lte";export interface Audit{createdAt:ISODate;updatedAt:ISODate}

export type Condition={all:Condition[]}|{any:Condition[]}|{not:Condition}|{type:"always"}|{type:"wearingArmor";armorType?:"light"|"medium"|"heavy"|"shield"}|{type:"hasFeature";featureId:ID}|{type:"hasTag";tag:string}|{type:"classLevel";classId:ID;operator:Comparison;value:number}|{type:"totalLevel";operator:Comparison;value:number}|{type:"ability";ability:Ability;operator:Comparison;value:number}|{type:"proficientWith";proficiencyId:ID}|{type:"customFlag";key:string;equals:string|number|boolean};
export type Value={kind:"literal";value:number|string|boolean}|{kind:"path";path:string}|{kind:"formula";formula:string;variables:string[]};
export type Operation="add"|"subtract"|"multiply"|"set"|"min"|"max";
interface EffectBase{id:ID;sourceEntryId?:ID;label?:string;priority?:number;condition?:Condition}
export type Effect=EffectBase&(
|{type:"grantProficiency"|"grantExpertise";proficiencyId:ID}
|{type:"grantFeature"|"replaceFeature"|"disableFeature";featureId:ID;replacementId?:ID}
|{type:"grantChoice";choiceId:ID}
|{type:"modifyAbility"|"modifyAbilityMaximum";ability:Ability;operation:Operation;value:Value}
|{type:"modifySkill"|"modifySavingThrow";target:string;operation:Operation;value:Value}
|{type:"modifyArmorClass"|"modifyInitiative"|"modifySpeed"|"modifyCriticalRange";operation:Operation;value:Value}
|{type:"modifyAttack"|"modifyDamage";selector:Record<string,string>;operation:Operation;value:Value}
|{type:"addSpell";spellId:ID;alwaysPrepared?:boolean}|{type:"addSpellList";spellListId:ID}
|{type:"addResource";resource:ResourceDefinition}
|{type:"addAttack"|"addAction"|"addBonusAction"|"addReaction";definitionId:ID}
|{type:"setMinimum"|"setMaximum"|"setCalculation";target:string;value:Value}
|{type:"addAdvantage"|"addDisadvantage";target:string}
|{type:"rechargeOnShortRest"|"rechargeOnLongRest";resourceId:ID}
|{type:"unlockAtLevel";level:number;effect:Effect}|{type:"scaleAtLevel";levels:Record<string,Value>;target:string}
|{type:"addWeaponMastery"|"grantFightingStyle"|"grantManeuver"|"grantInvocation"|"grantMetamagic";optionId:ID});
export interface PrerequisiteDefinition{id:ID;label:string;condition:Condition;enforcement:"hard"|"soft"|"informational"}
export interface ChoiceOption{id:ID;label:string;entryId?:ID;effects?:Effect[]}
export interface ChoiceDefinition{id:ID;label:string;min:number;max:number;repeatable:boolean;maxRepeats?:number;options:ChoiceOption[];childChoices?:ChoiceDefinition[]}
export interface ResourceDefinition{id:ID;name:string;maximum:Value;recharge:"short-rest"|"long-rest"|"dawn"|"manual"|"none";sharedPoolId?:ID}
export interface ProficiencyDefinition{id:ID;type:"skill"|"save"|"armor"|"weapon"|"tool"|"language";key:string;label:string}

export interface Source extends Audit{id:ID;name:string;abbreviation:string;edition:Edition;publicationDate?:string;type:"core"|"supplement"|"adventure"|"free-rules"|"srd"|"homebrew"|"campaign";licenseType:LicenseType;visibility:"public"|"private"|"reference-only";priority:number;enabledByDefault:boolean;campaignIds:ID[];errata?:string;version:string;replacementOf?:ID;replacedBy?:ID;notes?:string;localFileReference?:string;pageFormat?:string}
export type ReviewStatus="extracted"|"text-reviewed"|"mechanics-reviewed"|"engine-verified";
export type PackCoverage="pilot"|"partial"|"complete";
export interface SourceLocator{sourceId:ID;page:string;section?:string;printPage?:string;localFileKey?:string}
export interface ContentLink{type:"feature"|"subclass"|"feat"|"proficiency"|"equipment"|"spell"|"spell-list"|"choice"|"effect"|"attack"|"resource"|"mastery"|"summon"|"wild-shape"|"familiar"|"companion"|"edition-equivalent"|"replacement";targetId:ID;required:boolean;level?:number}
export interface ConflictMetadata{sourcePriority:number;conflictKey?:string;resolution:"source-priority"|"newest-revision"|"explicit-selection"|"coexist"}
export interface ContentPack extends Audit{id:ID;name:string;description?:string;version:string;schemaVersion:number;coverage:PackCoverage;rulesEditions:Edition[];visibility:"public"|"private";licenseType:LicenseType;exportRestricted:boolean;includeFullText:boolean;dependencies:ID[];optionalDependencies:ID[];sourceIds:ID[];entryIds:ID[];checksum?:string}
export interface ContentEntry extends Audit{id:ID;slug:string;name:string;aliases:string[];category:Category;subcategory?:string;rulesEdition:Edition;sourceId:ID;sourceBook?:string;sourcePage?:string;sourceSection?:string;sourceLocator:SourceLocator;reviewStatus:ReviewStatus;licenseType:LicenseType;visibility:Visibility;fullText?:string;summary?:string;playerNotes?:string;dmNotes?:string;prerequisites:PrerequisiteDefinition[];choices:ChoiceDefinition[];effects:Effect[];links:ContentLink[];mechanics:Record<string,unknown>;conflict:ConflictMetadata;tags:string[];version:string;revision:number;errataVersion?:string;replacementOf?:ID;replacedBy?:ID;editionRelations:ID[];legacy:boolean;optional:boolean;private:boolean;exportRestricted:boolean}
export interface ContentPackVersion extends Audit{id:ID;packId:ID;sequence:number;reason:"edit"|"import"|"delete";snapshot:ContentPack}
export interface ContentEntryVersion extends Audit{id:ID;entryId:ID;revision:number;reason:"edit"|"import"|"delete";snapshot:ContentEntry}

export interface RulesetProfile extends Audit{id:ID;name:string;activeSourceIds:ID[];editionPriority:Edition[];allowedCategories:Category[];allowedEntryIds?:ID[];disallowedEntryIds?:ID[];allowLegacy:boolean;allowDuplicateVersions:boolean;conflictResolution:"newest"|"source-priority"|"ask"|"allow-both"|"custom-override";allowCustomOverrides:boolean;requirementEnforcement:"hard"|"soft"}
export interface Campaign extends Audit{id:ID;name:string;rulesetProfileId:ID;description?:string;status:"active"|"paused"|"completed"|"archived";tags:string[]}
export interface CharacterSelection extends Audit{id:ID;characterId:ID;choiceId?:ID;entryId?:ID;sourceId?:ID;levelGranted?:number;mode:"guided"|"free-entry"|"override"|"manual";value?:unknown}
export interface Character extends Audit{id:ID;name:string;nickname?:string;imageRef?:string;tokenRef?:string;level:number;xp?:number;advancement:"xp"|"milestone";classLevels:Array<{classId:ID;subclassId?:ID;level:number}>;speciesId?:ID;lineageId?:ID;legacyRaceId?:ID;backgroundId?:ID;alignment?:string;deity?:string;faction?:string;campaignId?:ID;rulesetProfileId:ID;abilities:Record<Ability,number>;baseHitPoints:number;currentHitPoints:number;temporaryHitPoints:number;exhaustion:number;deathSaves:{successes:number;failures:number};selections:CharacterSelection[];biography:Record<string,string>;tags:string[];status:"active"|"archived"|"deceased";kind:"player-character"|"npc"|"premade"|"template";lastPlayedAt?:ISODate}
export interface CharacterVersion extends Audit{id:ID;characterId:ID;sequence:number;reason:"manual"|"level-up"|"import"|"restore"|"migration";snapshot:Character;parentVersionId?:ID}
export interface CharacterSnapshot extends Audit{id:ID;characterId:ID;label:string;characterVersionId:ID;runtimeState:Record<string,unknown>}
export interface CharacterResourceState extends Audit{id:ID;characterId:ID;resourceId:ID;current:number;maximumOverride?:number}
export interface CharacterInventoryItem extends Audit{id:ID;characterId:ID;itemId?:ID;customName?:string;quantity:number;equipped:boolean;attuned:boolean;notes?:string}
export interface CharacterSpell extends Audit{id:ID;characterId:ID;spellId:ID;source:"known"|"prepared"|"always-prepared"|"item";prepared:boolean}
export interface CharacterAttack extends Audit{id:ID;characterId:ID;name:string;attackAbility?:Ability;proficient:boolean;damage:string;notes?:string}
export interface CharacterCondition extends Audit{id:ID;characterId:ID;conditionId?:ID;name:string;active:boolean;notes?:string}
export type ValidationSeverity="error"|"rules-warning"|"compatibility-warning"|"source-warning"|"duplicate-warning"|"private-content-warning"|"house-rule-override"|"informational-note";
export interface ValidationIssue extends Audit{id:ID;characterId?:ID;importJobId?:ID;severity:ValidationSeverity;code:string;message:string;affectedRule?:string;sourceId?:ID;overridable:boolean;resolvedAt?:ISODate}
export interface OverrideDecision extends Audit{id:ID;validationIssueId:ID;characterId?:ID;reason:string;userNote?:string;affectedRule?:string;sourceId?:ID}
export interface ImportJob extends Audit{id:ID;fileName:string;schemaVersion?:number;status:"validating"|"ready"|"imported"|"failed";issues:string[];importedIds:ID[]}
export interface ExportJob extends Audit{id:ID;format:"json"|"encrypted-json"|"pdf";scope:"character"|"content-pack"|"backup";status:"pending"|"completed"|"cancelled"|"failed";includedPrivateContent:boolean;confirmedRestrictedExport:boolean}
export interface MigrationRecord extends Audit{id:ID;area:"database"|"content-pack"|"character";fromVersion:number;toVersion:number;status:"completed"|"failed";notes?:string}

export type ClassDefinition=ContentEntry&{category:"class";hitDie:number;progression:Record<string,unknown>};
export type ClassFeature=ContentEntry&{category:"class-feature";classId:ID;level:number};
export type SubclassDefinition=ContentEntry&{category:"subclass";classId:ID;featureLevels:number[]};
export type SpeciesDefinition=ContentEntry&{category:"species"|"race"|"lineage";speed?:number};
export type BackgroundDefinition=ContentEntry&{category:"background"};
export type FeatDefinition=ContentEntry&{category:"feat";featType:"origin"|"general"|"epic-boon"|"fighting-style"|"other"};
export type SpellDefinition=ContentEntry&{category:"spell";level:number;school?:string;castingTime?:string;range?:string;duration?:string};
export type ItemDefinition=ContentEntry&{category:"item"|"weapon"|"armor"|"tool";weight?:number;cost?:string};
export type WeaponDefinition=ItemDefinition&{category:"weapon";damage?:string;mastery?:string};
export type ArmorDefinition=ItemDefinition&{category:"armor";baseArmorClass?:number};export type ToolDefinition=ItemDefinition&{category:"tool"};
