# Raw HTTP/TLS server

Навчальний HTTP/1.1-сервер без модулів `http` та `https`: запит читається як
байти TCP-сокета, а відповідь формується вручну.

## Запуск

У двох окремих терміналах:

```sh
node src/server.mjs
node src/https-server.mjs
```

Plain HTTP працює на `http://localhost:3000`, HTTPS — на
`https://localhost:3443`.

Маршрути:

```sh
curl -sv http://localhost:3000/
curl -s http://localhost:3000/headers -H "X-Demo: abc"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/nope
```

## Self-signed сертифікат

Перед запуском HTTPS один раз створіть сертифікат і ключ:

```sh
mkdir -p cert
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout cert/server.key -out cert/server.pem -days 365 \
  -subj "/CN=localhost"
```

Перевірка HTTPS без довіри до self-signed сертифіката:

```sh
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:3443/
```

## Debug-сесія

Команда:

```sh
openssl s_client -connect localhost:3443 -servername localhost
```

Скорочений приклад виводу:

```text
verify error:num=18:self-signed certificate
Verify return code: 18 (self-signed certificate)
```

Код помилки 18 означає, що сертифікат самопідписаний і не підтверджений довіреним центром сертифікації.
