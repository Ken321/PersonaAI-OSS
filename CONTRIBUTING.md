# Contributing

## Development

```bash
npm install
npm run dev
```

フロントエンドは Vite、ローカル API は `server/index.js` です。

## Principles

- OSS 版は単一ユーザー・ローカル実行を前提にする
- 新しい永続化は `/.personaai/workspace.json` に集約する
- OpenAI API キーはサーバー側に保存しない
- 既存 UI の API パス互換をできるだけ維持する

## Before Opening A PR

- `npm run build` が通ること
- 認証を再導入しないこと
- ローカル完結前提を崩さないこと
- `/.personaai/` をコミットしないこと
