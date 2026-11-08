/* Luma Wallet core: SOLID-oriented application layer.
   This library does NOT hold private keys. All blockchain writes are confirmed in the wallet.
   Functional dependencies are injected so tests can substitute fakes. */
(function(root, factory) {
  const lib = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = lib;
  root.LumaCore = lib;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // SRP: only concerns JSON persistence. Gracefully degrades when localStorage is blocked.
  class JsonStorage {
    constructor(nativeStorage) {
      try { this.nativeStorage = nativeStorage === undefined ? globalThis.localStorage : nativeStorage; }
      catch { this.nativeStorage = null; }
      this.fallback = new Map();
    }
    get(key, defaultValue) {
      if (this.fallback.has(key)) return this.fallback.get(key);
      try {
        const raw = this.nativeStorage?.getItem(key);
        return raw === null || raw === undefined ? defaultValue : JSON.parse(raw);
      } catch { return defaultValue; }
    }
    set(key, value) {
      this.fallback.set(key, value);
      try { this.nativeStorage?.setItem(key, JSON.stringify(value)); } catch {}
    }
  }

  // SRP: owns transaction records; oblivious to HTML, Ethereum and wallet choice.
  class TransactionRepository {
    constructor(storage) { this.storage = storage; }
    list(key) {
      const value = this.storage.get(key, []);
      return Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
    }
    save(key, items) { this.storage.set(key, items); }
    prepend(key, item) {
      const list = this.list(key);
      list.unshift(item);
      this.save(key, list);
      return list;
    }
  }

  // SRP: all precision-sensitive validation; no wallet/DOM/storage dependencies.
  class PaymentValidator {
    static isAddress(value) { return /^0x[a-fA-F0-9]{40}$/.test(String(value)); }
    static parseEthToWei(input) {
      const raw = String(input).trim().replace(',', '.');
      if (!/^(?:\d+(?:\.\d{0,18})?|\.\d{1,18})$/.test(raw)) {
        throw new Error('Введите корректную сумму ETH (не больше 18 знаков после точки).');
      }
      const [integer = '0', decimal = ''] = raw.split('.');
      const wei = BigInt(integer || '0') * 10n ** 18n + BigInt((decimal + '0'.repeat(18)).slice(0,18));
      if (wei <= 0n) throw new Error('Сумма должна быть больше нуля.');
      return wei;
    }
    static assertTransfer({ to, wei, from, balanceWei }) {
      if (!this.isAddress(to)) throw new Error('Неверный адрес Ethereum.');
      if (typeof wei !== 'bigint' || wei <= 0n) throw new Error('Сумма должна быть положительной.');
      if (from && to.toLowerCase() === from.toLowerCase()) throw new Error('Нельзя отправить самому себе.');
      if (balanceWei !== undefined && wei >= balanceWei) throw new Error('Оставьте ETH для комиссии сети.');
    }
  }

  // OCP + DIP: isolated EIP-1193 adapter. Payment service only knows method contracts.
  class Eip1193Gateway {
    constructor(providerSource) { this.providerSource = providerSource; }
    get provider() {
      const provider = typeof this.providerSource === 'function' ? this.providerSource() : this.providerSource;
      if (!provider || typeof provider.request !== 'function') throw new Error('MetaMask не установлен.');
      return provider;
    }
    connect() { return this.provider.request({ method:'eth_requestAccounts' }); }
    async snapshot() {
      const [chainId, accounts] = await Promise.all([
        this.provider.request({ method: 'eth_chainId' }),
        this.provider.request({ method: 'eth_accounts' })
      ]);
      if (!Array.isArray(accounts) || accounts.length === 0) return {chainId, accounts: [], balanceWei: 0n};
      const address = accounts[0];
      const balance = await this.provider.request({method:'eth_getBalance',params:[address,'latest']});
      return {chainId, accounts, address, balanceWei:BigInt(balance)};
    }
    sendNative({from,to,wei}) {
      return this.provider.request({method:'eth_sendTransaction',params:[{from,to,value:'0x'+wei.toString(16)}]});
    }
    receipt(hash) { return this.provider.request({method:'eth_getTransactionReceipt',params:[hash]}); }
  }

  // LSP: concrete payment strategies share a uniform asynchronous send contract.
  class PaymentProcessor {
    async send(/* request */) { throw new Error('PaymentProcessor.send() must be implemented.'); }
  }

  // DIP: only relies on gateway/repository contracts; substitutable in tests.
  class EthereumPaymentProcessor extends PaymentProcessor {
    constructor(gateway, transactionRepository) {
      super();
      this.gateway = gateway;
      this.transactions = transactionRepository;
    }
    async send({ from, to, wei, amount, note, historyKey }) {
      PaymentValidator.assertTransfer({to,wei,from});
      const hash = await this.gateway.sendNative({from,to,wei});
      if (!/^0x[a-fA-F0-9]{64}$/.test(String(hash))) throw new Error('Кошелёк вернул некорректный хеш транзакции.');
      const transaction={id:hash,hash,type:'sent',amount,note:note||'Перевод ETH',to,time:Date.now(),status:'pending'};
      this.transactions.prepend(historyKey,transaction);
      return {mode:'real',transaction,hash,status:'pending'};
    }
    async reconcile(historyKey) {
      const items=this.transactions.list(historyKey);
      let changed=0;
      for(const tx of items.filter(t=>t.hash && t.status==='pending')) {
        const receipt=await this.gateway.receipt(tx.hash);
        if(receipt) { tx.status=receipt.status==='0x1'?'success':'failed'; changed++; }
      }
      if(changed) this.transactions.save(historyKey,items);
      return changed;
    }
  }

  // LSP: same async send() contract. It intentionally never calls a blockchain provider.
  class DemoPaymentProcessor extends PaymentProcessor {
    async send({to, amount, note, balance, history}) {
      if (!PaymentValidator.isAddress(to)) throw new Error('Неверный адрес Ethereum.');
      const wei = PaymentValidator.parseEthToWei(amount);
      const balanceWei = BigInt(Math.round(Number(balance) * 1e8)) * 10000000000n;
      if(wei > balanceWei) throw new Error('Недостаточно учебного баланса.');
      if(wei % 10000000000n !== 0n) throw new Error('В деморежиме максимум 8 знаков после запятой.');
      // Demo limited to 8 fractional digits to avoid JS floating point display drift.
      const resultBalance=Number((Number(balance)-Number(amount)).toFixed(8));
      const item={id:'demo-'+Date.now(),type:'sent',amount,note:note||'Учебный перевод',to,time:Date.now(),status:'success'};
      return {mode:'demo',transaction:item,hash:null,status:'success',balance:resultBalance,history:[item,...history]};
    }
  }

  return {JsonStorage,TransactionRepository,PaymentValidator,Eip1193Gateway,PaymentProcessor,EthereumPaymentProcessor,DemoPaymentProcessor};
});
