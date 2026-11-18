# @beautyspa/api-client

Typed client for the BeautySpa API. No DOM or Node types: you inject `fetch`.

- `baseUrl` is the API origin (e.g. `http://localhost:3001`); the client adds `/v1`.
  `request({ path })` takes the path after `/v1` (e.g. `/me`).
- Web: `transport: "cookie"`, `createCookieTokenStore()`, `fetch: window.fetch.bind(window)`.
  The refresh token stays in an httpOnly cookie; refresh/logout send `x-beautyspa-csrf: 1`.
- Native: `transport: "body"`, a `TokenStore` backed by secure storage (or `MemoryTokenStore`).
  Token-issuing calls send `x-token-transport: body`.
- A 401 on an authed call triggers one shared refresh and one retry; if refresh fails the
  store is cleared, `onSessionExpired` fires once and the original `ApiError` is thrown.
- Errors are `ApiError` with a contracts `Problem` (`err.problem.code`).
