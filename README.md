# vscode-runbook

A Visual Studio Code extension for interactive shell notebooks (.shbn), based on the runbook TUI application.

## quick install

```bash
curl -fsSL https://raw.githubusercontent.com/GerhardOfRivia/vscode-runbook/refs/heads/main/install.sh | sh
```

## install

```sh
code --install-extension vscode-runbook-*.vsix
```

Open a `.shbn` or `.psbn` file in VS Code and you should see the interactive runbook editor.

![demo](./demo.gif)

## development

```bash
# install dependencies
npm install

# run tests
npm test

# build the extension
npm run vsce-package

# install the extension
code --install-extension vscode-runbook-*.vsix
```
