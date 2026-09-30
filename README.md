# DSH Office Boost

An independent DeepSeek Harness (Cordis) profile bundle for office work. It adds office model controls, Word/Excel/PowerPoint/PDF workflows, PPT Master, quota and plan views, and automatic compaction at 50% of the model context window. Its plans and reward cards belong to this bundle, not to DeepSeek or any model provider.

## Install in DSH Desktop

Tested with DSH Desktop `0.2.0-rc.2` on Windows x64. In the desktop app, open **Plugins → Add plugin**, enter:

```text
github:Zhouenze130923/dsh-office-boost
```

Install the bundle, then fully quit and restart DSH Desktop. A page refresh alone may keep the old client bundle. The plugin delegates model requests to the installed `deepseek-account` route, so that account must already be configured in DSH.

For a command-line Web profile, use:

```sh
dsh plugin --profile web add github:Zhouenze130923/dsh-office-boost
```

Then restart that profile. Other DSH versions and operating systems have not been verified. The bundled Python extension modules target Windows x64 and Python 3.12.

## What it adds

- Flash, Work and Pro Work office modes with a separate thinking control, including Ultra.
- The official DOCX, PPTX and XLSX skills already shipped with DSH, plus this bundle's PDF skill and PPT Master.
- An office workflow prompt that directs the agent to load the right skill, create real files, and check the result.
- A Token usage and plan settings page. The original DSH account component stays mounted for sign-in; its account-and-balance settings page is replaced.
- Five-hour and weekly quota windows, configurable plans and reward cards. Real upstream API costs stay in the local administrator ledger.
- Automatic compaction when context use reaches 50% (`cordis.patch.yml`).
- Visible Edge/Chrome browser tools for opening pages, reading text, clicking, typing, saving screenshots, and closing the window. The host needs a locally installed Edge or Chrome browser.

## Configuration

Edit `office-boost.config.json` to change plan allowances, prices, cost guards, and reward chances. The local administrator command is `node scripts/office-admin.mjs --help`. The plan upgrade page prepares an application for an administrator; it does not process payment or activate a plan by itself.

The Host stores quota data under the current user's `~/.dsh/storages/` directory. No account credentials or quota history are included in this repository.

## Verify

```sh
node --check lib/index.js
node --check lib/client.js
node --test test/quota.test.js
```

`vendor/ppt-master/` is PPT Master v6.6.0, distributed under its included MIT license. Large reference screenshots and optional sound templates are omitted from the GitHub package. The icon library is stored as `vendor/ppt-master/templates/icons.zip`; run `scripts/expand-ppt-icons.py --output <task-directory>` when a task needs those icons. `vendor/python/` contains the Windows Python extensions and HTTP libraries needed by the bundled PDF and PPT workflows; common authoring libraries come from DSH Desktop's Python runtime. Package metadata and license notices remain alongside the included dependencies.
