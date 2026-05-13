# likeObsidian

VSCode内からObsidian互換Vaultを扱うための拡張機能です。

## MVP機能

- Activity BarのObsidianビューにVault Explorerを表示
- フォルダ階層とMarkdownファイルのlazy load
- VSCode native editorでMarkdownを開く
- Obsidian設定の読込
  - `.obsidian/daily-notes.json`
  - `.obsidian/templates.json`
- 新規ノート作成
- Daily Note作成
- テンプレート変数展開
  - `{{date}}`
  - `{{time}}`
  - `{{title}}`
- 外部変更検知によるExplorer更新
- AI向けCommand API
  - `obsidianVault.listNotes`
  - `obsidianVault.readNote`
  - `obsidianVault.search`
- MCP stdio server
  - `list_notes`
  - `read_note`
  - `get_note_metadata`
  - `search_notes`
  - `create_note`

## 設定

```json
{
  "obsidianVault.path": "/path/to/vault",
  "obsidianVault.defaultFolder": "Notes",
  "obsidianVault.ai.allowedFolders": ["Daily", "Projects"],
  "obsidianVault.ai.deniedFolders": ["Secrets", "Private"]
}
```

`obsidianVault.path` が空の場合は、最初のworkspace folderをVaultとして扱います。

## コマンド

- `Obsidian: Open Vault`
- `Obsidian: Create Note`
- `Obsidian: Create Daily Note`
- `Obsidian: Refresh Vault`

## 開発

```sh
npm install
npm run compile
npm test
```

## MCP Server

ビルド後、stdio MCPサーバとして起動できます。

```sh
npm run compile
npx like-obsidian-mcp --vault /path/to/vault
```

環境変数でもVaultとAIアクセス範囲を指定できます。

```sh
OBSIDIAN_VAULT_PATH=/path/to/vault \
OBSIDIAN_VAULT_AI_ALLOWED_FOLDERS=Daily,Projects,Templates \
OBSIDIAN_VAULT_AI_DENIED_FOLDERS=Secrets,Private \
npx like-obsidian-mcp
```

`allowedFolders` を指定した場合、テンプレートファイルを使う `create_note` ではテンプレート配置フォルダも許可対象に含めてください。
