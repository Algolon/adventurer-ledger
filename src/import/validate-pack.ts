import{contentPackSchema,type ContentPackDocument}from"@/src/domain/content-pack";
export interface ValidationResult{success:boolean;data?:ContentPackDocument;errors:Array<{path:string;message:string}>;warnings:string[]}
const forbidden=new Set(["__proto__","prototype","constructor"]);
function inspect(value:unknown,depth=0):void{if(depth>80)throw new Error("Import nesting is too deep");if(!value||typeof value!=="object")return;for(const[key,child]of Object.entries(value)){if(forbidden.has(key))throw new Error("Import contains a forbidden object key");inspect(child,depth+1)}}
export function validateContentPackJson(json:string,maxBytes=25*1024*1024):ValidationResult{
  if(new TextEncoder().encode(json).byteLength>maxBytes)return{success:false,errors:[{path:"",message:"File exceeds the import size limit"}],warnings:[]};
  try{
    const parsed:unknown=JSON.parse(json);inspect(parsed);
    const result=contentPackSchema.safeParse(parsed);
    if(!result.success)return{success:false,errors:result.error.issues.map(issue=>({path:issue.path.join("."),message:issue.message})),warnings:[]};
    return{success:true,data:result.data,errors:[],warnings:[]};
  }catch(error){
    const message=error instanceof SyntaxError?"File is not valid JSON":error instanceof Error?error.message:"Import could not be parsed";
    return{success:false,errors:[{path:"",message}],warnings:[]};
  }
}
