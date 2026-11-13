#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as c from '@banklink/crypto';
import { BanklinkV2, CeremonyError } from './v2';
import { privateRead, privateWrite, FileVersionCache } from './local';
import { serveStdio } from './mcp';
export interface CliIO { secret(label:string):Promise<string>; output(value:string):void; warn?(value:string):void }
const LOOPBACK=['127.0.0.1','localhost','[::1]'];
/**
 * Dev-only global flags, accepted only BEFORE the command and never from the environment:
 *   --base-url <url>        talk to another API base (e.g. the disposable dev stack)
 *   --insecure-test-root    trust the PUBLIC test worker root; refused unless --base-url is loopback
 */
export function parseGlobalFlags(args:string[]):{rest:string[];baseUrl?:string;testRoot:boolean} {
  let i=0,baseUrl:string|undefined,testRoot=false;
  for(;i<args.length;i++) {
    if(args[i]==='--base-url'){if(baseUrl!==undefined||!args[i+1])throw new CeremonyError('invalid_arguments');baseUrl=args[++i];}
    else if(args[i]==='--insecure-test-root'){if(testRoot)throw new CeremonyError('invalid_arguments');testRoot=true;}
    else break;
  }
  if(baseUrl!==undefined){let u:URL;try{u=new URL(baseUrl);}catch{throw new CeremonyError('invalid_arguments');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new CeremonyError('invalid_arguments');}
  if(testRoot&&(baseUrl===undefined||!LOOPBACK.includes(new URL(baseUrl).hostname)))throw new CeremonyError('insecure_test_root_refused');
  return {rest:args.slice(i),baseUrl,testRoot};
}
/** Raw TTY input with no character echo, including pasted secrets. No piped secret input. */
export async function hiddenPrompt(label:string):Promise<string> {
  if(!process.stdin.isTTY||!process.stderr.isTTY)throw new CeremonyError('private_tty_required');
  const input=process.stdin,wasRaw=input.isRaw;input.setRawMode(true);input.resume();process.stderr.write(label+': ');
  return new Promise((resolve,reject)=>{
    let value='';const interrupted=()=>finish(new CeremonyError('cancelled'));const finish=(err?:Error)=>{input.off('data',data);process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);input.setRawMode(wasRaw);input.pause();process.stderr.write('\n');err?reject(err):resolve(value);};
    const data=(chunk:Buffer)=>{for(const ch of chunk.toString('utf8')){if(ch==='\u0003'||ch==='\u0004'){finish(new CeremonyError('cancelled'));return;}if(ch==='\r'||ch==='\n'){finish();return;}if(ch==='\u007f'||ch==='\b')value=value.slice(0,-1);else if(ch>=' ')value+=ch;}};
    input.on('data',data);process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted);
  });
}
export async function runCli(argv:string[],io:CliIO={secret:hiddenPrompt,output:v=>process.stdout.write(v+'\n')},env:NodeJS.ProcessEnv=process.env) {
  const flags=parseGlobalFlags(argv),args=flags.rest;
  const warn=io.warn??(v=>process.stderr.write(v+'\n'));
  if(flags.testRoot)warn('WARNING: --insecure-test-root trusts the PUBLIC Banklink test worker root. Anyone can sign host lists with it.\nWARNING: dev/test only, loopback API only. Do NOT use real bank credentials unless this is an explicitly authorized isolated test and you verified the worker host key yourself.');
  else if(flags.baseUrl)warn('WARNING: --base-url '+flags.baseUrl+' (non-default API; host lists still require production roots)');
  const [command,sub,...rest]=args;
  // All options are allowlisted: never accept secrets as arguments.
  // A non-default base keeps its own API key and host-list rollback state, so dev stacks never touch production files.
  const scope=flags.baseUrl?'-'+(flags.testRoot?'test-':'')+createHash('sha256').update(flags.baseUrl).digest('hex').slice(0,16):'';
  const dir=join(env.XDG_CONFIG_HOME??join(homedir(),'.config'),'banklink'),config=join(dir,`credentials${scope}.json`);
  if(command==='login') {if(args.length!==1)throw new CeremonyError('invalid_arguments');const apiKey=await io.secret('API key');if(!apiKey)throw new CeremonyError('invalid_input');await privateWrite(config,JSON.stringify({apiKey}));return;}
  const stored=await privateRead(config);let apiKey=env.BANKLINK_API_KEY;try{apiKey??=stored?JSON.parse(stored).apiKey:undefined;}catch{throw new CeremonyError('local_storage_error');}
  if(!apiKey)throw new CeremonyError('api_key_required');
  const client=new BanklinkV2({apiKey,key:env.BANKLINK_KEY,hostVersionCache:new FileVersionCache(join(dir,`host-version${scope}`)),
    ...(flags.baseUrl?{baseUrl:flags.baseUrl}:{}),...(flags.testRoot?{test:{allowTestRoot:true as const}}:{})});
  const print=(v:unknown)=>io.output(JSON.stringify(v,null,2));
  if(command==='mcp'&&args.length===1){await serveStdio(client);return;}
  if(command==='keys'&&(args.length===2||(args.length===3&&sub==='rotate'&&rest[0]==='--roll-data-keys'))) {
    if(sub==='init') {
      const seed=c.encodeSeed(c.generateSeed());
      // No registration before durable backup AND confirmation. Failure leaves the backup intact.
      const backup=join(dir,'seed-'+c.deriveCustomerKeys(c.decodeSeed(seed)).kid+'.backup');
      await privateWrite(backup,seed+'\n',true);io.output('Save this seed in your secret manager: '+seed);io.output('Private backup: '+backup);
      if(await io.secret('Retype the last 6 seed characters after saving your backup')!==seed.slice(-6))throw new CeremonyError('backup_unconfirmed');
      await client.keys.init(seed);io.output('Registered. Set BANKLINK_KEY through your secret manager.');return;
    }
    if(sub==='show'){print(await client.keys.current());return;}
    if(sub==='rotate') {
      if(!env.BANKLINK_KEY)throw new CeremonyError('key_required');
      const path=join(dir,'rotation.backup');let next=await privateRead(path);
      if(!next){next=c.encodeSeed(c.generateSeed());await privateWrite(path,next+'\n',true);}next=next.trim();
      io.output('Back up the target seed from this private file before continuing: '+path);
      if(await io.secret('Retype the last 6 target seed characters after backing it up')!==next.slice(-6))throw new CeremonyError('backup_unconfirmed');
      const roll=rest[0]==='--roll-data-keys';
      await client.keys.rotate(next,{rollDataKeys:roll,onOtp:()=>io.secret('OTP')});
      io.output('Rotation complete. Each profile was re-wrapped locally; no bank login was needed. Load BANKLINK_KEY from the target backup; retain old backup until verified. Archive rotation.backup before a future rotation.');
      if(!roll)io.output('If the old seed may have leaked, set BANKLINK_KEY to the new seed and run `banklink profiles verify --all` to re-encrypt every profile now (one bank login each).');
      return;
    }
  }
  if(command==='banks'&&args.length===1){print(await client.banks.list());return;}
  if(command==='profiles') {
    if(sub==='list'&&rest.length===0){print(await client.profiles.list());return;}
    if(sub==='delete'&&rest.length===1){await client.profiles.delete(rest[0]);return;}
    // A verify job logs in and re-encrypts the stored credentials under a fresh data key.
    if(sub==='verify'&&rest.length===1) {
      const ids=rest[0]==='--all'?(await client.profiles.list()).map(p=>p.id):[rest[0]];
      for(const id of ids){await client.profiles.verify(id,{onOtp:()=>io.secret('OTP')});io.output('verified '+id);}
      return;
    }
    if(sub==='create'&&rest.length===2&&rest[0]==='--bank') {
      const bank=(await client.banks.list()).find(b=>b.bankId===rest[1]);if(!bank)throw new CeremonyError('unknown_bank');
      const fields:Record<string,string>={};for(const f of bank.fields)fields[f.name]=await io.secret(f.label);
      print(await client.profiles.create({bank:bank.bankId,fields,onOtp:()=>io.secret('OTP')}));return;
    }
  }
  if(command==='sync'&&sub) {
    const opts:{fromDate?:string;toDate?:string;onOtp:()=>Promise<string>}={onOtp:()=>io.secret('OTP')};
    for(let i=0;i<rest.length;i++){if(rest[i]==='--json')continue;if(!['--from','--to'].includes(rest[i])||!rest[i+1]||!/^\d{4}-\d{2}-\d{2}$/.test(rest[i+1]))throw new CeremonyError('invalid_arguments');opts[rest[i]==='--from'?'fromDate':'toDate']=rest[++i];}
    print(await client.profiles.sync(sub,opts));return;
  }
  throw new CeremonyError('invalid_arguments');
}
if(process.argv[1]&&require.main === module) runCli(process.argv.slice(2)).catch(e=>{process.stderr.write((e instanceof CeremonyError?e.code:'operation_failed')+'\n');process.exitCode=1;});
