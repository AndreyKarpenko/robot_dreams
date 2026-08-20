# mini-nest (part 3 — request lifecycle)

Власний IoC-контейнер і HTTP-шар поверх `node:http` з повним життєвим циклом запиту:
middleware → guard → interceptor → pipe → handler → exception filter, з `AsyncLocalStorage`
для request-id. Без `@nestjs/*`, без `express`, без `fastify`.

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
curl -i http://localhost:3000/users/42                      # 200 + заголовок X-Request-Id
curl -i -H 'X-Request-Id: my-own-id' http://localhost:3000/users/42
curl 'http://localhost:3000/users?limit=5'
curl -i http://localhost:3000/users/777                     # 404 з доменної помилки
curl -i -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com"}'                         # 403: немає Authorization
curl -X POST http://localhost:3000/users \
  -H 'Authorization: Bearer token-123' \
  -H 'Content-Type: application/json' \
  -d '{"email":"not-an-email"}'                             # 400 зі списком полів
```

## Життєвий цикл запиту

```
                       ┌──────────────────────── AsyncLocalStorage scope ────────────────────────┐
                       │                    { requestId } — видно на будь-якій глибині           │
                       │                                                                          │
 HTTP request ─────────┼──► middleware ──► router.match ──► guard ──► interceptor (before)        │
                       │    (X-Request-Id                   true/false        │                   │
                       │     у відповідь)                   false → 403       ▼                   │
                       │                                                    pipe (Zod)            │
                       │                                                      │                   │
                       │                                                      ▼                   │
                       │                                                   handler                │
                       │                                                      │ UserService       │
                       │                                                      │   └─ UserRepository
                       │                                                      │        └─ Logger  │
                       │                                                      ▼                   │
                       │                                            interceptor (after)           │
                       │                                            "GET /users/42 — 0.7 ms"      │
                       │                                                      │                   │
                       └──────────────────────────────────────────────────────┼───────────────────┘
                                                                              ▼
                                                                      HTTP response

     будь-яке throw з будь-якого етапу ──► exception filter (try/catch на найвищому рівні)
       ValidationError → 400 + issues[]      NotFoundError → 404 + повідомлення
       ForbiddenError  → 403                 будь-що інше  → 500 без деталей і стек-трейсу
