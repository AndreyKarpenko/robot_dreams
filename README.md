# robot_dreams

Express + PostgreSQL API у Docker (multi-stage образ).

## Запуск

1. Переконайтесь, що в корені є файл `.env` (приклад змінних нижче).
2. Підніміть сервіси:

```bash
docker compose up --build
```

API: `http://localhost:3000`  
Healthcheck: `GET /health`  
Користувачі: `GET /users`

Зупинка з видаленням volume БД:

```bash
docker compose down -v
```

### Змінні оточення (`.env`)

```env
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=user
POSTGRES_PASSWORD=123456
POSTGRES_DB=robot_dream
API_PORT=3000
```

## Розмір Docker-образу

Порівняння зібрано командою `docker images` (база `node:24-slim`):

| Образ | Як зібрано | Розмір (`docker images`) |
| --- | --- | --- |
| multi-stage (фінальний) | поточний `Dockerfile` (builder + runner) | **377MB** |
| single-stage («в лоб») | одна стадія: `npm ci` + build + runtime в одному шарі | **446MB** |

Multi-stage менший, бо у фінальний образ потрапляють лише production-залежності (`npm ci --omit=dev`) і скомпільований `dist`, без TypeScript/devDependencies і зайвих артефактів збірки.
