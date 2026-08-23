# mini-nest (part 3 — lifecycle)

Власний IoC-контейнер у стилі NestJS і HTTP-шар поверх `node:http`: повний цикл запиту, як у Nest.

## Як запустити

```bash
npm install
npm test
npm run typecheck
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

Захищені маршрути потребують заголовка `Authorization`. Існують користувачі з id `1`, `2`, `3`.

```bash
curl -si http://localhost:3000/users/1 \
  -H 'Authorization: Bearer test' \
  | grep -i x-request-id

curl -si http://localhost:3000/users/1 \
  -H 'Authorization: Bearer test' \
  -H 'X-Request-Id: my-id'

curl -si 'http://localhost:3000/users?limit=5' \
  -H 'Authorization: Bearer test'

curl -si http://localhost:3000/users \
  -H 'Authorization: Bearer test' \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com"}'
```

Без `Authorization` відповідь — `403`. Якщо клієнт надіслав `X-Request-Id`, той самий id повертається в заголовку відповіді; інакше сервер генерує UUID.

## Життєвий цикл запиту

Кожен HTTP-виклик проходить той самий ланцюг. Middleware ставить контекст запиту, exception filter стоїть усередині цього контексту й ловить усе, що кинули глибше — включно з interceptor.

```
                          HTTP request
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Middleware — X-Request-Id + AsyncLocalStorage.run(store)     │
 │ ┌─────────────────────────────────────────────────────────┐ │
 │ │ Exception Filter — try/catch навколо всього нижче       │ │
 │ │                                                         │ │
 │ │   Guard ───── false ──► ForbiddenError ────────► 403    │ │
 │ │     │ true                                              │ │
 │ │     ▼                                                   │ │
 │ │   Interceptor  before: t0 = performance.now()           │ │
 │ │     │                                                   │ │
 │ │     ▼                                                   │ │
 │ │   Pipe (Zod) ─ invalid ─► ValidationError ─────► 400    │ │
 │ │     │ parsed dto                                        │ │
 │ │     ▼                                                   │ │
 │ │   Handler ─── NotFoundError ───────────────────► 404    │ │
 │ │     │     ─── будь-що інше ──► 500 (без стеку назовні)  │ │
 │ │     ▼                                                   │ │
 │ │   Interceptor  after: log `GET /users/1 — 12.3 ms`      │ │
 │ │     │                                                   │ │
 │ └─────┼───────────────────────────────────────────────────┘ │
 └───────┼─────────────────────────────────────────────────────┘
         ▼
   HTTP response + X-Request-Id: <той самий id>
