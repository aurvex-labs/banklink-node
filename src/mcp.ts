import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BanklinkV2, CeremonyError, type CreateOptions } from './v2';

export function createMcpServer(client:BanklinkV2, options:{ enableLink?:boolean; privateInput?:()=>Promise<CreateOptions> }={}) {
  const server=new McpServer({name:'banklink-local',version:'2.0.0'});
  const run=async(fn:()=>Promise<unknown>)=>{try{return {content:[{type:'text' as const,text:JSON.stringify(await fn())}]};}catch(e){return {isError:true,content:[{type:'text' as const,text:e instanceof CeremonyError?e.code:'operation_failed'}]};}};
  server.registerTool('list_banks',{description:'List available banks',inputSchema:{}},()=>run(()=>client.banks.list()));
  server.registerTool('list_profiles',{description:'List profile metadata',inputSchema:{}},()=>run(()=>client.profiles.list()));
  server.registerTool('sync_profile',{description:'Decrypt results locally; returns financial data to this MCP client',inputSchema:{profileId:z.string().uuid(),accounts:z.array(z.string()).optional(),fromDate:z.string().optional(),toDate:z.string().optional()}},(input,extra)=>run(()=>client.profiles.sync(input.profileId,{...input,signal:extra.signal})));
  if(options.enableLink&&options.privateInput) server.registerTool('link_profile',{description:'Link using credentials collected through a private local input callback',inputSchema:{}},()=>run(async()=>{const input=await options.privateInput!();const p=await client.profiles.create(input);return {id:p.id,bankId:p.bankId};}));
  return server;
}
export async function serveStdio(client:BanklinkV2){const server=createMcpServer(client);await server.connect(new StdioServerTransport());return server;}
