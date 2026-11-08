import time
from urllib.parse import urlparse
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
def static_route(route):
    p=urlparse(route.request.url).path.lstrip('/') or 'index.html'
    path=root/p
    if not path.is_file():return route.fulfill(status=404,body='Not found')
    ext=path.suffix
    content_type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'}.get(ext,'application/octet-stream')
    return route.fulfill(path=str(path),content_type=content_type)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  ctx=browser.new_context(viewport={'width':1440,'height':900},permissions=['clipboard-read','clipboard-write'])
  page=ctx.new_page();page.route('**/*',static_route);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('https://luma.test/',wait_until='load',timeout=20000)
  assert page.locator('#heroBalance').inner_text()=='2.8450'
  page.locator('[data-view="send"]').first.click()
  page.locator('#sendTo').fill('0x1111111111111111111111111111111111111111')
  page.locator('#sendAmount').fill('0.125')
  page.locator('#sendForm button[type=submit]').click()
  page.locator('#modalConfirm').click()
  assert page.locator('#heroBalance').inner_text()=='2.7200'
  assert '0.1250 ETH' in page.locator('#allTransactions').inner_text()
  assert not errors,errors
  page.screenshot(path=str(root/'docs'/'preview_desktop.png'),full_page=True)
  print('Demo: PASS, no JS errors')
  ctx.close()
  # Separate context with fake MetaMask provider; no real chain transactions.
  ctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,permissions=['clipboard-read','clipboard-write'])
  page=ctx.new_page();page.route('**/*',static_route);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script('''(() => {
    const address='0x3333333333333333333333333333333333333333';
    window.ethereum={
      on(){}, request:async ({method,params})=>{
        switch(method){
          case 'eth_accounts': return [];
          case 'eth_requestAccounts': window.ethereum.request=async ({method,params})=>{
            switch(method){
              case 'eth_chainId':return '0xaa36a7';
              case 'eth_accounts':case 'eth_requestAccounts':return [address];
              case 'eth_getBalance':return '0x1bc16d674ec80000';
              case 'eth_sendTransaction':return '0x'+'a'.repeat(64);
              case 'eth_getTransactionReceipt':return {status:'0x1'};
              default:throw Error('unexpected '+method)
            }};return [address];
          case 'eth_chainId':return '0xaa36a7';
          default:throw Error('unexpected '+method)
        }
      }
    }
  })()''')
  page.goto('https://luma.test/',wait_until='load',timeout=20000)
  page.locator('#walletBtn').click()
  page.wait_for_timeout(300)
  assert '0x3333' in page.locator('#walletBtnText').inner_text(),page.locator('#walletBtnText').inner_text()
  page.locator('#menuBtn').click();page.locator('[data-view="receive"]').first.click()
  assert page.locator('#receiveQr').is_visible()
  page.locator('#invoiceAmount').fill('0.02')
  page.locator('#invoiceNote').fill('Учебная оплата')
  page.locator('#copyInvoiceLink').click()
  page.wait_for_timeout(200)
  link=page.evaluate('navigator.clipboard.readText()')
  assert 'amount=0.02' in link and 'chain=0xaa36a7' in link,link
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'horizontal overflow'
  page.screenshot(path=str(root/'docs'/'preview_mobile.png'),full_page=True)
  assert not errors,errors
  print('Mock MetaMask / QR / payment link / mobile: PASS')
  browser.close()
finally:
 pass
