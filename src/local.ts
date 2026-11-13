import { constants } from 'node:fs';
import { mkdir, open, lstat, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CeremonyError, type VersionCache } from './v2';

/**
 * Owner-only, by mode bits and uid. Windows has neither (modes read as 0666 and there's no getuid);
 * files under the user profile are private to the user by default ACLs, so only the type checks apply.
 */
const posix=process.platform!=='win32';
const owned=(s:{mode:number;uid:number})=>!posix||((s.mode&0o077)===0&&s.uid===process.getuid?.());
/** Private, user-owned regular files only. No symlink following or permissive existing directories. */
export async function privateRead(path:string):Promise<string|null> {
  try {
    await privateDir(dirname(path));const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {const s=await file.stat();if(!s.isFile()||!owned(s))throw new Error();return await file.readFile('utf8');}finally{await file.close();}
  }catch(e:any){if(e?.code==='ENOENT')return null;throw new CeremonyError('local_storage_error');}
}
async function privateDir(path:string) {
  await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);
  if(!s.isDirectory()||s.isSymbolicLink()||!owned(s))throw new CeremonyError('local_storage_error');
}
export async function privateWrite(path:string,value:string,exclusive=false):Promise<void> {
  let temp:string|undefined;
  try {
    await privateDir(dirname(path));
    if(exclusive) {const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await f.writeFile(value);await f.sync();}finally{await f.close();}const dir=await open(dirname(path),constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}return;}
    await privateRead(path);temp=path+'.'+randomUUID();
    const f=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);try{await f.writeFile(value);await f.sync();}finally{await f.close();}
    await rename(temp,path);temp=undefined;const dir=await open(dirname(path),constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}
  }catch{throw new CeremonyError('local_storage_error');}finally{if(temp)await unlink(temp).catch(()=>{});}
}
/** One process should own a cache file; share an external serialized VersionCache across processes. */
export class FileVersionCache implements VersionCache {
  private pending:Promise<void>=Promise.resolve();
  constructor(private path:string){}
  async read(){const raw=await privateRead(this.path);if(raw===null)return 0;const n=Number(raw);if(!Number.isSafeInteger(n)||n<1)throw new CeremonyError('local_storage_error');return n;}
  write(version:number){const next=this.pending.then(async()=>{await privateWrite(this.path,String(Math.max(version,await this.read())));});this.pending=next.catch(()=>{});return next;}
}
