# mini-nest (part 2 — HTTP)

Власний IoC-контейнер у стилі NestJS і HTTP-шар поверх `node:http`: `@Controller` / `@Get` / `@Post`, параметр-декоратори, диспетчер і pipe валідації DTO.

## Як запустити

```bash
npm install
npm test
```

У Docker (образ із ДЗ #5, builder stage з override). Після зміни залежностей спочатку перезберіть образ:

```bash
docker compose build api
docker compose run --rm api npm test
```

Локальний демо-запуск HTTP-сервера:

```bash
npm run start:dev
```

Приклади:

```bash
curl http://localhost:3000/users/42
curl 'http://localhost:3000/users?limit=5'
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com"}'
```

## Як це працює (IoC)

TypeScript зі прапорцями `experimentalDecorators` і `emitDecoratorMetadata` під час компіляції записує типи параметрів конструктора в метадані Reflect під ключем `design:paramtypes`. Це відбувається **лише якщо на класі є хоча б один декоратор** — саме тому потрібен `@Injectable()`: він не лише маркує клас для контейнера, а й «вмикає» емісію метаданих. Без `emitDecoratorMetadata` ключ `design:paramtypes` не з’являється, і контейнер не може сам побудувати граф залежностей. Інтерфейси в рантаймі стираються до `Object`, тому для них потрібен явний `@Inject(token)` (Symbol або рядок): контейнер читає токен з окремих метаданих і резолвить провайдер за ним, а не за типом з `design:paramtypes`.

`@Controller()` також ставить injectable-метадані, тож диспетчер створює контролер через той самий контейнер, що й сервіси.

## Як параметр-декоратор знає, куди підставити значення

`@Body()`, `@Param(name)` і `@Query(name)` самі нічого з запиту не читають. Сигнатура параметр-декоратора — `(target, propertyKey, parameterIndex)`: `parameterIndex` — це позиція аргумента в методі (0, 1, 2, …). Декоратор лише записує в метадані методу мапу `{ [index]: { type: 'body' | 'param' | 'query', name } }`.

Порядок виконання: спочатку параметр-декоратори, потім декоратор методу (`@Get` / `@Post`), потім класу (`@Controller`). Через це шлях і параметри вже лежать у Reflect, коли роутер обходить контролери.

Під час запиту диспетчер знаходить маршрут, читає цю мапу і збирає масив аргументів за індексами: `param` — з сегментів URL (`:id`), `query` — з query-string, `body` — з JSON-тіла після `plainToInstance` + `validate`. Потім викликає метод інстанса контролера, який дав контейнер. Саме тому обробник пише `findOne(@Param('id') id: string)` і не чіпає `req`.
