import type{ContentPackDocument}from"@/src/domain/content-pack";

export function syntheticPack(overrides:{coverage?:"pilot"|"partial"|"complete";packRestricted?:boolean;entryRestricted?:boolean;packVersion?:string;revision?:number}={}):ContentPackDocument{
  const version=overrides.packVersion??"1.0.0";
  return{
    schemaVersion:2,
    pack:{id:"pack:synthetic-moon",name:"Synthetic Moon Atlas",description:"Original test-only content",version,coverage:overrides.coverage??"complete",rulesEditions:["homebrew"],visibility:"private",licenseType:"original",exportRestricted:overrides.packRestricted??false,includeFullText:true,dependencies:[],optionalDependencies:[]},
    sources:[{id:"source:synthetic-moon",name:"Synthetic Moon Source",abbreviation:"SMS",edition:"homebrew",type:"homebrew",licenseType:"original",visibility:"private",priority:10,enabledByDefault:true,campaignIds:[],version:"1.0.0"}],
    entries:[{id:"rule:synthetic-moon-path",slug:"synthetic-moon-path",name:"Synthetic Moon Path",aliases:[],category:"rule",rulesEdition:"homebrew",sourceId:"source:synthetic-moon",sourceLocator:{sourceId:"source:synthetic-moon",page:"7",section:"Moon paths"},reviewStatus:"engine-verified",licenseType:"original",visibility:"private-user-entered",fullText:"A wholly original silver path appears when three imaginary moons align.",summary:"Synthetic navigation rule.",prerequisites:[],choices:[],equipmentBundles:[],effects:[{id:"effect:synthetic-marker",type:"addAdvantage",target:"synthetic-navigation"}],links:[],mechanics:{kind:"navigation-rule",data:{}},conflict:{sourcePriority:10,conflictKey:"rule:synthetic-moon-path",resolution:"source-priority"},tags:["synthetic","moon"],version,revision:overrides.revision??1,editionRelations:[],legacy:false,optional:true,private:true,exportRestricted:overrides.entryRestricted??false,createdAt:"2026-08-03T08:00:00.000Z",updatedAt:"2026-08-03T08:00:00.000Z"}]
  };
}
