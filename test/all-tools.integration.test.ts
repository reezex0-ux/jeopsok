import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { startHttpServer, type RunningHttpServer } from "../src/http-server.js";
import { createServices } from "../src/mcp-server.js";

describe("full-profile 13-tool surface", () => {
  let root:string; let running:RunningHttpServer; let client:Client;
  beforeAll(async()=>{
    root=await mkdtemp(path.join(os.tmpdir(),"jeopsok-tools-"));
    const config=loadConfig({MCP_AUTH_TOKEN:"x",MCP_HOST:"127.0.0.1",MCP_DEFAULT_CWD:root,JEOPSOK_PROFILE:"full"},root); config.port=0;
    running=await startHttpServer(config,createServices(config));
    const address=running.httpServer.address() as AddressInfo;
    client=new Client({name:"tools-test",version:"1"},{versionNegotiation:{mode:{pin:"2026-07-28"}}});
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`),{requestInit:{headers:{Authorization:"Bearer x"}}}));
  });
  afterAll(async()=>{await client?.close();await running?.close();await rm(root,{recursive:true,force:true});});
  const ok=async(name:string,args:Record<string,unknown>={})=>{const r=await client.callTool({name,arguments:args});expect(r.isError,JSON.stringify(r.structuredContent)).not.toBe(true);return (r.structuredContent??{}) as Record<string,unknown>;};

  it("exercises command/process and file primitives", async()=>{
    const command=await ok("exec_command",{cmd:"printf core-ok",yieldTimeMs:3000}); expect(command).toMatchObject({stdout:"core-ok",exitCode:0});
    await ok("write_file",{path:"note.txt",content:"alpha\nbeta\n"});
    expect(await ok("stat_path",{path:"note.txt"})).toMatchObject({type:"file"});
    expect(String((await ok("read_file",{path:"note.txt"})).content)).toContain("beta");
    expect(await ok("replace_in_file",{path:"note.txt",oldText:"beta",newText:"gamma"})).toMatchObject({replacements:1});
    expect((await ok("list_directory",{path:"."})).entries).toEqual(expect.arrayContaining([expect.objectContaining({name:"note.txt"})]));
    await ok("upload_file",{path:"bin.dat",dataBase64:Buffer.from([0,1,2,255]).toString("base64"),truncate:true});
    expect(String((await ok("download_file",{path:"bin.dat"})).dataBase64)).toBe(Buffer.from([0,1,2,255]).toString("base64"));

    const interactive=await ok("exec_command",{cmd:"node -e \"process.stdin.once('data',d=>{process.stdout.write(d);process.exit(0)})\"",yieldTimeMs:0});
    const sid=String(interactive.sessionId);
    const written=await ok("write_stdin",{sessionId:sid,chars:"stdin-ok",closeStdin:true,yieldTimeMs:3000}); expect(String(written.stdout)).toContain("stdin-ok");
    expect(await ok("read_process",{sessionId:sid,waitMs:1000})).toMatchObject({running:false,exitCode:0});
    expect((await ok("list_processes")).processes).toEqual(expect.arrayContaining([expect.objectContaining({sessionId:sid})]));

    const sleeper=await ok("exec_command",{cmd:"sleep 30",yieldTimeMs:0});
    expect(await ok("terminate_process",{sessionId:String(sleeper.sessionId),signal:"SIGTERM",graceMs:500})).toMatchObject({running:false});
    await ok("remove_path",{path:"note.txt"});
  });
});