```

Хто за що відповідає:

| Етап             | Файл                                      | Що може                                                                   |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| Middleware       | `src/middleware/request-id.middleware.ts` | бачить сирі `req`/`res` ще до роутінгу, вирішує, чи звати `next()`        |
| Guard            | `src/guards/auth.guard.ts`                | лише «пускати чи ні» (`boolean`); `false` → 403, обробник не викликається |
| Interceptor      | `src/interceptors/logging.interceptor.ts` | обгортає виклик: бачить і вхід, і вихід, може змінити результат           |
| Pipe             | `src/pipes/zod-validation.pipe.ts`        | трансформує/валідує один аргумент безпосередньо перед обробником          |
| Exception filter | `src/filters/exception.filter.ts`         | останній у ланцюгу: перетворює будь-яку помилку на HTTP-відповідь         |
| Контекст запиту  | `src/context/request-context.ts`          | `AsyncLocalStorage` зі `{ requestId }` навколо всього циклу               |

Порядок задається в одному місці — `Dispatcher.runLifecycle` (`src/dispatcher.ts`) — і зафіксований
тестом `test/lifecycle-order.test.ts`, який порівнює зібраний масив міток із очікуваною
послідовністю з шести етапів.

### Guard проти interceptor одним реченням

Guard відповідає «пускати чи ні» до всього іншого і не може змінити відповідь; interceptor обгортає
виклик обробника й бачить і вхід, і вихід. Різниця не в природі об'єктів, а в місці виклику в цьому
циклі й у тому, що кожен повертає.

### Глобальні й локальні етапи

Middleware та interceptor реєструються глобально в `createApp()`, guard'и та pipe'и — там, де
потрібні:

```ts
@Controller('users')
export class UserController {
    @Post()
    @UseGuards(AuthGuard)
    create(@Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto) {
        return this.userService.create(dto);
    }
}
```

`@UseGuards` — це просто масив у метаданих, який диспетчер читає перед викликом обробника; так само
`@UseInterceptors`. Це те саме, що робить справжній Nest, лише без магії.

## Чому AsyncLocalStorage, а не глобальна змінна

Спокуса очевидна: записати `currentRequestId` у модульну змінну на початку обробки й читати звідусіль.
Це працює рівно доти, доки в процесі один запит. Node виконує JS в одному потоці, але **не** одну
задачу від початку до кінця: щойно обробник доходить до `await` (читання тіла, запит у базу, HTTP-виклик),
event loop бере наступний запит із черги — і той перезаписує глобал своїм id. Коли перший запит
прокидається після `await` і логує, він друкує вже чужий id. Це та сама помилка, що на Лекції 2, і
вона не відтворюється під час ручного тестування: щоб її побачити, потрібні паралельні запити
(див. тест «does not mix contexts across 10 concurrent requests»).

`AsyncLocalStorage` вирішує це на рівні рантайму: сховище прив'язане не до модуля, а до
асинхронного контексту виконання. Диспетчер один раз відкриває скоуп —
`requestContext.run({ requestId }, () => this.runLifecycle(req, res))` — і будь-який код, що
запустився всередині цього колбека, включно з продовженнями після `await`, бачить свій і тільки свій
store. Тому `LoggerService` і `UserRepository` (два рівні під обробником) дістають `requestId` без
жодного параметра в сигнатурі:

```ts
log(message: string): void {
    const requestId = requestContext.getRequestId() ?? 'no-request-id';
    this.sink(`[${requestId}] ${message}`);
}
```

Два наслідки для дизайну: по-перше, `als.run(...)` має обгортати **весь** обробник запиту, а не лише
виклик контролера — інакше exception filter опиниться поза скоупом і не зможе покласти `requestId` у
тіло помилки. По-друге, id генерується (або береться з заголовка `X-Request-Id`) до відкриття скоупу,
а middleware лише повертає його клієнту у заголовку відповіді.

## Валідація на Zod 4

DTO — це схема, а не клас: `src/dto/create-user.dto.ts` експортує `createUserSchema` і
`type CreateUserDto = z.infer<typeof createUserSchema>`. Pipe робить `schema.safeParse(value)` і на
помилці кидає `ValidationError` зі списком полів. Zod 4 віддає проблеми в `error.issues` (у Zod 3 це
було `error.errors`), кожна з `path` — саме з нього збирається `field`:

```json
{
    "statusCode": 400,
    "error": "Bad Request",
    "message": "Validation failed for body",
    "issues": [
        {
            "field": "email",
            "message": "email must be a valid email address",
            "code": "invalid_format"
        }
    ],
    "requestId": "…"
}
```

Незадекларовані поля Zod відкидає за замовчуванням, тому в обробник приходить рівно те, що описано
схемою.

## Як це працює (IoC)

TypeScript зі прапорцями `experimentalDecorators` і `emitDecoratorMetadata` під час компіляції записує типи параметрів конструктора в метадані Reflect під ключем `design:paramtypes`. Це відбувається **лише якщо на класі є хоча б один декоратор** — саме тому потрібен `@Injectable()`: він не лише маркує клас для контейнера, а й «вмикає» емісію метаданих. Без `emitDecoratorMetadata` ключ `design:paramtypes` не з'являється, і контейнер не може сам побудувати граф залежностей. Інтерфейси в рантаймі стираються до `Object`, тому для них потрібен явний `@Inject(token)` (Symbol або рядок): контейнер читає токен з окремих метаданих і резолвить провайдер за ним, а не за типом з `design:paramtypes`.

`@Controller()` також ставить injectable-метадані, тож диспетчер створює контролер через той самий контейнер, що й сервіси. Guard'и, interceptor'и та exception filter резолвляться так само — тому `AuthGuard` може попросити собі `AuthService`, а `LoggerService` отримує sink через value-провайдер (`container.registerValue(LOG_SINK, …)`, аналог `useValue` у Nest). Завдяки цьому тести підміняють вивід логів масивом рядків, не чіпаючи `console`.

## Як параметр-декоратор знає, куди підставити значення

`@Body()`, `@Param(name)` і `@Query(name)` самі нічого з запиту не читають. Сигнатура параметр-декоратора — `(target, propertyKey, parameterIndex)`: `parameterIndex` — це позиція аргумента в методі (0, 1, 2, …). Декоратор лише записує в метадані методу мапу `{ [index]: { type: 'body' | 'param' | 'query', name, pipes } }`.

Порядок виконання: спочатку параметр-декоратори, потім декоратор методу (`@Get` / `@Post`), потім класу (`@Controller`). Через це шлях і параметри вже лежать у Reflect, коли роутер обходить контролери.

Під час запиту диспетчер знаходить маршрут, читає цю мапу і збирає масив аргументів за індексами: `param` — з сегментів URL (`:id`), `query` — з query-string, `body` — з JSON-тіла. Кожне значення проходить через свої pipe'и (`@Body(new ZodValidationPipe(schema))`) і лише потім потрапляє в метод інстанса контролера. Саме тому обробник пише `findOne(@Param('id') id: string)` і не чіпає `req`.

## Тести

```
test/container.test.ts           IoC: граф, скоупи, токени, цикли
test/http.test.ts                роутінг, параметр-декоратори, DTO
test/lifecycle-order.test.ts     точний порядок шести етапів + guard блокує обробник
test/logging-interceptor.test.ts вимірювання тривалості
test/exception-filter.test.ts    404 / 400 / 500 без стек-трейсу
test/request-context.test.ts     ALS: глибокий доступ, X-Request-Id, 10 паралельних запитів
```
