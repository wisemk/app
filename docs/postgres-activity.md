# Postgres activity tracking

고객별 푸시 토큰, 앱 오픈 기록, 발송 이력을 쌓으려면 `DATABASE_URL`을 붙여야 합니다.

## 필요한 환경변수

- `EXPO_PUBLIC_APP_API_BASE_URL`
- `DATABASE_URL`
- `DATABASE_SSL`
- `DATABASE_SSL_REJECT_UNAUTHORIZED`
- `APP_OPEN_RETENTION_DAYS`

`EXPO_PUBLIC_APP_API_BASE_URL`은 앱이 `POST /api/device/register`, `POST /api/app-open`로 접근할 서버 기준 URL입니다.

## 스키마 적용

Postgres를 만든 뒤 아래 한 번 실행하면 됩니다.

```bash
npm run db:init
```

스키마 파일 위치:

- [schema.sql](D:\Alln 관리\파이썬\소액뱅크 어플\soaek-bank-app\server\db\schema.sql)

## 현재 추가된 API

- `POST /api/device/register`
- `POST /api/app-open`
- `GET /api/push/campaigns`
- `POST /api/push/campaigns`

## 현재 추가된 테이블

- `customers`
- `devices`
- `app_opens`
- `push_campaigns`
- `push_deliveries`

## 주의

`DATABASE_URL`이 없으면 서버는 메모리 저장소로 동작합니다. 이 경우 앱 등록/오픈 기록은 테스트는 되지만 서버 재시작 후 유지되지 않습니다.
