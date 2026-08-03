import type{MetadataRoute}from"next";
import{APP_ROOT,withBasePath}from"@/src/config/base-path";
export const dynamic="force-static";
export default function manifest():MetadataRoute.Manifest{return{id:APP_ROOT,name:"Adventurer Ledger",short_name:"Ledger",description:"Private local-first adventurer library and character ledger",start_url:APP_ROOT,scope:APP_ROOT,display:"standalone",orientation:"any",background_color:"#f2e7ce",theme_color:"#111a22",categories:["productivity","games"],icons:[{src:withBasePath("/icons/icon-192.png"),sizes:"192x192",type:"image/png",purpose:"any"},{src:withBasePath("/icons/icon-512.png"),sizes:"512x512",type:"image/png",purpose:"any"},{src:withBasePath("/icons/icon-maskable-512.png"),sizes:"512x512",type:"image/png",purpose:"maskable"}]}}
