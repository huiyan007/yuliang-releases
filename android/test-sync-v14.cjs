const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const {boot}=require('./verify-harness.cjs');
const mobile=fs.readFileSync(require('node:path').join(__dirname,'android/www/mobile.js'),'utf8');
const start=mobile.indexOf('async function ledgerHash'),end=mobile.indexOf('const desktopNativeCall',start);
assert(start>=0&&end>start,'mobileSync implementation not found');
function richFixture(){
 const a=boot();
 a.run(`data={schemaVersion:5,base:'2026-11',balance:0,incomes:[{id:'fixed',name:'固定收入',amount:3000,day:15}],budgets:[],monthBudgets:[],incomeReceipts:[],subsidies:[],deposits:[{id:'A',name:'账户 A',amount:5000,balanceStartDate:'2026-11-01'},{id:'B',name:'账户 B',amount:1000,balanceStartDate:'2026-11-01'}],debts:[{id:'D',name:'还款',amount:300,date:'2026-11-10',paid:false}],depositEntries:[],transfers:[]};data=validateLedger(data);localStorage.setItem(KEY,JSON.stringify(data));month.value='2026-11';`);
 assert.equal(a.run('saveDebtPayment(0,"A","2026-11-05")'),true,a.ctx.messages.join('; '));
 assert.equal(a.run('saveAccountTransfer({fromAccountId:"A",toAccountId:"B",amount:200,date:"2026-11-06",purpose:"备用资金"})'),true);
 a.run(`{const next=structuredClone(data);const receipt={id:'R',sourceId:'',name:'额外收入',amount:500,expectedAmount:500,date:'2026-11-05',received:true,allocations:[{id:'S',kind:'saving',name:'存入 A',amount:100,accountId:'A'}]};next.incomeReceipts.push(receipt);rebuildReceiptEntries(next,receipt);if(!commitFinance(next))throw Error('receipt setup failed');}`);
 assert.equal(a.run('saveAccountTransfer({fromAccountId:"A",toAccountId:"B",amount:50,date:"2026-11-07",purpose:"已撤销互转"})'),true);
 assert.equal(a.run('voidAccountTransfer(data.transfers.find(x=>x.purpose==="已撤销互转").id)'),true);
 assert.equal(a.run('balanceFor(data.deposits[0])'),4600);
 assert.equal(a.run('balanceFor(data.deposits[1])'),1200);
 return a;
}
function setup(){
 const a=richFixture();vm.runInContext(mobile.slice(start,end),a.ctx);a.run('ensureFolder=async()=>{}');
 const state={cloud:null,etag:'"etag-1"',baseline:{},calls:[],backups:[],writes:[],failPut:false};
 a.ctx.androidCall=async(route,body)=>{state.calls.push({route,body});if(route==='/baseline')return {...state.baseline};if(route==='/ack'){state.baseline={...body};return {status:'ok'}}if(route==='/backup'){a.ctx.payload=JSON.parse(body.data);a.run('validateLedger(payload)');state.backups.push({...body});return {status:'ok'}}throw Error('Unexpected route '+route)};
 a.ctx.mockDav=async(method,suffix,body,condition)=>{state.calls.push({method,suffix,condition});assert.equal(suffix,'YuliangFinance/state.json');if(method==='GET')return state.cloud?{code:200,body:JSON.stringify(state.cloud),etag:state.etag}:{code:404,body:''};if(method==='PUT'){if(state.failPut)return {code:412,body:''};assert.equal(condition,state.cloud?state.etag:'*','conditional PUT missing');const envelope=JSON.parse(body);assert.equal(envelope.format,5);a.ctx.payload=JSON.parse(envelope.data);a.run('validateLedger(payload)');state.writes.push(envelope);state.cloud=envelope;return {code:201,body:''}}throw Error('Unexpected method '+method)};
 a.run('dav=mockDav');
 const raw=a.run('JSON.stringify(data)');
 const sync=(data=raw,mode='',expected='')=>{a.ctx.syncRequest={data,mode,expected};return a.run('mobileSync(syncRequest)')};
 const hash=s=>require('crypto').createHash('sha256').update(s).digest('hex').toUpperCase();
 return {a,state,raw,sync,hash};
}
(async()=>{
 const t=setup(),{a,state,raw,sync,hash}=t;const source=JSON.parse(raw);const altered={...source,balance:50};const remoteRaw=JSON.stringify(altered);state.cloud={format:5,revision:'desktop-5',updatedUtc:'2026-11-05T00:00:00Z',device:'desktop',data:remoteRaw};
 const before=a.run('JSON.stringify(data)');let result=await sync();assert.equal(result.status,'conflict');assert.equal(state.writes.length,0);assert.equal(a.run('JSON.stringify(data)'),before);
 result=await sync(raw,'cloud','desktop-5');assert.equal(result.data,remoteRaw);assert.equal(result.revision,'desktop-5');assert.equal(state.backups.at(-1).data,raw);assert.equal(state.backups.at(-1).tag,'before-download');assert.equal(state.writes.length,0);
 a.ctx.download=JSON.parse(result.data);a.run('data=validateLedger(download);localStorage.setItem(KEY,JSON.stringify(data));');assert.deepEqual(JSON.parse(a.run('JSON.stringify(data.transfers)')),source.transfers);assert.deepEqual(JSON.parse(a.run('JSON.stringify(data.depositEntries)')),source.depositEntries);assert.deepEqual(JSON.parse(a.run('JSON.stringify(data.debts)')),source.debts);assert.equal(a.run('balanceFor(data.deposits[0])'),4600);assert.equal(a.run('balanceFor(data.deposits[1])'),1200);
 state.baseline={revision:'desktop-5',hash:hash(remoteRaw)};result=await sync(remoteRaw);assert.equal(result.status,'ok');assert.equal(state.writes.length,0,'equal ledger uploaded unexpectedly');
 const phoneRaw=JSON.stringify({...altered,balance:75});result=await sync(phoneRaw);assert.equal(result.status,'ok');assert.equal(state.writes.length,1);assert.equal(state.writes[0].data,phoneRaw);assert.deepEqual(JSON.parse(state.cloud.data).transfers,source.transfers);assert.deepEqual(JSON.parse(state.cloud.data).depositEntries,source.depositEntries);assert.deepEqual(JSON.parse(state.cloud.data).debts,source.debts);assert.equal(state.baseline.hash,hash(phoneRaw));assert(state.backups.some(b=>b.tag==='cloud-before-overwrite'&&b.data===remoteRaw));
 console.log('PASS format 5: first-connect conflict, backup before download, complete linked graph preserved, equal no-op, conditional upload with full graph.');
 for(const format of [1,2,3,4,'5']){const old=setup();const plain={schemaVersion:format==='5'?5:Number(format),base:'2026-11',balance:0,incomes:[],budgets:[],monthBudgets:[],incomeReceipts:[],subsidies:[],deposits:[],debts:[],depositEntries:[]};old.state.cloud={format,revision:'legacy-'+format,data:JSON.stringify(plain)};let r=await old.sync();assert.equal(r.status,'conflict');r=await old.sync(old.raw,'cloud','legacy-'+format);old.a.ctx.legacyData=JSON.parse(r.data);assert.equal(old.a.run('validateLedger(legacyData).schemaVersion'),5);assert.equal(old.state.writes.length,0)}
 console.log('PASS legacy format 1/2/3/4 and string format 5 can download and validate; legacy schema migrates without writing cloud.');
 for(const [name,mutate,pattern]of [
  ['future envelope',x=>x.format=6,/封装字段/],
  ['future ledger',x=>{const d=JSON.parse(x.data);d.schemaVersion=6;x.data=JSON.stringify(d)},/账本版本较新/],
  ['missing transfer side',x=>{const d=JSON.parse(x.data);const t=d.transfers.find(e=>e.purpose==='备用资金');d.depositEntries=d.depositEntries.filter(e=>e.id!=='transfer:'+t.id+':in');x.data=JSON.stringify(d)},/缺少对应流水/],
  ['payment amount mismatch',x=>{const d=JSON.parse(x.data);d.debts[0].amount=301;x.data=JSON.stringify(d)},/扣款不一致/],
  ['orphan transfer',x=>{const d=JSON.parse(x.data);d.transfers=[];x.data=JSON.stringify(d)},/互转流水缺少关联记录/]
 ]){const bad=setup();bad.state.cloud={format:5,revision:'invalid',data:bad.raw};mutate(bad.state.cloud);await assert.rejects(bad.sync(),pattern,name);assert.equal(bad.state.writes.length,0);assert.equal(bad.state.backups.length,0)}
 console.log('PASS invalid graphs and future format/schema rejected before backup or upload.');
 const conflict=setup();conflict.state.baseline={revision:'old',hash:conflict.hash(conflict.raw)};const remote=JSON.stringify({...JSON.parse(conflict.raw),balance:1});conflict.state.cloud={format:5,revision:'new',data:remote};const local=JSON.stringify({...JSON.parse(conflict.raw),balance:2});result=await conflict.sync(local);assert.equal(result.status,'conflict');await assert.rejects(conflict.sync(local,'local','old'),/版本已变化/);assert.equal(conflict.state.writes.length,0);conflict.state.failPut=true;const originalBaseline={...conflict.state.baseline};await assert.rejects(conflict.sync(local,'local','new'),/另一台设备更新/);assert.equal(conflict.state.writes.length,0);assert.deepEqual(conflict.state.baseline,originalBaseline);conflict.state.failPut=false;conflict.state.etag='W/"weak"';await assert.rejects(conflict.sync(local,'local','new'),/强版本标记/);assert.equal(conflict.state.writes.length,0);
 const missing=setup();result=await missing.sync();assert.equal(result.status,'ok');assert.equal(missing.state.writes.length,1);assert.equal(missing.state.calls.find(c=>c.method==='PUT').condition,'*');
 console.log('PASS dual edit conflict, stale chosen revision, HTTP 412 rejection preserving baseline, weak ETag rejection, and If-None-Match first upload.');
const bom=setup();bom.state.cloud={format:5,revision:'bom',data:'\uFEFF'+bom.raw};bom.state.baseline={revision:'bom',hash:bom.hash(bom.raw)};const bomResult=await bom.sync();assert.equal(bomResult.status,'ok');assert.equal(bom.state.writes.length,0);assert.equal(bom.state.baseline.hash,bom.hash(bom.raw));console.log('PASS BOM-normalized comparison and acknowledgement stay consistent.');
})().catch(e=>{console.error(e);process.exitCode=1});
