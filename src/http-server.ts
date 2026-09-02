import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import express, { type Request, type Response } from "express";
import { createBearerAuth, createHostValidation } from "./auth.js";
import type { AppConfig } from "./config.js";
import { errorMessage } from "./errors.js";
import { createMcpServer, type McpServices } from "./mcp-server.js";

export interface RunningHttpServer { httpServer: HttpServer; close: () => Promise<void>; }
function rpcMethod(request:Request):string|undefined{const header=request.header("mcp-method");if(header)return header;const body=request.body;if(!body||typeof body!=="object"||Array.isArray(body))return undefined;const method=(body as {method?:unknown}).method;return typeof method==="string"?method:undefined;}
function rpcToolName(request:Request):string|undefined{const header=request.header("mcp-name");if(header)return header;const body=request.body;if(!body||typeof body!=="object"||Array.isArray(body))return undefined;const params=(body as {params?:unknown}).params;if(!params||typeof params!=="object"||Array.isArray(params))return undefined;const name=(params as {name?:unknown}).name;return typeof name==="string"?name:undefined;}
export async function startHttpServer(config:AppConfig,services:McpServices):Promise<RunningHttpServer>{
  const app=express();app.disable("x-powered-by");if(config.trustProxyHops>0)app.set("trust proxy",config.trustProxyHops);app.use(createHostValidation(config));
  let activeMcpRequests=0;
  const mcpHandler=createMcpHandler(()=>createMcpServer(config,services),{legacy:"stateless",onerror:(error)=>console.error("MCP handler error:",errorMessage(error))});
  const nodeMcpHandler=toNodeHandler(mcpHandler,{onerror:(error)=>console.error("MCP Node adapter error:",errorMessage(error))});
  const authenticate=createBearerAuth(config);const parseMcpJson=express.json({limit:config.maxRequestBody});
  app.get("/health",(_request,response)=>response.json({status:"ok",service:"jeopsok",version:"0.1.0",transportMode:"mcp-2026-stateless",protocolRevision:"2026-07-28",legacyStatelessFallback:true,activeMcpSessions:0,activeMcpRequests,managedProcesses:services.processManager.list().length,unrestrictedHostAccess:true,authentication:config.allowNoAuth&&!config.authToken?"upstream-or-none":"bearer"}));
  app.all(config.endpoint,authenticate,parseMcpJson,async(request,response)=>{const requestId=randomUUID();const startedAt=performance.now();activeMcpRequests+=1;response.set("X-Request-Id",requestId);let logged=false;const finish=(outcome:"completed"|"aborted")=>{if(logged)return;logged=true;activeMcpRequests=Math.max(0,activeMcpRequests-1);console.log(JSON.stringify({event:"mcp_request",requestId,httpMethod:request.method,rpcMethod:rpcMethod(request),toolName:rpcToolName(request),status:response.statusCode,outcome,durationMs:Math.round((performance.now()-startedAt)*10)/10}));};response.once("finish",()=>finish("completed"));response.once("close",()=>{if(!response.writableEnded)finish("aborted");});await nodeMcpHandler(request,response,request.body);});
  app.use((error:unknown,_request:Request,response:Response,_next:express.NextFunction)=>{if(!response.headersSent)response.status(400).json({jsonrpc:"2.0",error:{code:-32000,message:`Invalid request body: ${errorMessage(error)}`},id:null});});
  const cleanupInterval=setInterval(()=>services.processManager.prune(),Math.min(config.processRetentionMs,60_000));cleanupInterval.unref();
  const httpServer=await new Promise<HttpServer>((resolve,reject)=>{const s=app.listen(config.port,config.host,()=>resolve(s));s.once("error",reject);});
  const close=async()=>{clearInterval(cleanupInterval);await mcpHandler.close();await services.processManager.shutdown();await new Promise<void>((resolve,reject)=>httpServer.close(error=>error?reject(error):resolve()));await new Promise<void>(resolve=>setImmediate(resolve));};
  return {httpServer,close};
}
