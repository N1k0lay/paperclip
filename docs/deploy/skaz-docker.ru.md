# Сказ в закрытой сети

Комплект рассчитан на Linux amd64 с Docker Engine и Docker Compose. Образ содержит сервер, интерфейс и среду Pi. При запуске не нужны Node.js, npm, Rust и доступ к реестрам пакетов. Другие архитектуры пока не проверены.

Основной `compose.skaz.yml` запускает Сказ и подключается к существующей PostgreSQL 16. Файлы хранятся в постоянном томе Docker. Существующий MinIO можно подключить отдельно. Для проверки без готовой базы есть `compose.skaz.postgres.yml` с PostgreSQL 16.

## 1. Перенос комплекта

Перенесите весь каталог комплекта на сервер. В нём должны находиться `images.tar.gz`, `SHA256SUMS`, оба Compose-файла и `skaz.env.example`. Выполняйте команды из этого каталога.

```sh
sha256sum -c SHA256SUMS
docker load -i images.tar.gz
cp skaz.env.example skaz.env
chmod 600 skaz.env
```

Compose использует только уже загруженные образы с `pull_policy: never`. Если нужного тега нет, запуск завершится ошибкой.

## 2. Адрес и постоянные секреты

Откройте `skaz.env`. Задайте `PAPERCLIP_PUBLIC_URL` равным адресу, который пользователи вводят в браузере, например `https://skaz.company.internal`. По умолчанию опубликован только `127.0.0.1:3100`, что подходит для обратного прокси на том же сервере. Для прямого доступа из внутренней сети задайте `SKAZ_BIND_IP` равным внутреннему IP сервера и укажите соответствующий адрес в `PAPERCLIP_PUBLIC_URL`.

Сгенерируйте три разных значения:

```sh
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Запишите их в `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET` и `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET`. Сохраняйте эти значения при обновлениях и перезапусках. Вход пользователей обязателен. Дополнительные внутренние DNS-имена можно перечислить через запятую в `PAPERCLIP_ALLOWED_HOSTNAMES`.

## 3. Существующая PostgreSQL 16

Создайте отдельную базу и пользователя для Сказа, затем задайте строку подключения:

```dotenv
DATABASE_URL=postgresql://skaz:encoded-password@postgres.company.internal:5432/skaz
```

Адрес базы должен быть доступен из контейнера. `localhost` внутри контейнера обозначает сам контейнер. Специальные символы пароля в URI нужно кодировать для URL.

Таблицы создаются в схеме `public`. При запуске автоматически применяются миграции; для них нужны права на создание таблиц и расширений `pg_trgm` и `fuzzystrmatch`. Если права приложения ограничены, задайте отдельный `DATABASE_MIGRATION_URL` для миграций. Для PostgreSQL с обязательным TLS добавьте параметры подключения, принятые в вашей инфраструктуре.

```sh
docker compose --env-file skaz.env -f compose.skaz.yml config --quiet
docker compose --env-file skaz.env -f compose.skaz.yml up -d --no-build --pull never
docker compose --env-file skaz.env -f compose.skaz.yml ps
```

Пустой `DATABASE_URL` блокирует запуск основного варианта. Встроенная база автоматически не создаётся.

Если PostgreSQL или MinIO работают в другом Docker-проекте без опубликованного порта, подключите Сказ к их существующей сети. Например, сохраните следующий файл как `compose.network.yml`, заменив имя сети:

```yaml
services:
  skaz:
    networks: [default, infrastructure]
networks:
  infrastructure:
    external: true
    name: existing-infrastructure
```

Добавляйте `-f compose.network.yml` к каждой команде Compose. Тогда в адресе базы или MinIO можно использовать их сетевые имена.

## 4. Подключение модели

Откройте адрес из `PAPERCLIP_PUBLIC_URL`. На экране первой настройки нажмите «Войти / Создать аккаунт» и зарегистрируйте пользователя с паролем не короче восьми символов. Подтверждение почты не требуется. Затем нажмите «Стать администратором». Откроется создание первой организации; одноразовое приглашение и запуск CLI для этого режима не нужны.

В начальной настройке укажите URL вашего OpenAI-совместимого API, идентификатор модели и ключ, если сервер требует авторизацию.

Пример адреса: `http://models.company.internal:8080/v1`. Для модели можно указать `balabol` или полный идентификатор с `/`. Ключ сохраняется в зашифрованном хранилище Сказа. Не помещайте его в Compose или образ.

URL модели должен быть доступен из контейнера. Базовая Docker-сеть сохраняет доступ к внутренним адресам вашей инфраструктуры. Ограничения выхода в интернет задаются сетевыми правилами сервера или контура. Сеть `internal: true` без дополнительной маршрутизации закроет также доступ к внешней PostgreSQL и корпоративному API.

## 5. Существующий MinIO

По умолчанию загруженные файлы находятся в томе `skaz-data`. Для MinIO заранее создайте отдельный бакет и задайте в `skaz.env`:

```dotenv
PAPERCLIP_STORAGE_PROVIDER=s3
PAPERCLIP_STORAGE_S3_ENDPOINT=http://minio.company.internal:9000
PAPERCLIP_STORAGE_S3_BUCKET=skaz
PAPERCLIP_STORAGE_S3_REGION=us-east-1
PAPERCLIP_STORAGE_S3_FORCE_PATH_STYLE=true
PAPERCLIP_STORAGE_S3_PREFIX=skaz
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

Используйте учётные данные с доступом к выбранному бакету. Сказ не создаёт бакет сам. После изменения настроек повторите команду `up -d --no-build --pull never`. Смена хранилища не переносит ранее загруженные файлы автоматически.

## Отдельная PostgreSQL для проверки

Этот вариант нужен, если готовой базы нет. В `skaz.env` задайте `SKAZ_POSTGRES_PASSWORD` результатом `openssl rand -hex 32`. Комплект должен содержать также образ `postgres:16-alpine`. Overlay заменит `DATABASE_URL` адресом своей базы; порт PostgreSQL на сервер не публикуется.

```sh
docker compose --env-file skaz.env -f compose.skaz.yml -f compose.skaz.postgres.yml config --quiet
docker compose --env-file skaz.env -f compose.skaz.yml -f compose.skaz.postgres.yml up -d --no-build --pull never
docker compose --env-file skaz.env -f compose.skaz.yml -f compose.skaz.postgres.yml ps
```

При дальнейшей работе с этим вариантом указывайте оба `-f`. База сохраняется в отдельном томе `skaz-postgres`.

## Данные, обновление и диагностика

Том `skaz-data` содержит рабочие каталоги агентов, файлы при `local_disk`, настройки и ключ шифрования секретов. Он нужен даже при внешних PostgreSQL и MinIO. Для восстановления сохраняйте согласованный комплект: резервную копию PostgreSQL, содержимое `skaz-data`, `skaz.env` и данные бакета, если используется MinIO. Ключ `instances/default/secrets/master.key` необходим для чтения сохранённых ключей API.

Перед обновлением сделайте резервную копию. Затем загрузите новый архив образов и повторите прежнюю команду `up -d --no-build --pull never`, используя те же секреты и тома. Миграции выполняются при запуске; возврат на старую версию может требовать восстановления резервной копии базы.

```sh
docker compose --env-file skaz.env -f compose.skaz.yml logs --tail 100 skaz
docker compose --env-file skaz.env -f compose.skaz.yml exec skaz node -e "fetch('http://127.0.0.1:3100/api/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

Команда `down` сохраняет тома. Ключ `down -v` удаляет их, поэтому не используйте его для обычной остановки или обновления.
