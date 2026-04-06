# 소액뱅크 앱 MVP

갤럭시(안드로이드) 고객이 다시 쉽게 찾아오도록 만드는 `상세 이미지 + 상담 진입 + 리마인드 알림` 중심 앱입니다.

이번 버전에는 아래 3가지가 같이 들어 있습니다.

- Expo 앱
- 원격 콘텐츠 JSON 로더
- 브라우저용 콘텐츠 관리자 페이지 + 간단한 Node 서버

## 구조

앱은 실행 시 이 순서로 콘텐츠를 읽습니다.

1. 저장된 캐시
2. 서버 JSON
3. 기본 내장 콘텐츠

그래서 관리 페이지에서 저장하면 앱 업데이트 없이 새 내용이 바로 반영됩니다.

## 바로 실행하는 순서

### 1. 환경변수 준비

[.env.example](D:\Alln 관리\파이썬\소액뱅크 어플\soaek-bank-app\.env.example)를 참고해서 `.env`를 만듭니다.

중요한 값:

- `EXPO_PUBLIC_REMOTE_CONTENT_URL`
- `CONTENT_SERVER_ADMIN_USER`
- `CONTENT_SERVER_ADMIN_PASSWORD`
- `CONTENT_SERVER_ALLOWED_ORIGINS`

핸드폰에서 앱을 볼 때는 `localhost`가 아니라 **서버 PC의 내부 IP**를 넣어야 합니다.

예시:

```env
EXPO_PUBLIC_REMOTE_CONTENT_URL=http://192.168.0.10:4000/api/content
CONTENT_SERVER_PORT=4000
CONTENT_SERVER_ADMIN_USER=admin
CONTENT_SERVER_ADMIN_PASSWORD=strong-password
CONTENT_SERVER_ALLOWED_ORIGINS=http://localhost:8081,http://localhost:19006,http://localhost:3000
```

### 2. 콘텐츠 서버 실행

```bash
npm install
npm run server
```

기본 주소:

- API: `http://localhost:4000/api/content`
- 관리자: `http://localhost:4000/admin`

관리자 페이지는 브라우저 기본 인증으로 보호됩니다.

### 3. 앱 실행

```bash
npm start
```

또는 웹 미리보기:

```bash
npm run web
```

## 수정하는 위치

### 앱이 읽는 실제 운영 파일

[app-content.json](D:\Alln 관리\파이썬\소액뱅크 어플\soaek-bank-app\content\app-content.json)

### JSON 예시 파일

[app-content.sample.json](D:\Alln 관리\파이썬\소액뱅크 어플\soaek-bank-app\content\app-content.sample.json)

### 앱 원격 주소 설정

[appConfig.ts](D:\Alln 관리\파이썬\소액뱅크 어플\soaek-bank-app\src\config\appConfig.ts)

### 서버 코드

[index.ts](D:\Alln 관리\파이썬\소액뱅크 어플\soaek-bank-app\server\index.ts)

### 관리자 화면

[admin.html](D:\Alln 관리\파이썬\소액뱅크 어플\soaek-bank-app\server\public\admin.html)

## 즉시 반영되는 것

- 상세 이미지 URL
- 브랜드명
- 운영시간
- 전화번호
- 상담 링크
- 메인 문구
- 공지성/설명성 텍스트
- 월말/월초 알림 문구 예시

## 여전히 앱 업데이트가 필요한 것

- 화면 구조 변경
- 새 기능 추가
- ChannelTalk 네이티브 SDK 연동 방식 변경
- 권한 처리 로직 변경

## 보안 주의

- 현재 관리자 페이지는 **기본 인증 + 비밀번호** 방식입니다.
- HTTP 평문으로 외부에 열면 비밀번호가 보호되지 않습니다.
- 운영 공개 전에는 반드시 **HTTPS**를 붙여야 합니다.
- 기본 비밀번호 `change-me` 상태로 쓰면 안 됩니다.

## 실제 운영 확장 포인트

### 1. 채널톡

현재는 서버에서 받은 URL을 여는 구조입니다.

실제 앱 안 채팅으로 붙이려면:

1. `expo prebuild` 또는 bare React Native 환경으로 전환
2. `react-native-channel-plugin` 적용
3. 고객 식별값(user id, name, phone)을 상담 SDK에 전달

### 2. 푸시 알림

현재는 권한 확인과 Expo 푸시 토큰 발급 시도까지 들어 있습니다.

실제 월말/월초 알림 운영에는 아래가 더 필요합니다.

1. 앱에서 발급한 푸시 토큰 저장
2. 토큰을 관리할 서버 또는 관리자 도구
3. 월말/월초 캠페인 스케줄링
4. 발송/오픈/재방문 추적

## 확인된 제한 사항

- 현재 작업 PC에는 Android SDK / adb / sdkmanager 가 잡혀 있지 않아 네이티브 빌드까지는 검증하지 못했습니다.
- 이번 작업은 `앱 골격 + 원격 콘텐츠 구조 + 캐시/새로고침 + 콘텐츠 서버 + 관리자 페이지`까지 완료한 상태입니다.

## Render 배포

현재 구조는 관리자 수정 내용을 JSON 파일에 저장하므로, **디스크가 유지되는 서버**가 필요합니다. 이 구조에는 Vercel/Netlify 같은 서버리스보다 Render Web Service가 더 맞습니다.

이번 저장소에는 Render용 블루프린트 파일 [render.yaml](D:\Alln 관리\파이썬\소액뱅크 어플\soaek-bank-app\render.yaml)을 추가했습니다.

### Render에서 필요한 값

- 서비스 타입: Web Service
- 런타임: Node
- 리전: `singapore`
- 헬스체크: `/health`
- 디스크 마운트: `/var/data`
- 콘텐츠 파일 경로: `CONTENT_FILE_PATH=/var/data/app-content.json`

### 배포 순서

1. 이 프로젝트를 GitHub, GitLab, Bitbucket 중 하나에 push합니다.
2. Render에서 새 Blueprint 또는 Web Service를 만듭니다.
3. 관리자 비밀번호를 `CONTENT_SERVER_ADMIN_PASSWORD`에 넣습니다.
4. 필요하면 `CONTENT_SERVER_ADMIN_USER`를 바꿉니다.
5. Render 서비스 URL이 정해지면 앱의 `EXPO_PUBLIC_REMOTE_CONTENT_URL`을 `https://서비스주소.onrender.com/api/content`로 바꿉니다.
6. 앱은 다시 빌드하거나 EAS Update를 통해 새 URL을 배포합니다.

`NODE_ENV=production` 상태에서 `CONTENT_SERVER_ADMIN_PASSWORD`를 비워두면 서버가 시작되지 않도록 막아두었습니다.

### 운영 전에 알아둘 점

- Render 공식 문서 기준으로 **persistent disk가 붙은 서비스는 여러 인스턴스로 수평 확장할 수 없습니다**.
- 디스크 크기는 나중에 늘릴 수는 있지만 줄일 수는 없습니다.
- 이 구조는 파일 저장 기반이라서, 장기적으로는 Postgres/S3 같은 외부 저장소로 옮기는 편이 더 안정적입니다.

실제 클라우드 배포는 아직 이 로컬 저장소가 Git 원격 저장소에 올라가 있지 않아서 여기서 바로 끝까지 밀 수는 없습니다. 코드 push가 끝나면 Render 연결만 이어서 하면 됩니다.
