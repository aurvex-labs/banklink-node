import { randomUUID } from 'node:crypto';
import * as c from '@banklink/crypto';

export class CeremonyError extends Error {
  constructor(public readonly code: string, public readonly status = 0) { super(code); this.name = new.target.name; }
}
export class KeyRequiredError extends CeremonyError { constructor(){ super('key_required'); } }
export class KeyMismatchError extends CeremonyError { constructor(){ super('kid_mismatch'); } }
export class TicketInvalidError extends CeremonyError { constructor(){ super('ticket_invalid'); } }
export class OtpRequiredError extends CeremonyError { constructor(){ super('otp_required'); } }
export class BankLoginFailedError extends CeremonyError { constructor(){ super('bank_login_failed'); } }
/** The bank asked for approval in its app (e.g. Standard Bank) and the customer didn't give it in time. */
export class ApprovalNotGivenError extends CeremonyError { constructor(){ super('approval_not_given'); } }
export class JobExpiredError extends CeremonyError { constructor(){ super('job_expired'); } }
const safeCodes = new Set(['unauthorized','forbidden','key_exists','profile_exists','profile_not_found','job_not_found','job_exists','approval_invalid','worker_busy','payload_too_large','rotation_incomplete','rotation_conflict','invalid_request','not_found','bank_unavailable','otp_invalid','decrypt_failed','release_invalid','worker_session_lost','rate_limited','ip_not_allowed','test_key_not_supported']);
function error(code: unknown, status=0): CeremonyError {
  if(code==='key_required') return new KeyRequiredError();
  if(code==='kid_mismatch') return new KeyMismatchError();
  if(code==='job_expired'||code==='ticket_expired') return new JobExpiredError();
  if(code==='bank_login_failed') return new BankLoginFailedError();
  if(code==='approval_not_given') return new ApprovalNotGivenError();
  return new CeremonyError(typeof code==='string'&&safeCodes.has(code)?code:'api_error',status);
}
export interface VersionCache { read(): Promise<number>; write(version: number): Promise<void> }
export interface V2Options {
  apiKey: string; key?: string; keyProvider?: () => string | Promise<string>; baseUrl?: string;
  timeoutMs?: number; pollIntervalMs?: number; requestTimeoutMs?: number; fetch?: typeof fetch;
  hostVersionCache?: VersionCache;
  /** Explicit simulator-only trust; never enabled by environment variables. */
  test?: { allowTestRoot: true };
}
export interface ProfileMetadata { kid:string; id:string; bankId:string; nickname:string|null; credentialVersion:number; createdAt:string }
export interface Bank { bankId:string; needsOtpEveryLogin:boolean; fields:{name:string;label:string;secret:boolean}[] }
/**
 * Where a bank job is, for a progress display. Sent when the stage changes (and again when an
 * approval deadline moves). `awaiting_approval` means: approve the sign-in in the bank's app before
 * `expiresAt`; `resent` means the bank sent a new notification. Stages may be skipped.
 */
export type JobStatus =
  | { stage: 'preparing' }
  | { stage: 'signing_in' }
  | { stage: 'awaiting_approval'; expiresAt: string; resent?: boolean }
  | { stage: 'awaiting_otp' }
  | { stage: 'fetching' }
  | { stage: 'decrypting' };
export interface JobOptions extends c.ReleaseRequestParams {
  onOtp?: () => Promise<string>; signal?: AbortSignal; timeoutMs?: number;
  /** Progress events. Errors thrown here are ignored. */
  onStatus?: (status: JobStatus) => void;
}
export interface CreateOptions extends JobOptions { bank:string; fields:Record<string,string>; nickname?:string }
type KeyInfo = c.CustomerPublicKey & {orgId:string;createdAt:string};
const segment=(id:string)=>encodeURIComponent(id);
/** The API's coarse login stage, reduced to known values; anything else reads as signing in. */
function progress(p:any):JobStatus {
  if(p?.stage==='fetching')return {stage:'fetching'};
  if(p?.stage==='awaiting_approval'&&typeof p.approvalExpiresAt==='string'&&Number.isFinite(Date.parse(p.approvalExpiresAt)))
    return {stage:'awaiting_approval',expiresAt:new Date(Date.parse(p.approvalExpiresAt)).toISOString(),...(p.resent===true?{resent:true}:{})};
  return {stage:'signing_in'};
}

