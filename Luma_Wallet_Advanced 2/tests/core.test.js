const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JsonStorage,TransactionRepository,PaymentValidator,Eip1193Gateway,EthereumPaymentProcessor,DemoPaymentProcessor} = require('../wallet-core.js');

function memoryStorage(){const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v)};}
const address='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const hash='0x'+'a'.repeat(64);

test('precise ETH amount conversion handles 18 decimals and rejects invalid numbers',()=>{
 assert.equal(PaymentValidator.parseEthToWei('1.000000000000000001'),1000000000000000001n);
 assert.equal(PaymentValidator.parseEthToWei('0,5'),500000000000000000n);
 assert.throws(()=>PaymentValidator.parseEthToWei('0'));
 assert.throws(()=>PaymentValidator.parseEthToWei('-1'));
 assert.throws(()=>PaymentValidator.parseEthToWei('0.0000000000000000001'));
});
test('validates addresses and rejects transfer to own account',()=>{
 assert.equal(PaymentValidator.isAddress(address),true);
 assert.equal(PaymentValidator.isAddress('0xwrong'),false);
 assert.throws(()=>PaymentValidator.assertTransfer({to:address,from:address,wei:1n}),/самому себе/);
});
test('JSON repository is isolated from payment logic',()=>{
 const repo=new TransactionRepository(new JsonStorage(memoryStorage()));
 repo.prepend('test',{id:'a'});repo.prepend('test',{id:'b'});
 assert.deepEqual(repo.list('test').map(x=>x.id),['b','a']);
});
test('demo never talks to blockchain and lowers the balance',async()=>{
 const processor=new DemoPaymentProcessor();
 const result=await processor.send({to:other,amount:'0.25',note:'Test',balance:2.845,history:[]});
 assert.equal(result.balance,2.595);assert.equal(result.history[0].status,'success');
 await assert.rejects(processor.send({to:other,amount:'3',balance:2.845,history:[]}),/баланса/);
});
test('gateway calls correct EIP-1193 methods',async()=>{
 const methods=[];
 const provider={request:async ({method})=>{
 methods.push(method);return method==='eth_chainId'?'0xaa36a7':method==='eth_accounts'?[address]:method==='eth_getBalance'?'0x10':'ok';
 }};
 const gateway=new Eip1193Gateway(provider);
 const snapshot=await gateway.snapshot();
 assert.equal(snapshot.balanceWei,16n);assert.deepEqual(methods,['eth_chainId','eth_accounts','eth_getBalance']);
});
test('Ethereum payment records pending tx, then reconciles confirmed receipt',async()=>{
 let sends=0;
 const fakeGateway={sendNative:async()=>{sends++;return hash},receipt:async()=>({status:'0x1'})};
 const repo=new TransactionRepository(new JsonStorage(memoryStorage()));
 const svc=new EthereumPaymentProcessor(fakeGateway,repo);
 await svc.send({from:address,to:other,wei:1n,amount:'0.000000000000000001',note:'test',historyKey:'key'});
 assert.equal(sends,1);assert.equal(repo.list('key')[0].status,'pending');
 const updates=await svc.reconcile('key');
 assert.equal(updates,1);assert.equal(repo.list('key')[0].status,'success');
});
test('ethereum payment does not save fake transaction when user rejects',async()=>{
 const repo=new TransactionRepository(new JsonStorage(memoryStorage()));
 const svc=new EthereumPaymentProcessor({sendNative:async()=>{throw Object.assign(new Error('Denied'),{code:4001})}},repo);
 await assert.rejects(svc.send({from:address,to:other,wei:1n,historyKey:'key'}));
 assert.equal(repo.list('key').length,0);
});

test('LSP both payment processors return a uniform result object',async()=>{
 const repo=new TransactionRepository(new JsonStorage(memoryStorage()));
 const real=new EthereumPaymentProcessor({sendNative:async()=>hash,receipt:async()=>null},repo);
 const demo=new DemoPaymentProcessor();
 const results=await Promise.all([real.send({from:address,to:other,wei:10n,amount:'0.00000000000000001',historyKey:'key'}),demo.send({to:other,amount:'0.25',balance:1,history:[]})]);
 for(const result of results){assert.ok(result.mode);assert.ok(result.transaction);assert.ok(result.status);assert.ok('hash' in result);}
});
