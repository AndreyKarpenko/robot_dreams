# mini-nest (part 1 — IoC)

Власний IoC-контейнер у стилі NestJS: `@Injectable()`, резолв через `design:paramtypes`, `@Inject(token)`, скоупи `singleton` / `transient`, детекція циклів.

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

Локальний демо-запуск контейнера:

```bash
npm run start:dev
```

## Як це працює

TypeScript зі прапорцями `experimentalDecorators` і `emitDecoratorMetadata` під час компіляції записує типи параметрів конструктора в метадані Reflect під ключем `design:paramtypes`. Це відбувається **лише якщо на класі є хоча б один декоратор** — саме тому потрібен `@Injectable()`: він не лише маркує клас для контейнера, а й «вмикає» емісію метаданих. Без `emitDecoratorMetadata` ключ `design:paramtypes` не з’являється, і контейнер не може сам побудувати граф залежностей. Інтерфейси в рантаймі стираються до `Object`, тому для них потрібен явний `@Inject(token)` (Symbol або рядок): контейнер читає токен з окремих метаданих і резолвить провайдер за ним, а не за типом з `design:paramtypes`.
