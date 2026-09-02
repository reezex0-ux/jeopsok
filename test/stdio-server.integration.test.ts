import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
const children: ReturnType<typeof spawn>[] = [];
afterEach(() => { for (const p of children) if (!p.killed) p.kill("SIGTERM"); });

describe("stdio entry", () => {
  it("serves the same 13-tool surface to a legacy client", async () => {
    const child = spawn(process.execPath, ["dist/src/stdio-server.js"], { cwd: process.cwd(), env: { ...process.env, MCP_ALLOW_NO_AUTH: "true", MCP_DEFAULT_CWD: process.cwd() }, stdio: ["pipe","pipe","pipe"] });
    children.push(child);
    let buf=""; let id=0; const pending=new Map<number,(v:any)=>void>();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => { buf += chunk; let i; while ((i=buf.indexOf("\n"))>=0) { const line=buf.slice(0,i).trim(); buf=buf.slice(i+1); if(!line) continue; const msg=JSON.parse(line); if(typeof msg.id==="number"&&pending.has(msg.id)){ pending.get(msg.id)!(msg); pending.delete(msg.id); } } });
    const call=(method:string,params:object={})=>new Promise<any>((resolve,reject)=>{const n=++id; pending.set(n,resolve); child.stdin.write(JSON.stringify({jsonrpc:"2.0",id:n,method,params})+"\n",e=>e&&reject(e));});
    const init=await call("initialize",{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"test",version:"1"}});
    expect(init.result.serverInfo).toMatchObject({name:"jeopsok",version:"0.1.0"});
    child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})+"\n");
    const list=await call("tools/list");
    expect(list.result.tools).toHaveLength(13);
  },15000);
});
