# Paperclip Design Gallery

## 目的
Paperclipエンジニアにモックアップ作成時の参照デザインを統一して渡すためのギャラリーです。

## 使い方
1. `assets/` に画像を追加
2. `refs.json` に1件追加（id/title/image/tags/note）
3. `index.html` を開いて確認
4. 指示テンプレをコピーしてエージェント依頼に貼り付け

## refs.json の例
```json
{
  "id": "REF-002",
  "title": "Dark card layout",
  "image": "./assets/dark-card.png",
  "tags": ["dark", "card", "minimal"],
  "note": "カード余白と角丸のバランスが好み"
}
```

## ルール
- idは `REF-XXX` 形式
- imageは `./assets/ファイル名` で指定
- tagsは3〜5個を目安
- noteは「何が良いか」を1文で書く
- モバイル余白ルール: 4の倍数グリッド、基本値は `8px / 16px`（padding / margin）

## 次アクション
少佐がキャプチャ画像を送ってくれたら、こちらで `assets/` と `refs.json` へ順次追加します。
