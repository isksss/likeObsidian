import * as vscode from 'vscode';

export type Vault = {
  path: string;
  name: string;
};

export type Note = {
  path: string;
  title: string;
  tags: string[];
  links: string[];
  modifiedAt: number;
};

export type ObsidianDailyNotesConfig = {
  folder: string;
  format: string;
  template?: string;
};

export type ObsidianTemplatesConfig = {
  folder: string;
};

export type VaultEntry = {
  uri: vscode.Uri;
  name: string;
  relativePath: string;
  type: vscode.FileType;
};
