/* Luma Wallet — browser-only non-custodial MetaMask client + clearly isolated demo mode.
   No private keys, passwords or seed phrases are requested or stored. */
(() => {
  'use strict';

  const DEMO_ADDR = 'DEMO • НЕ БЛОКЧЕЙН-АДРЕС';
  const SEPOLIA = '0xaa36a7';
  const CHAINS = {
    '0x1': { name: 'Ethereum Mainnet', short: 'Ethereum', explorer: 'https://etherscan.io/tx/' },
    [SEPOLIA]: { name: 'Sepolia Testnet', short: 'Sepolia', explorer: 'https://sepolia.etherscan.io/tx/' }
  };
  const initialTxs = [
    { id: 'demo-one', type: 'received', amount: '1.5000', note: 'Учебное пополнение', to: 'DEMO', time: Date.now() - 3600 * 1000 * 26, status: 'success' },
    { id: 'demo-two', type: 'sent', amount: '0.2500', note: 'Пробный перевод', to: '0x1111111111111111111111111111111111111111', time: Date.now() - 3600 * 1000 * 55, status: 'success' },
    { id: 'demo-three', type: 'received', amount: '0.8500', note: 'Тестовое зачисление', to: 'DEMO', time: Date.now() - 3600 * 1000 * 107, status: 'success' }
  ];
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  // Composition root: independent SOLID services are wired here.
  const {JsonStorage,TransactionRepository,PaymentValidator,Eip1193Gateway,
    EthereumPaymentProcessor,DemoPaymentProcessor} = window.LumaCore;
  const safeStorage = new JsonStorage();
  const txRepository = new TransactionRepository(safeStorage);
  const walletGateway = new Eip1193Gateway(() => window.ethereum);
  const realPayments = new EthereumPaymentProcessor(walletGateway, txRepository);
  const demoPayments = new DemoPaymentProcessor();
  const state = {
    mode: 'demo',
    address: null,
    chainId: SEPOLIA,
    balanceWei: 0n,
    demoBalance: Number(safeStorage.get('luma_demo_balance_v1', 2.845)) || 0,
    demoTxs: safeStorage.get('luma_demo_transactions_v1', null) || initialTxs,
    filter: 'all'
  };
  let modalAction = null;
  let toastTimer;

  function escaped(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }
  function shortAddress(addr, head=6, tail=4) { return addr && addr.startsWith('0x') ? `${addr.slice(0,head)}...${addr.slice(-tail)}` : 'Демо-адрес'; }
  function getChain() { return CHAINS[state.chainId] || null; }
  function historyKey() { return `luma_real_tx_v1_${(state.address || '').toLowerCase()}_${state.chainId}`; }
  function getTxs() {
    const source = state.mode === 'demo' ? state.demoTxs : txRepository.list(historyKey());
    return Array.isArray(source) ? source.filter(item => item && typeof item === 'object') : [];
  }
  function saveDemo() {
    safeStorage.set('luma_demo_balance_v1', state.demoBalance);
    safeStorage.set('luma_demo_transactions_v1', state.demoTxs);
  }
  function saveReal(list) { txRepository.save(historyKey(), list); }
  function formatAmount(value) { return Number(value).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }); }
  function formatBalance() {
    if (state.mode === 'demo') return formatAmount(state.demoBalance);
    const whole = state.balanceWei / (10n ** 18n);
    const fraction = (state.balanceWei % (10n ** 18n)).toString().padStart(18, '0').slice(0, 4);
    return `${whole.toLocaleString('en-US')}.${fraction}`;
  }
  function amountToWei(raw) { return PaymentValidator.parseEthToWei(raw); }
  function walletFriendlyError(error) {
    if (error && (error.code === 4001 || error.code === 'ACTION_REJECTED')) return 'Операция отменена в MetaMask.';
    const message = String(error?.message || error || 'Неизвестная ошибка');
    if (/insufficient funds/i.test(message)) return 'Недостаточно ETH для суммы перевода и комиссии сети.';
    if (/not installed|not found|undefined/i.test(message)) return 'MetaMask не обнаружен в браузере.';
    return message.length > 240 ? message.slice(0, 237) + '...' : message;
  }
  function showToast(message) {
    const t = $('#toast'); t.textContent = message; t.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), 3200);
  }
  async function copyText(value) {
    if (!value) return;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const el = document.createElement('textarea'); el.value = value; el.style.cssText = 'position:fixed;left:-9999px;';
        document.body.append(el); el.select();
        if (!document.execCommand('copy')) throw Error('copy rejected');
        el.remove();
      }
      showToast('Скопировано в буфер обмена');
    } catch { showToast('Не удалось скопировать. Выделите адрес вручную.'); }
  }
  function dialog({ title, text, details = '', ok = 'Понятно', cancel = false, onConfirm = null }) {
    $('#modalTitle').textContent = title; $('#modalText').textContent = text;
    $('#modalDetails').innerHTML = details; $('#modalDetails').classList.toggle('visible', !!details);
    $('#modalConfirm').textContent = ok; $('#modalCancel').style.display = cancel ? 'flex' : 'none';
    modalAction = onConfirm; $('#modalBackdrop').hidden = false; $('#modalConfirm').focus();
  }
  function closeDialog() { $('#modalBackdrop').hidden = true; modalAction = null; }
  function switchView(view) {
    if (!['overview','send','receive','activity'].includes(view)) return;
    $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
    $$('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    const labels = { overview:'Обзор', send:'Отправить', receive:'Получить', activity:'История' };
    $('#breadcrumbCurrent').textContent = labels[view];
    if (location.hash.slice(1) !== view) {
      try { history.replaceState(null, '', `#${view}`); }
      catch { try { location.hash = view; } catch {} }
    }
    $('#sidebar').classList.remove('open'); $('#sidebarBackdrop').hidden = true;
    window.scrollTo({top:0,behavior:'smooth'});
    if (view === 'receive') drawQR();
  }
  function renderTx(tx) {
    const received = tx.type === 'received';
    const amount = Number(tx.amount || 0);
    const date = Number(tx.time) ? new Date(Number(tx.time)).toLocaleString('ru-RU', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    const label = tx.note || (received ? 'Получение ETH' : 'Перевод ETH');
    const status = tx.status === 'pending' ? 'Ожидает подтверждения' : tx.status === 'failed' ? 'Ошибка' : 'Успешно';
    const statusCls = tx.status === 'pending' ? 'pending' : tx.status === 'failed' ? 'failed' : '';
    const explorer = getChain()?.explorer;
    const external = tx.hash && explorer ? `<button class="tx-external" data-hash="${escaped(tx.hash)}" title="Открыть в Etherscan" aria-label="Открыть транзакцию в Etherscan"><svg class="icon"><use href="#i-external"/></svg></button>` : '';
    return `<div class="tx-item"><div class="tx-icon ${received ? 'received' : 'sent'}"><svg class="icon"><use href="#i-${received ? 'arrow-down' : 'arrow-up'}"/></svg></div><div class="tx-name"><strong>${escaped(label)}</strong><small>${escaped(date)} ${tx.to && !received ? '· '+escaped(shortAddress(tx.to)) : ''}</small></div><div class="tx-amount"><strong>${received ? '+' : '−'}${escaped(formatAmount(amount))} ETH</strong><small class="${statusCls}">${status}</small></div>${external}</div>`;
  }
  function renderHistory() {
    const txs = getTxs().sort((a,b) => Number(b.time||0)-Number(a.time||0));
    $('#recentTransactions').innerHTML = txs.length ? txs.slice(0,4).map(renderTx).join('') : '<div class="empty-state">Здесь появятся ваши операции.</div>';
    const filtered = state.filter === 'all' ? txs : txs.filter(t => t.type === state.filter);
    $('#allTransactions').innerHTML = filtered.length ? filtered.map(renderTx).join('') : '<div class="empty-state">Нет операций в этой категории.</div>';
    $('#metricCount').textContent = String(txs.length);
    const sent = txs.filter(t=>t.type==='sent' && t.status !== 'failed').reduce((s,t)=>s+Number(t.amount||0),0);
    $('#metricSent').textContent = formatAmount(sent) + ' ETH';
    $('#historySubtitle').textContent = `${txs.length} операций · ${state.mode === 'demo' ? 'деморежим' : 'этот браузер / выбранная сеть'}`;
    $$('.filter').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === state.filter));
  }
  function render() {
    const demo = state.mode === 'demo';
    const addr = demo ? null : state.address;
    const balance = formatBalance();
    const chain = demo ? { short: 'Sepolia', name: 'Sepolia Testnet' } : getChain();
    $('#heroBalance').textContent = balance;
    $('#metricBalance').textContent = balance + ' ETH';
    $('#formAvailable').textContent = balance + ' ETH';
    $('#heroNetwork').textContent = demo ? 'Sepolia · Демо' : chain ? chain.name : 'Неподдерживаемая сеть';
    $('#heroStatus').textContent = demo ? 'Учебный баланс' : 'MetaMask подключён';
    $('#heroSub').textContent = demo ? 'Учебные средства · не имеют реальной стоимости' : 'Баланс из блокчейна · обновляется через MetaMask';
    $('#networkText').textContent = demo ? 'Демо · Sepolia' : chain ? chain.name : 'Другая сеть';
    $('#walletBtnText').textContent = demo ? 'Подключить MetaMask' : shortAddress(addr);
    $('#shortAddress').textContent = demo ? 'Учебный кошелёк' : shortAddress(addr,8,6);
    $('#fullAddress').textContent = demo ? DEMO_ADDR : addr;
    $('#demoBanner').hidden = !demo;
    $('#sendHint').textContent = demo
      ? 'Это деморежим: монеты ненастоящие, комиссия не списывается.'
      : chain ? 'Реальный перевод: MetaMask покажет итоговую сумму и комиссию сети перед подтверждением.'
        : 'Отправка доступна только в Ethereum Mainnet или Sepolia. Переключите сеть в MetaMask.';
    $('#sendSubmitText').textContent = demo ? 'Перевести демо ETH' : 'Продолжить в MetaMask';
    $('#receiveSubtitle').textContent = demo ? 'Подключите MetaMask, чтобы получить реальный адрес.' : `Публичный адрес в сети ${chain?.name || 'текущая сеть'}`;
    $('#receiveAddress').textContent = demo ? 'Демо-адрес не может получать реальные средства' : addr;
    $('#copyReceiveBtn').disabled = demo;
    $('#copyPaymentLink').disabled = demo;
    $('#copyInvoiceLink').disabled = demo;
    $('#copyHomeAddress').disabled = demo;
    renderHistory();
    drawQR();
  }
  function drawQR() {
    const demo = state.mode === 'demo';
    const canvas = $('#receiveQr'), placeholder = $('#qrPlaceholder');
    canvas.style.display = demo ? 'none' : 'block'; placeholder.style.display = demo ? 'flex' : 'none';
    if (demo || !state.address || !window.LumaQRCode) return;
    try {
      const qr = new window.LumaQRCode(0, 1);
      qr.addData(state.address); qr.make();
      const count=qr.getModuleCount(), quiet=4, cell=Math.max(2,Math.floor(245/(count+quiet*2)));
      const pixels=(count+quiet*2)*cell;
      canvas.width=pixels; canvas.height=pixels;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,pixels,pixels);
      ctx.fillStyle='#1a3e2e';
      for(let row=0;row<count;row++) for(let col=0;col<count;col++) if(qr.isDark(row,col)) ctx.fillRect((col+quiet)*cell,(row+quiet)*cell,cell,cell);
    } catch { canvas.style.display='none'; placeholder.style.display='flex'; placeholder.textContent='Не удалось создать QR-код'; }
  }
  async function refreshWallet() {
    if (!window.ethereum || !state.address || state.mode === 'demo') return;
    const snapshot = await walletGateway.snapshot();
    if (!snapshot.accounts.length) { backToDemo(); return; }
    state.address = snapshot.address;
    state.chainId = String(snapshot.chainId).toLowerCase();
    state.balanceWei = snapshot.balanceWei;
    render();
  }
  async function connectWallet() {
    if (!window.ethereum || typeof window.ethereum.request !== 'function') {
      dialog({ title:'Нужен MetaMask', text:'Для реальных переводов установите расширение MetaMask на компьютере или откройте сайт во встроенном браузере мобильного MetaMask. В деморежиме можно работать без него.', ok:'Перейти на сайт MetaMask', onConfirm:()=>window.open('https://metamask.io/download/','_blank','noopener,noreferrer') });
      return;
    }
    try {
      const accounts = await walletGateway.connect();
      if (!accounts || !accounts.length) throw Error('Не выбран аккаунт MetaMask');
      state.mode = 'real'; state.address = accounts[0];
      await refreshWallet();
      showToast('MetaMask подключён');
    } catch (error) { backToDemo(); dialog({ title:'Не удалось подключиться', text:walletFriendlyError(error) }); }
  }
  function backToDemo() { state.mode='demo';state.address=null;state.chainId=SEPOLIA;state.balanceWei=0n;render(); }
  function connectOrSwitch() {
    if (state.mode === 'demo') return connectWallet();
    dialog({title:'Ваш кошелёк подключён',text:`${state.address}\n\nСеть: ${getChain()?.name || 'неподдерживаемая'}. Для изменения аккаунта или сети откройте MetaMask. Можно вернуться в учебный режим.`,cancel:true,ok:'Перейти в демо',onConfirm:()=>{backToDemo();showToast('Включён деморежим');}});
  }
  function confirmSend(to, amount, note, wei) {
    const demo = state.mode === 'demo';
    const summary = `<div><b>Кому:</b> ${escaped(to)}</div><div><b>Сумма:</b> ${escaped(amount)} ETH</div><div><b>Сеть:</b> ${escaped(demo ? 'Демонстрационная' : getChain()?.name || 'Неизвестно')}</div>`;
    dialog({
      title: demo ? 'Подтвердить тестовый перевод?' : 'Подтвердить отправку ETH?',
      text: demo ? 'Это учебная операция: реальная криптовалюта не будет переведена.' : 'После нажатия откроется MetaMask. Проверьте адрес, сеть, сумму и комиссию! Реальный перевод необратим.',
      details: summary, cancel:true, ok: demo ? 'Отправить демо ETH' : 'Открыть MetaMask',
      onConfirm:()=>executeSend(to,amount,note,wei)
    });
  }
  async function executeSend(to, amount, note, wei) {
    if (state.mode === 'demo') {
      try {
        const result=await demoPayments.send({to,amount,note,balance:state.demoBalance,history:state.demoTxs});
        state.demoBalance=result.balance;
        state.demoTxs=result.history;
        saveDemo();render();$('#sendForm').reset();switchView('activity');
        showToast('Учебный перевод успешно выполнен');
      }catch(error){showToast(walletFriendlyError(error));}
      return;
    }
    try {
      await realPayments.send({from:state.address,to,wei,amount,note,historyKey:historyKey()});
      await refreshWallet();render();$('#sendForm').reset();switchView('activity');
      dialog({title:'Транзакция отправлена',text:'MetaMask отправил транзакцию в блокчейн. Сейчас её статус — ожидание подтверждения. Проверить результат можно во вкладке «История».',ok:'Понятно'});
    } catch(error) { dialog({title:'Транзакция не отправлена',text:walletFriendlyError(error)}); }
  }
  function submitForm(event) {
    event.preventDefault();
    const to=$('#sendTo').value.trim(), raw=$('#sendAmount').value.trim(), note=$('#sendNote').value.trim();
    if(!PaymentValidator.isAddress(to)){showToast('Нужен полный Ethereum-адрес: 0x и 40 символов.');$('#sendTo').focus();return;}
    let wei;
    try { wei=amountToWei(raw); } catch (e) { showToast(e.message);$('#sendAmount').focus();return; }
    if(state.mode==='demo'){
      if (Number(raw.replace(',','.')) > state.demoBalance) {showToast('Недостаточно учебного баланса.');return;}
    } else {
      if(!getChain()){showToast('Выберите Ethereum Mainnet или Sepolia в MetaMask.');return;}
      const requestedChain=new URLSearchParams(location.search).get('chain');
      if(requestedChain && CHAINS[requestedChain] && state.chainId !== requestedChain){showToast('Сеть не совпадает со ссылкой. Переключите сеть в MetaMask.');return;}
      if(wei >= state.balanceWei){showToast('Оставьте часть ETH на комиссию сети (gas).');return;}
      if(to.toLowerCase()===state.address.toLowerCase()) {showToast('Адрес получателя совпадает с вашим кошельком.');return;}
    }
    confirmSend(to,raw.replace(',','.'),note,wei);
  }
  async function refreshStatuses() {
    if(state.mode==='demo'){showToast('В деморежиме все операции уже завершены.');return;}
    if(!window.ethereum){showToast('MetaMask не найден.');return;}
    try {
      const changed=await realPayments.reconcile(historyKey());
      await refreshWallet();showToast(changed?`Обновлено операций: ${changed}`:'Пока новых подтверждений нет.');
    }catch(error){showToast(walletFriendlyError(error));}
  }
  function paymentLink(includeInvoice = false) {
    if(state.mode==='demo' || !state.address){showToast('Сначала подключите MetaMask.');return;}
    if(!['http:','https:'].includes(location.protocol)){
      dialog({title:'Ссылка после публикации',text:'Ссылка для оплаты станет доступна после публикации сайта по HTTPS. Пока можно скопировать адрес.'});return;
    }
    const target=new URL(location.origin + location.pathname);
    target.searchParams.set('to',state.address);
    target.searchParams.set('chain',state.chainId);
    if(includeInvoice) {
      const amount=$('#invoiceAmount').value.trim();
      const note=$('#invoiceNote').value.trim();
      try {amountToWei(amount);}catch(error){showToast(walletFriendlyError(error));$('#invoiceAmount').focus();return;}
      target.searchParams.set('amount',amount.replace(',','.'));
      if(note) target.searchParams.set('note',note.slice(0,70));
    }
    target.hash='send';copyText(target.toString());
    if(includeInvoice)showToast('Ссылка на оплату готова: вставьте её в браузер плательщика.');
  }
  function init() {
    $('#datePill').textContent = new Date().toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
    $$('[data-view]').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.view)));
    $('#walletBtn').addEventListener('click',connectOrSwitch);
    $('#switchRealBtn').addEventListener('click',connectWallet);
    $('#copyHomeAddress').addEventListener('click',()=>copyText(state.mode==='demo'?'':state.address));
    $('#copyReceiveBtn').addEventListener('click',()=>copyText(state.mode==='demo'?'':state.address));
    $('#copyPaymentLink').addEventListener('click',()=>paymentLink(false));
    $('#copyInvoiceLink').addEventListener('click',()=>paymentLink(true));
    $('#sendForm').addEventListener('submit',submitForm);
    $('#refreshBtn').addEventListener('click',refreshStatuses);
    $$('.filter').forEach(btn=>btn.addEventListener('click',()=>{state.filter=btn.dataset.filter;renderHistory();}));
    $('#modalConfirm').addEventListener('click',()=>{const action=modalAction;closeDialog();if(action)action();});
    $('#modalCancel').addEventListener('click',closeDialog);
    $('#modalClose').addEventListener('click',closeDialog);
    $('#modalBackdrop').addEventListener('click',event=>{if(event.target===$('#modalBackdrop'))closeDialog();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDialog();});
    $('#helpBtn').addEventListener('click',()=>dialog({title:'Как работает Luma Wallet',text:'Сайт не создаёт и не хранит приватные ключи. В деморежиме все операции выполняются только в браузере.\n\nПосле подключения MetaMask баланс читается из выбранной сети, а отправку ETH подтверждаете вы сами в MetaMask.\n\nИстория в Luma содержит только переводы, выполненные через приложение в текущем браузере.'}));
    $('#menuBtn').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#sidebarBackdrop').hidden=false;});
    $('#sidebarBackdrop').addEventListener('click',()=>{$('#sidebar').classList.remove('open');$('#sidebarBackdrop').hidden=true;});
    document.addEventListener('click',event=>{
      const trigger=event.target.closest('[data-hash]');if(!trigger)return;
      const hash=trigger.dataset.hash;
      if(!/^0x[a-fA-F0-9]{64}$/.test(hash))return;
      const base=getChain()?.explorer;if(base)window.open(base+hash,'_blank','noopener,noreferrer');
    });
    const params=new URLSearchParams(location.search);
    if(params.has('to')){
      const to=params.get('to');if(PaymentValidator.isAddress(to)){
        $('#sendTo').value=to;
        const amount=params.get('amount');
        if(amount){try{amountToWei(amount);$('#sendAmount').value=amount;}catch{}}
        const note=params.get('note');if(note)$('#sendNote').value=note.slice(0,70);
        switchView('send');
      }
    } else if(['overview','send','receive','activity'].includes(location.hash.slice(1))) switchView(location.hash.slice(1));
    render();
    if(window.ethereum && typeof window.ethereum.on==='function') {
      window.ethereum.on('accountsChanged', accounts=>{if(state.mode!=='real')return;if(!accounts?.length)backToDemo();else{state.address=accounts[0];refreshWallet().catch(()=>backToDemo());}});
      window.ethereum.on('chainChanged', chain=>{if(state.mode!=='real')return;state.chainId=String(chain).toLowerCase();refreshWallet().catch(()=>showToast('Не удалось обновить сеть.'));});
      // If user already granted access earlier, restore without a connection popup.
      window.ethereum.request({method:'eth_accounts'}).then(async accounts=>{
        if(state.mode==='demo' && accounts && accounts.length){state.mode='real';state.address=accounts[0];try{await refreshWallet();}catch{backToDemo();}}
      }).catch(()=>{});
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