/** Customer-held-key v2 client. The default package export remains the deprecated v1 client. */
export class BanklinkV2 {
  private seed?: string;
  private highest=0;
  private readonly base: string;
  constructor(private readonly options: V2Options) {
    if(options.key&&options.keyProvider) throw new CeremonyError('invalid_options');
    this.seed=options.key;
    this.base=(options.baseUrl??'https://api.banklink.co.za/v2').replace(/\/$/,'');
    const url=new URL(this.base);
    if(url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new CeremonyError('invalid_options');
    for(const n of [options.timeoutMs,options.requestTimeoutMs,options.pollIntervalMs]) if(n!==undefined&&(!Number.isFinite(n)||n<=0)) throw new CeremonyError('invalid_options');
  }
  private async local(seed?:string):Promise<c.CustomerKeys> {
    try { const value=seed??this.seed??await this.options.keyProvider?.(); if(!value) throw new KeyRequiredError(); return c.deriveCustomerKeys(c.decodeSeed(value)); }
    catch(e) { if(e instanceof KeyRequiredError) throw e; throw new KeyMismatchError(); }
  }
  /** 429 means the request was refused before it was handled, so it is safe to resend (even a POST). */
  private async http(path:string, method='GET', body?:unknown, signal?:AbortSignal):Promise<any> {
    for(let attempt=0;;attempt++) {
      try { return await this.request(path,method,body,signal); }
      catch(e) {
        if(!(e instanceof CeremonyError)||e.code!=='rate_limited'||attempt>=4) throw e;
        // A long Retry-After (e.g. the per-profile bank-login limit) won't clear in time: fail now, with retryAfterMs set.
        const after=(e as CeremonyError&{retryAfterMs?:number}).retryAfterMs;
        if(after!==undefined&&after>15000) throw e;
        const wait=Math.max(after??1000,250);
        await new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,wait);function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);signal?.aborted?reject(new CeremonyError('cancelled')):resolve();}signal?.addEventListener('abort',done,{once:true});});
      }
    }
  }
  private async request(path:string, method:string, body?:unknown, signal?:AbortSignal):Promise<any> {
    const timeout=AbortSignal.timeout(this.options.requestTimeoutMs??10000);
    try {
      const response=await (this.options.fetch??fetch)(this.base+path,{method,redirect:'error',headers:{Authorization:`Bearer ${this.options.apiKey}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,timeout]):timeout});
      // Read under the same deadline, with a hard response bound.
      const reader=response.body?.getReader(); let size=0; const chunks:Uint8Array[]=[];
      if(reader) { for(;;) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>3*1024*1024){await reader.cancel();throw new CeremonyError('response_too_large');} chunks.push(value); } }
      if(response.status===429) {
        const after=Number(response.headers.get('retry-after')??response.headers.get('ratelimit-reset'));
        const e=new CeremonyError('rate_limited',429) as CeremonyError&{retryAfterMs?:number};
        if(Number.isFinite(after)&&after>=0)e.retryAfterMs=after*1000;throw e;
      }
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!response.ok) { if(data?.error?.code==='key_required'&&typeof data.orgId==='string') { const e=new KeyRequiredError() as KeyRequiredError & {orgId:string}; e.orgId=data.orgId;throw e; } throw error(data?.error?.code,response.status); }
      return data;
    } catch(e) { if(e instanceof CeremonyError)throw e; throw new CeremonyError(signal?.aborted?'cancelled':timeout.aborted?'timeout':'transport_error'); }
  }
  private async org():Promise<string> { try{return (await this.http('/keys/current')).orgId;}catch(e){if(e instanceof KeyRequiredError && 'orgId' in e)return String(e.orgId);throw e;} }
  private async hosts(signal:AbortSignal) {
    try { this.highest=Math.max(this.highest,await this.options.hostVersionCache?.read()??0);
      const hosts=c.verifyHostList(await this.http('/worker-hosts','GET',undefined,signal),{minVersion:this.highest,allowTestRoot:this.options.test?.allowTestRoot===true});
      this.highest=hosts.version; await this.options.hostVersionCache?.write(this.highest); return hosts;
    }catch{throw new TicketInvalidError();}
  }
  readonly keys={
    /** Back up the returned seed durably. Interactive callers should pass a seed already backed up. */
    init: async (seed=c.encodeSeed(c.generateSeed())) => { const k=await this.local(seed);const org=await this.org();await this.http('/keys','POST',c.signKeyRegistration(k,org));this.seed=seed;return seed; },
    current: async ():Promise<KeyInfo> => { const info=await this.http('/keys/current');if(info.kid!==(await this.local()).kid)throw new KeyMismatchError();return info; },
    pending: async ():Promise<KeyInfo|null> => {try{return await this.http('/keys/pending');}catch(e){if(e instanceof KeyRequiredError)return null;throw e;}},
    /**
     * Rotates the customer key by re-wrapping each profile's data key locally (contract 00 §17):
     * no worker job, no bank login, C and credential versions unchanged. Retry with the SAME
     * backed-up target seed after an interruption; the old seed stays required until completion.
     * The data key itself only changes on the next successful job. If the old seed may have leaked,
     * pass `rollDataKeys: true` to run a verify job per profile straight away (bank logins; OTP banks
     * need `onOtp`).
     */
    rotate: async (newSeed:string, opts:JobOptions&{rollDataKeys?:boolean}={}) => {
      const old=await this.local(),next=await this.local(newSeed),current=await this.http('/keys/current');
      let result=current;
      if(current.kid!==next.kid) {
        if(current.kid!==old.kid)throw new KeyMismatchError();
        const pending=await this.keys.pending();if(pending&&pending.kid!==next.kid)throw new KeyMismatchError();
        if(!pending)await this.http('/keys/rotate','POST',c.signKeyRegistration(next,current.orgId),opts.signal);
        for(const p of await this.profiles.list()) {
          // Skip profiles already on the target after a partial rotation.
          if(p.kid===next.kid)continue;
          if(p.kid!==old.kid)throw new KeyMismatchError();
          const env=await this.http(`/profiles/${segment(p.id)}/envelope`,'GET',undefined,opts.signal);
          if(env.profileId!==p.id||env.kid!==old.kid||env.bankId!==p.bankId||!Number.isSafeInteger(env.credentialVersion))throw new TicketInvalidError();
          let out;
          try{out=await c.customerRewrap({orgId:current.orgId,profileId:p.id,bankId:env.bankId,credentialVersion:env.credentialVersion,W:env.W},old,next);}
          catch{throw new CeremonyError('decrypt_failed');}
          await this.http(`/profiles/${segment(p.id)}/rewrap`,'POST',{credentialVersion:env.credentialVersion,fromKid:old.kid,toKid:next.kid,W:out.W,approval:out.approval,approvalSig:out.approvalSig},opts.signal);
        }
        result=await this.http('/keys/rotate/complete','POST',{},opts.signal);
      }
      this.seed=newSeed;
      if(opts.rollDataKeys) for(const p of await this.profiles.list()) await this.profiles.verify(p.id,opts);
      return result;
    },
  };
  readonly banks={list:():Promise<Bank[]>=>this.http('/banks')};
  readonly profiles={
    list:():Promise<ProfileMetadata[]>=>this.http('/profiles'),
    delete:async(id:string)=>{await this.http(`/profiles/${segment(id)}`,'DELETE');},
    create:async(input:CreateOptions):Promise<{id:string;bankId:string;data:unknown}>=>{
      const info=await this.keys.current(),keys=await this.local(),id=randomUUID();
      const envelope=await c.createEnvelope({v:1,fields:input.fields},{orgId:info.orgId,profileId:id,bankId:input.bank,credentialVersion:1},keys);
      let data;
      try{
        const req=await this.http('/profiles','POST',{profileId:id,bankId:input.bank,...(input.nickname?{nickname:input.nickname}:{}),envelope},input.signal);
        data=await this.execute(req,keys,info.orgId,{profileId:id,bankId:input.bank,operation:'link',version:1},input);
      }catch(e){
        // The first link never succeeded: drop the profile so a wrong password isn't kept. Best effort.
        try{await this.http(`/profiles/${segment(id)}`,'DELETE');}catch{}
        throw e;
      }
      return {id,bankId:input.bank,data};
    },
    verify:(id:string,opts:JobOptions={})=>this.saved(id,'link',opts),
    sync:(id:string,opts:JobOptions={})=>this.saved(id,'sync',opts),
    /**
     * One-off fetch. Stores nothing and needs no customer key: a throwaway key is made in memory
     * for this job, the result is sealed to it, and it's wiped when the job ends.
     */
    syncOnce:async(input:CreateOptions)=>{
      const orgId=await this.org(),seed=c.generateSeed(),keys=c.deriveCustomerKeys(seed);seed.fill(0);
      try{
        const req=await this.http('/sync-once','POST',{bankId:input.bank,ephemeralKey:true},input.signal);
        return await this.execute(req,keys,orgId,{profileId:null,bankId:input.bank,operation:'sync',version:null},input,input.fields,undefined,true);
      }finally{keys.encPriv.fill(0);keys.sigPriv.fill(0);}
    },
  };
  private async saved(id:string,operation:'link'|'sync',opts:JobOptions) {
    const info=await this.keys.current(),keys=await this.local(),p:ProfileMetadata=await this.http(`/profiles/${segment(id)}`);
    if(p.id!==id)throw new TicketInvalidError();
    const req=await this.http(`/profiles/${segment(id)}/${operation==='link'?'verify':'sync'}`,'POST',{},opts.signal);
    return this.execute(req,keys,info.orgId,{profileId:id,bankId:p.bankId,operation,version:p.credentialVersion},opts);
  }
  private async execute(req:c.ReleaseRequest,keys:c.CustomerKeys,orgId:string,expect:{profileId:string|null;bankId:string;operation:c.Operation;version:number|null},opts:JobOptions,fields?:Record<string,string>,rekeyTo?:c.CustomerPublicKey,oneOffKey=false):Promise<unknown> {
    let last='';
    const status=(s:JobStatus)=>{const k=JSON.stringify(s);if(k===last)return;last=k;try{opts.onStatus?.(s);}catch{/* a display bug never breaks a job */}};
    const deadline=AbortSignal.timeout(opts.timeoutMs??this.options.timeoutMs??240000),signal=opts.signal?AbortSignal.any([opts.signal,deadline]):deadline;
    const check=()=>{if(signal.aborted)throw new CeremonyError(opts.signal?.aborted?'cancelled':'timeout');};
    const bounded=async<T>(fn:()=>Promise<T>):Promise<T>=>{
      check();let abort!:()=>void;
      const aborted=new Promise<never>((_,reject)=>{
        abort=()=>reject(new CeremonyError(opts.signal?.aborted?'cancelled':'timeout'));
        signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted)abort();
      });
      try{return await Promise.race([aborted,Promise.resolve().then(()=>{check();return fn();})]);}
      finally{signal.removeEventListener('abort',abort);}
    };
    try {
      status({stage:'preparing'});check();const hosts=await this.hosts(signal);let built;
      try {
        if(req.profile?.id!==expect.profileId||req.profile?.bankId!==expect.bankId||req.operation!==expect.operation||req.releaseMode!==(fields?'fields':'dek')||req.credential?.credentialVersion!==(expect.version??undefined)||req.expiresAt!==req.ticket.expiresAt)throw new TicketInvalidError();
        built=await c.customerBuildRelease(req,keys,{orgId,expect,fields,rekeyTo,request:expect.operation==='rekey'?undefined:{...(opts.accounts?{accounts:opts.accounts}:{}),...(opts.fromDate?{fromDate:opts.fromDate}:{}),...(opts.toDate?{toDate:opts.toDate}:{})}},{hosts});
      }catch{throw new TicketInvalidError();}
      // A throwaway key isn't registered, so the API checks the approval against the key sent here.
      await this.http(`/jobs/${segment(req.jobId)}/release`,'POST',oneOffKey?{...built.response,customer:c.publicPart(keys)}:built.response,signal);
      status({stage:'signing_in'});
      // Poll fast at first, then back off to 2 s so long jobs stay well inside API rate limits.
      let otpCount=0,poll=this.options.pollIntervalMs??250;const maxPoll=Math.max(poll,2000);
      for(;;) {
        check();if(Date.parse(built.ticket.expiresAt)<=Date.now())throw new JobExpiredError();
        // Collection is destructive: use this exact response, never poll a completed job again.
        const state=await this.http(`/jobs/${segment(req.jobId)}`,'GET',undefined,signal);
        if(state.jobId!==req.jobId)throw new TicketInvalidError();
        if(state.status==='completed') { if(!state.sealedResult)throw new CeremonyError('result_unavailable');status({stage:'decrypting'});try{return await c.customerOpenResult(state.sealedResult,keys,built.ticketHash,req.jobId);}catch{throw new TicketInvalidError();} }
        if(state.status==='running')status(progress(state.progress));
        if(state.status==='awaiting_otp') {
          status({stage:'awaiting_otp'});
          if(!opts.onOtp)throw new OtpRequiredError();if(++otpCount>3)throw new CeremonyError('otp_limit');
          const otp=await bounded(opts.onOtp);check();const sealedRelease=await c.customerBuildOtpRelease(built.ticket,otp);
          await this.http(`/jobs/${segment(req.jobId)}/otp`,'POST',{sealedRelease},signal);
        } else if(state.status==='expired')throw new JobExpiredError();
        else if(state.status==='failed')throw error(state.error?.code);
        else if(state.status==='cancelled')throw new CeremonyError('cancelled');
        else if(state.status!=='running'&&state.status!=='awaiting_release')throw new CeremonyError('invalid_response');
        await bounded(()=>new Promise<void>(resolve=>{const timer=setTimeout(done,poll);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});}));
        poll=Math.min(maxPoll,Math.ceil(poll*1.5));
      }
    } catch(e) {
      if(typeof req?.jobId==='string')try{await this.http(`/jobs/${segment(req.jobId)}`,'DELETE');}catch{}
      if(signal.aborted)throw new CeremonyError(opts.signal?.aborted?'cancelled':'timeout');
      if(e instanceof CeremonyError)throw e;throw new CeremonyError('operation_failed');
    }
  }
}
export default BanklinkV2;