```

Порядок, який фіксує тест `test/lifecycle-order.test.ts`:

`middleware → guard → interceptor:before → pipe → handler → interceptor:after`

Guard і interceptor відрізняються місцем у цьому ланцюгу і тим, що можуть повернути. Guard відповідає «пускати чи ні» _до_ валідації й обробника і не формує відповідь сам: `false` → `ForbiddenError` → `403` (тест доводить, що при `403` pipe навіть не викликався). Interceptor обгортає виклик: код до `next()`, виклик, код після — і бачить і вхід, і вихід (наприклад, тривалість `GET /users/1 — 12.3 ms`). Pipe трансформує/валідує аргумент безпосередньо перед handler (тут — Zod 4, `src/pipes/zod-validation.pipe.ts`). Filter — останній: мапить доменні помилки в HTTP, а неочікувану помилку логує на сервері й віддає назовні тільки `{"message":"Internal Server Error"}`.

Мапінг помилок (`src/filters/exception.filter.ts`):

| Помилка           | Відповідь                                                   |
| ----------------- | ----------------------------------------------------------- |
| `ValidationError` | `400` `{ "message": "Validation failed", "errors": [...] }` |
| `BadRequestError` | `400` `{ "message": "Invalid JSON body" }`                  |
| `ForbiddenError`  | `403` `{ "message": "Forbidden" }`                          |
| `NotFoundError`   | `404` `{ "message": "User not found" }`                     |
| будь-що інше      | `500` `{ "message": "Internal Server Error" }`              |

Диспетчер має два рівні `try/catch`: внутрішній — усередині ланцюга middleware, щоб filter бачив контекст запиту; зовнішній — страховка на випадок, коли впало саме middleware.

## Де що лежить

| Файл                                      | Призначення                                 |
| ----------------------------------------- | ------------------------------------------- |
| `src/dispatcher.ts`                       | сам ланцюг: middleware → guard → … → filter |
| `src/middleware/middleware.ts`            | `X-Request-Id` і вхід в ALS                 |
| `src/guards/auth.guard.ts`                | перевірка `Authorization`                   |
| `src/interceptors/logging.interceptor.ts` | вимірювання тривалості                      |
| `src/pipes/zod-validation.pipe.ts`        | валідація на Zod 4 (`error.issues`)         |
| `src/filters/exception.filter.ts`         | мапінг помилок у HTTP                       |
| `src/context/request-context.ts`          | обгортка над `AsyncLocalStorage`            |
| `test/lifecycle-order.test.ts`            | тест на точний порядок шести етапів         |

Зовнішніх залежностей у рантаймі рівно дві: `reflect-metadata` і `zod`. Ніяких `@nestjs/*`, `express` чи `fastify`.

## Чому AsyncLocalStorage, а не глобальна змінна

`requestId` потрібен глибоко в стеку — сервісу, репозиторію, логеру — без протягування параметром через кожну функцію. Глобальна змінна на це не годиться: поки один запит чекає на `await`, event loop встигає взяти наступний і перезаписати глобал. До моменту логування там уже чужий id: відповідь клієнта A отримує ідентифікатор клієнта B.

`AsyncLocalStorage` тримає сховище прив’язаним до ланцюга промисів конкретного запиту. `als.run(store, callback)` має обгортати _весь_ обробник (у нас це middleware на вході): інакше глибокі виклики після `await` сховища не побачать. На вході беремо id із `X-Request-Id` або генеруємо UUID, кладемо в ALS і той самий id віддаємо клієнту в заголовку відповіді. Десять паралельних запитів не змішують контексти, бо в кожного свій store — це фіксує окремий тест.

Контекст накриває й exception filter, тому серверний лог неочікуваної помилки має вигляд `[<requestId>] Unhandled error …`: за id з відповіді клієнта можна знайти справжню причину `500`, якої в тілі відповіді немає. `UserRepository` — два рівні глибше обробника (`controller → service → repository`) — читає id тим самим `getRequestId()`, без жодного параметра в сигнатурі.

## Як це працює (IoC)

TypeScript зі прапорцями `experimentalDecorators` і `emitDecoratorMetadata` під час компіляції записує типи параметрів конструктора в метадані Reflect під ключем `design:paramtypes`. Це відбувається **лише якщо на класі є хоча б один декоратор** — саме тому потрібен `@Injectable()`: він не лише маркує клас для контейнера, а й «вмикає» емісію метаданих. Без `emitDecoratorMetadata` ключ `design:paramtypes` не з’являється, і контейнер не може сам побудувати граф залежностей. Інтерфейси в рантаймі стираються до `Object`, тому для них потрібен явний `@Inject(token)` (Symbol або рядок): контейнер читає токен з окремих метаданих і резолвить провайдер за ним, а не за типом з `design:paramtypes`.

`@Controller()` також ставить injectable-метадані, тож диспетчер створює контролер через той самий контейнер, що й сервіси.

## Як параметр-декоратор знає, куди підставити значення

`@Body()`, `@Param(name)` і `@Query(name)` самі нічого з запиту не читають. Сигнатура параметр-декоратора — `(target, propertyKey, parameterIndex)`: `parameterIndex` — це позиція аргумента в методі (0, 1, 2, …). Декоратор лише записує в метадані методу мапу `{ [index]: { type: 'body' | 'param' | 'query', name } }`.

Порядок виконання: спочатку параметр-декоратори, потім декоратор методу (`@Get` / `@Post`), потім класу (`@Controller`). Через це шлях і параметри вже лежать у Reflect, коли роутер обходить контролери.

Під час запиту диспетчер знаходить маршрут, читає цю мапу і збирає масив аргументів за індексами: `param` — з сегментів URL (`:id`), `query` — з query-string, `body` — з JSON-тіла після Zod pipe (`schema.parse`). Потім викликає метод інстанса контролера, який дав контейнер. Саме тому обробник пише `findOne(@Param('id') id: string)` і не чіпає `req`.
