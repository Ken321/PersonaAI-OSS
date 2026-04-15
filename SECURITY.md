# Security Policy

## Supported Scope

このリポジトリはローカル実行向け OSS 版です。主に以下を保守対象とします。

- ローカル API サーバー
- ローカル保存 (`/.personaai/workspace.json`)
- OpenAI API キーの取り扱い

以下は原則として保守対象外です。

- ユーザー自身のローカル環境固有の問題
- OpenAI API や外部サイト側の障害

## Reporting A Vulnerability

セキュリティ上の問題を見つけた場合は、公開 Issue ではなく非公開で報告してください。

公開 Issue に書かないでほしいもの:

- API キー
- ローカルファイルの内容
- 再現に必要な機密情報
- 具体的な悪用手順

報告時にあると助かる情報:

- 影響範囲
- 再現手順
- 想定される被害
- 暫定回避策の有無

## Security Notes For Users

- OpenAI API キーはブラウザの `localStorage` に保存されます
- 共有PCでは利用後にキーを削除してください
- `/.personaai/` は Git にコミットしないでください
- スクレイピング対象サイトの内容はローカルに保持される場合があります
