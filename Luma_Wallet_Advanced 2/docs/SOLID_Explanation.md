# SOLID в проекте Luma Wallet

Все основные реализации находятся в `wallet-core.js`. Связывание зависимостей выполняет `app.js` в начале файла (composition root).

| Принцип | Где в коде | Обоснование / пример |
| --- | --- | --- |
| **S — Single Responsibility** | `PaymentValidator`, `JsonStorage`, `TransactionRepository` | Валидатор проверяет адрес и сумму; хранилище отвечает за JSON; репозиторий только за историю транзакций. Изменение валидации не требует переписывать localStorage. |
| **O — Open/Closed** | `EthereumPaymentProcessor`, `Eip1193Gateway` | Процессор не знает тип конкретного криптокошелька. Можно добавить альтернативный gateway с теми же методами без изменения процессора. |
| **L — Liskov Substitution** | `PaymentProcessor`, `DemoPaymentProcessor`, `EthereumPaymentProcessor` | Оба процессора наследуют общий абстрактный класс и возвращают через `async send(...)` унифицированный объект `{mode, transaction, hash, status}`, поэтому UI может работать с общим контрактом. В деморежиме дополнительно возвращается баланс и история. |
| **I — Interface Segregation** | `Eip1193Gateway`, `TransactionRepository` | Процессор получает только необходимый набор операций (`sendNative`, `receipt`, `prepend`, `list`, `save`), а не огромный «кошелёк со всеми функциями». В JavaScript это duck typing, а не интерфейсы TypeScript. |
| **D — Dependency Inversion** | `EthereumPaymentProcessor(gateway, transactionRepository)` | Зависимости передаются конструктору: во время тестов `gateway` заменён fake-объектом, а сохранение — in-memory storage. Высокоуровневый сервис не зависит от конкретного браузера. |

**Важная оговорка:** SOLID — принципы проектирования, а не библиотека или свойство CSS. Проект использует их в сервисном JavaScript-слое, без отдельного backend. В этой реализации LSP иллюстрируется частично, поскольку сигнатуры результатов `send()` ещё различаются. На защите лучше объяснять этот tradeoff честно.

## Как это проверить

```bash
node --test tests/core.test.js
```

Тесты покрывают точность перевода ETH→wei, валидацию адреса, хранилище, демоперевод, методы EIP-1193, запись `Pending` и последующее подтверждение транзакции, а также отмену в MetaMask. Реальные средства тестами не отправляются.

## Поток настоящей отправки

`UI → PaymentValidator → EthereumPaymentProcessor → Eip1193Gateway → MetaMask → Ethereum`, после получения `hash` → `TransactionRepository` (Pending); после запроса `receipt` → Success / Failed.
