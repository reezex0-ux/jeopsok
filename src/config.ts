import path from "node:path";

export interface AppConfig {
  host: string; port: number; endpoint: string; publicUrl: string | undefined;
  allowedHosts: string[] | undefined; trustProxyHops: number;
  authToken: string | undefined; allowNoAuth: boolean;
  defaultCwd: string; defaultShell: string; maxRequestBody: string; maxOutputBytes: number;
  maxRetainedProcessOutputBytes: number; processRetentionMs: number; maxProcesses: number;
  maxFileChunkBytes: number; maxEditFileBytes: number;
}
function parseBoolean(value:string|undefined,fallback:boolean):boolean{if(value===undefined||value==="")return fallback;if(["1","true","yes","on"].includes(value.toLowerCase()))return true;if(["0","false","no","off"].includes(value.toLowerCase()))return false;throw new Error(`Invalid boolean value: ${value}`);}
function parseInteger(value:string|undefined,fallback:number,name:string,minimum:number,maximum=Number.MAX_SAFE_INTEGER):number{if(value===undefined||value==="")return fallback;const n=/^[+-]?\d+$/.test(value.trim())?Number(value):Number.NaN;if(!Number.isSafeInteger(n)||n<minimum||n>maximum)throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);return n;}
export function defaultShellForPlatform(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform):string{const configured=env.MCP_DEFAULT_SHELL?.trim();if(configured)return configured;if(platform==="win32")return "powershell.exe";return env.SHELL?.trim()||"/bin/bash";}
function normalizeEndpoint(value:string|undefined):string{const endpoint=value?.trim()||"/mcp";if(!endpoint.startsWith("/"))throw new Error("MCP_ENDPOINT must start with '/'");return endpoint.length>1?endpoint.replace(/\/+$/ ,""):endpoint;}
export function loadConfig(env:NodeJS.ProcessEnv=process.env,processCwd=process.cwd()):AppConfig{
  const allowNoAuth=parseBoolean(env.MCP_ALLOW_NO_AUTH,false);const authToken=env.MCP_AUTH_TOKEN?.trim()||undefined;
  if(!allowNoAuth&&!authToken)throw new Error("MCP_AUTH_TOKEN is required. Set MCP_ALLOW_NO_AUTH=true only behind a trusted local tunnel or authentication gateway.");
  const allowedHosts=env.MCP_ALLOWED_HOSTS?.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  return {host:env.MCP_HOST?.trim()||"0.0.0.0",port:parseInteger(env.MCP_PORT,3000,"MCP_PORT",1,65535),endpoint:normalizeEndpoint(env.MCP_ENDPOINT),publicUrl:env.MCP_PUBLIC_URL?.trim().replace(/\/+$/ ,"")||undefined,allowedHosts:allowedHosts?.length?allowedHosts:undefined,trustProxyHops:parseInteger(env.MCP_TRUST_PROXY_HOPS,0,"MCP_TRUST_PROXY_HOPS",0,16),authToken,allowNoAuth,defaultCwd:path.resolve(env.MCP_DEFAULT_CWD?.trim()||processCwd),defaultShell:defaultShellForPlatform(env),maxRequestBody:env.MCP_MAX_REQUEST_BODY?.trim()||"8mb",maxOutputBytes:parseInteger(env.MCP_MAX_OUTPUT_BYTES,1024*1024,"MCP_MAX_OUTPUT_BYTES",16*1024),maxRetainedProcessOutputBytes:parseInteger(env.MCP_MAX_RETAINED_PROCESS_OUTPUT_BYTES,4*1024*1024,"MCP_MAX_RETAINED_PROCESS_OUTPUT_BYTES",64*1024),processRetentionMs:parseInteger(env.MCP_PROCESS_RETENTION_MS,60*60*1000,"MCP_PROCESS_RETENTION_MS",1000),maxProcesses:parseInteger(env.MCP_MAX_PROCESSES,128,"MCP_MAX_PROCESSES",1),maxFileChunkBytes:parseInteger(env.MCP_MAX_FILE_CHUNK_BYTES,1024*1024,"MCP_MAX_FILE_CHUNK_BYTES",4096),maxEditFileBytes:parseInteger(env.MCP_MAX_EDIT_FILE_BYTES,64*1024*1024,"MCP_MAX_EDIT_FILE_BYTES",4096)};
}
