import type{NextConfig}from"next";
const configuredBasePath=process.env.NEXT_PUBLIC_BASE_PATH??"";
if(configuredBasePath&&(!configuredBasePath.startsWith("/")||configuredBasePath.endsWith("/")))throw new Error("NEXT_PUBLIC_BASE_PATH must start with one slash and have no trailing slash");
const config:NextConfig={reactStrictMode:true,output:"export",trailingSlash:true,basePath:configuredBasePath||undefined};
export default config;
