# robot_dreams

Express + PostgreSQL API у Docker (multi-stage образ).

## Запуск

Підніміть сервіси однією командою (дефолтні змінні вже в `docker-compose.yml`, окремий `.env` не обов’язковий):

```bash
docker compose up -d --build
```

API: `http://localhost:3000`  
Healthcheck: `GET /health`  

Перевірка health:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
```

Зупинка (volume БД зберігається):

```bash
docker compose down
```

Зупинка з видаленням volume БД:

```bash
docker compose down -v
```

### Dev override

Файл `docker-compose.override.yml` підхоплюється автоматично: bind mount коду, `npm run start:dev` (hot-reload), порт назовні.

Для CI (без override):

```bash
docker compose -f docker-compose.yml up -d --build
```

### Змінні оточення (опційно)

Скопіюйте `.env.example` → `.env`, якщо потрібно перевизначити дефолти:

```env
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=user
POSTGRES_PASSWORD=123456
POSTGRES_DB=robot_dream
API_PORT=3000
```

## Persistence Postgres

Дані лежать у named volume `postgres_data` і переживають `docker compose down` (без `-v`). Перевірка:

```bash
# створити таблицю-маркер
docker compose exec postgres \
  psql -U user -d robot_dream -c "CREATE TABLE IF NOT EXISTS hw05_persist (id int); INSERT INTO hw05_persist VALUES (1);"

# перезапуск без -v
docker compose down
docker compose up -d

# таблиця на місці
docker compose exec postgres \
  psql -U user -d robot_dream -c "SELECT * FROM hw05_persist;"
```

Очікуваний результат другої команди `psql`: рядок з `id = 1`.

## Розмір Docker-образу

Порівняння зібрано командою `docker images` (база `node:24-slim`):

| Образ | Як зібрано | Розмір (`docker images`) |
| --- | --- | --- |
| multi-stage (фінальний) | поточний `Dockerfile` (builder + runner) | **377MB** |
| single-stage («в лоб») | одна стадія: `npm ci` + build + runtime в одному шарі | **446MB** |

Multi-stage менший, бо у фінальний образ потрапляють лише production-залежності (`npm ci --omit=dev`) і скомпільований `dist`, без TypeScript/devDependencies і зайвих артефактів збірки.
