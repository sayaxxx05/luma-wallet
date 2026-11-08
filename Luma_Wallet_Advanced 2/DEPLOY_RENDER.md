# Публикация Luma Wallet — облачный сервер

## Быстро (без GitHub): Netlify Drop

1. На компьютере скачайте `Luma_Wallet_Site_Only.zip` и НЕ смешивайте его с PDF и исходными диаграммами.
2. Откройте **https://app.netlify.com/drop**.
3. Перетащите ZIP в область Drop (или выберите файл). Если понадобится, войдите в Netlify.
4. Netlify выдаст адрес `https://случайное-имя.netlify.app/` — скопируйте его. Это настоящая публичная ссылка на ваш сайт.
5. Проверьте сайт в обычном браузере. Для кошелька используйте MetaMask extension или встроенный браузер MetaMask. Не вводите секретные фразы на сайте.

Актуальная официальная инструкция: https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/

## Альтернатива: Render (как у одногруппника)

1. Создайте новый репозиторий в GitHub, например `luma-wallet`.
2. Загрузите **только** файлы веб-сайта из ZIP в корень репозитория (`index.html`, `styles.css`, `app.js`, `wallet-core.js`, `qr-vendor.js`, `favicon.svg`, `render.yaml`).
3. Откройте **https://dashboard.render.com/** → **New** → **Static Site** и подключите GitHub.
4. В форме укажите **Build Command:** `echo "No build needed"` и **Publish Directory:** `.`; либо используйте `render.yaml` с Blueprint.
5. После публикации сервис покажет действительный адрес `https://<site-id>.onrender.com/`.

Официальная документация: https://render.com/docs/static-sites

## Что делать с QR и платежами

- В деморежиме никакие деньги не переводятся.
- Для реального теста выберите **Sepolia Testnet** в MetaMask; используйте только test ETH.
- Для настоящего ETH MetaMask попросит явно подтвердить сумму, адрес и комиссию.
- Запрос на оплату передаёт параметры в ссылке, но не подтверждает получение платежа автоматически.

**Важно:** файлы проекта уже готовы к развёртыванию, однако настоящий URL появится только после действий в Netlify/Render. Не выдавайте пример URL за опубликованный сайт.
