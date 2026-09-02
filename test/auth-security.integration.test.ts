import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { startHttpServer } from "../src/http-server.js";
import { createServices } from "../src/mcp-server.js";

const roots:string[]=[];
afterAll(async()=>{await Promise.all(roots.map(r=>rm(r,{recursive:true,force:true})));});

describe("HTTP security boundaries",()=>{
  it("requires bearer auth before MCP parsing",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"jeopsok-auth-"));roots.push(root);
    const config=loadConfig({MCP_AUTH_TOKEN:"secret",MCP_HOST:"127.0.0.1",MCP_DEFAULT_CWD:root},root);config.port=0;
    const running=await startHttpServer(config,createServices(config));
    try{
      const addr=running.httpServer.address() as AddressInfo;const url=`http://127.0.0.1:${addr.port}/mcp`;
      const noAuth=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:"{"});
      expect(noAuth.status).toBe(401);
      const goodAuth=await fetch(url,{method:"POST",headers:{authorization:"Bearer secret","content-type":"application/json"},body:"{"});
      expect(goodAuth.status).toBe(400);
    }finally{await running.close();}
  });

  it("rejects an unapproved Host header when allowlisted",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"jeopsok-host-"));roots.push(root);
    const config=loadConfig({MCP_AUTH_TOKEN:"secret",MCP_HOST:"127.0.0.1",MCP_ALLOWED_HOSTS:"localhost",MCP_DEFAULT_CWD:root},root);config.port=0;
    const running=await startHttpServer(config,createServices(config));
    try{
      const addr=running.httpServer.address() as AddressInfo;
      const res=await fetch(`http://127.0.0.1:${addr.port}/health`,{headers:{host:"attacker.example"}});
      expect(res.status).toBe(403);
    }finally{await running.close();}
  });
});
