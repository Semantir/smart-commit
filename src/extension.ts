import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { discoverRepos, getRecentCommitSubjects, getStagedDiff, getStagedNameStatus, getStatusSummary, hasStagedChanges } from './git';
import { preprocessDiff, PreprocessResult } from './preprocess';
import {
	readAnalytics,
	recordAccepted,
	recordDownloadTime,
	recordGeneration,
	recordLatency,
	recordRenderer,
	updateAnalytics,
} from './analytics';

const PANEL_VIEW_TYPE = 'smartCommit.panel';
const SIDEBAR_VIEW_ID = 'smartCommit.sidebar';

export function activate(context: vscode.ExtensionContext) {
	const openDisposable = vscode.commands.registerCommand('smart-commit.open', async () => {
		await SmartCommitPanel.createOrShow(context);
	});

	const sidebarProvider = new SmartCommitSidebarProvider(context);
	const sidebarDisposable = vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_ID, sidebarProvider, {
		webviewOptions: { retainContextWhenHidden: true },
	});

	context.subscriptions.push(openDisposable, sidebarDisposable, sidebarProvider);
}

export function deactivate() {}

class SmartCommitSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private controller: SmartCommitWebviewController | null = null;

	constructor(private readonly context: vscode.ExtensionContext) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
				vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules')),
			],
		};

		const controller = new SmartCommitWebviewController(webviewView.webview, this.context);
		this.controller = controller;
		controller.initialize();

		webviewView.onDidDispose(() => {
			if (this.controller === controller) {
				this.controller = null;
			}
			controller.dispose();
		});
	}

	dispose() {
		if (this.controller) {
			this.controller.dispose();
			this.controller = null;
		}
	}
}

class SmartCommitPanel {
	static currentPanel: SmartCommitPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly controller: SmartCommitWebviewController;
	private disposables: vscode.Disposable[] = [];

	static async createOrShow(context: vscode.ExtensionContext) {
		const column = vscode.window.activeTextEditor?.viewColumn;
		if (SmartCommitPanel.currentPanel) {
			SmartCommitPanel.currentPanel.panel.reveal(column);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			PANEL_VIEW_TYPE,
			'Smart Commit',
			column ?? vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.file(path.join(context.extensionPath, 'dist')),
					vscode.Uri.file(path.join(context.extensionPath, 'node_modules')),
				],
			}
		);

		SmartCommitPanel.currentPanel = new SmartCommitPanel(panel, context);
		SmartCommitPanel.currentPanel.initialize();
	}

	private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
		this.panel = panel;
		this.controller = new SmartCommitWebviewController(panel.webview, context);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	private initialize() {
		this.controller.initialize();
	}

	private dispose() {
		SmartCommitPanel.currentPanel = undefined;
		this.controller.dispose();
		while (this.disposables.length) {
			const disposable = this.disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}
}

class SmartCommitWebviewController {
	private readonly webview: vscode.Webview;
	private readonly context: vscode.ExtensionContext;
	private disposables: vscode.Disposable[] = [];
	private repoId: string | null = null;
	private repoRoot: string | null = null;
	private diffHash: string | null = null;
	private repoPoller: NodeJS.Timeout | null = null;
	private recentCommits: string[] = [];
	private recentCommitsRepoId: string | null = null;

	constructor(webview: vscode.Webview, context: vscode.ExtensionContext) {
		this.webview = webview;
		this.context = context;

		this.webview.onDidReceiveMessage(
			message => {
				switch (message.type) {
					case 'ready':
						void this.sendInitialState();
						return;
					case 'selectRepo':
						void this.selectRepo(message.repoId);
						return;
					case 'refreshDiff':
						void this.refreshDiff();
						return;
					case 'acceptCommit':
						void this.acceptCommit(message.message);
						return;
					case 'analytics':
						void this.recordAnalytics(message);
						return;
					default:
						return;
				}
			},
			null,
			this.disposables
		);
	}

	initialize() {
		this.webview.html = getHtmlForWebview(this.webview, this.context.extensionPath);
	}

	dispose() {
		if (this.repoPoller) {
			clearInterval(this.repoPoller);
			this.repoPoller = null;
		}
		while (this.disposables.length) {
			const disposable = this.disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	private async sendInitialState() {
		const repos = await discoverRepos();
		const defaultRepo = repos.find(repo => repo.hasStaged) ?? repos[0];
		await this.selectRepo(defaultRepo?.id ?? null, repos);
	}

	private async selectRepo(repoId: string | null, cachedRepos?: Awaited<ReturnType<typeof discoverRepos>>) {
		const repos = cachedRepos ?? (await discoverRepos());
		const repo = repoId ? repos.find(item => item.id === repoId) : repos.find(item => item.hasStaged);
		this.repoId = repo?.id ?? null;
		this.repoRoot = repo?.root ?? null;
		await this.ensureRecentCommits();
		await this.refreshDiff(repos);
		this.startRepoPoller();
	}

	private async refreshDiff(cachedRepos?: Awaited<ReturnType<typeof discoverRepos>>) {
		const repos = cachedRepos ?? (await discoverRepos());
		let diffResult: PreprocessResult | null = null;
		if (this.repoRoot) {
			const diff = await getStagedDiff(this.repoRoot);
			if (diff.trim().length > 0) {
				diffResult = await preprocessDiff(this.repoRoot, diff);
				this.diffHash = hashContent(diffResult.rawDiff);
			} else {
				this.diffHash = null;
			}
		}
		const analytics = await readAnalytics(this.context);
		const gitContext = await this.getGitContext();
		this.webview.postMessage({
			type: 'init',
			repos,
			selectedRepoId: this.repoId,
			diff: diffResult,
			analytics,
			settings: getSettings(),
			gitContext,
			lang: this.resolveLanguage(),
		});
	}

	private startRepoPoller() {
		if (this.repoPoller) {
			clearInterval(this.repoPoller);
		}
		this.repoPoller = setInterval(async () => {
			if (!this.repoRoot) {
				return;
			}
			const hasStaged = await hasStagedChanges(this.repoRoot);
			if (!hasStaged) {
				this.webview.postMessage({ type: 'diffEmpty' });
				this.diffHash = null;
				return;
			}
			const diff = await getStagedDiff(this.repoRoot);
			const hash = hashContent(diff);
			if (hash !== this.diffHash) {
				const diffResult = await preprocessDiff(this.repoRoot, diff);
				this.diffHash = hashContent(diffResult.rawDiff);
				const analytics = await readAnalytics(this.context);
				const gitContext = await this.getGitContext();
				this.webview.postMessage({
					type: 'diffUpdated',
					diff: diffResult,
					analytics,
					settings: getSettings(),
					gitContext,
					lang: this.resolveLanguage(),
				});
			}
		}, 2000);
	}

	private async acceptCommit(message: string) {
		if (!this.repoRoot) {
			this.webview.postMessage({ type: 'commitResult', ok: false, error: 'No repository selected.' });
			return;
		}
		if (!message || message.trim().length === 0) {
			this.webview.postMessage({ type: 'commitResult', ok: false, error: 'Commit message is empty.' });
			return;
		}
		try {
			await executeGitCommit(this.repoRoot, message.trim());
			await updateAnalytics(this.context, state => recordAccepted(state));
			this.webview.postMessage({ type: 'commitResult', ok: true });
			await this.refreshDiff();
		} catch (error) {
			this.webview.postMessage({
				type: 'commitResult',
				ok: false,
				error: error instanceof Error ? error.message : 'Commit failed.',
			});
		}
	}

	private async recordAnalytics(message: { event: string; value?: number; renderer?: string }) {
		switch (message.event) {
			case 'generation':
				await updateAnalytics(this.context, state => recordGeneration(state));
				break;
			case 'latency':
				if (typeof message.value === 'number') {
					await updateAnalytics(this.context, state => recordLatency(state, message.value ?? 0));
				}
				break;
			case 'download':
				if (typeof message.value === 'number') {
					await updateAnalytics(this.context, state => recordDownloadTime(state, message.value ?? 0));
				}
				break;
			case 'renderer':
				if (message.renderer) {
					await updateAnalytics(this.context, state => recordRenderer(state, message.renderer ?? ''));
				}
				break;
			default:
				break;
		}
	}

	private resolveLanguage() {
		const raw = (vscode.env.language || 'en').toLowerCase();
		return raw.startsWith('zh') ? 'zh' : 'en';
	}

	private async ensureRecentCommits() {
		if (!this.repoRoot || !this.repoId) {
			this.recentCommits = [];
			this.recentCommitsRepoId = null;
			return;
		}
		if (this.recentCommitsRepoId === this.repoId && this.recentCommits.length > 0) {
			return;
		}
		try {
			this.recentCommits = await getRecentCommitSubjects(this.repoRoot, 20);
			this.recentCommitsRepoId = this.repoId;
		} catch {
			this.recentCommits = [];
			this.recentCommitsRepoId = this.repoId;
		}
	}

	private async getGitContext() {
		if (!this.repoRoot) {
			return null;
		}
		const [statusSummary, stagedNameStatus] = await Promise.all([
			getStatusSummary(this.repoRoot),
			getStagedNameStatus(this.repoRoot),
		]);
		return {
			statusSummary: statusSummary.trim(),
			stagedNameStatus: stagedNameStatus.trim(),
			recentCommits: this.recentCommits,
		};
	}
}

function getSettings() {
	const config = vscode.workspace.getConfiguration('smartCommit');
	return {
		promptConfigUrl: config.get<string>('promptConfigUrl', ''),
		promptConfigTtlMinutes: config.get<number>('promptConfigTtlMinutes', 1440),
		defaultModel: config.get<'default' | 'large' | 'tiny'>('defaultModel', 'default'),
	};
}

function getHtmlForWebview(webview: vscode.Webview, extensionPath: string) {
	const nonce = getNonce();
	const scriptUri = webview.asWebviewUri(
		vscode.Uri.file(path.join(extensionPath, 'dist', 'webview', 'main.js'))
	);
	const styleUri = webview.asWebviewUri(
		vscode.Uri.file(path.join(extensionPath, 'dist', 'webview', 'main.css'))
	);
	const nexusCssUri = resolveNexusCss(extensionPath, webview);

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; connect-src ${webview.cspSource} https:; worker-src blob:; child-src blob:; font-src ${webview.cspSource};" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	${nexusCssUri ? `<link rel="stylesheet" href="${nexusCssUri}" />` : ''}
	<link rel="stylesheet" href="${styleUri}" />
</head>
<body>
	<div id="app" class="app">
		<header class="app__header">
			<div class="brand">
				<div class="brand__title">Smart Commit</div>
				<div class="brand__subtitle" data-i18n="brandSubtitle">Local-first / WebLLM / WebGPU</div>
			</div>
			<div class="header-actions">
				<div class="repo">
					<label class="repo__label" for="repoSelect" data-i18n="labelRepository">Repository</label>
					<select id="repoSelect" class="repo__select"></select>
				</div>
				<button id="langToggle" class="ghost ghost--small" type="button" aria-label="Toggle language"></button>
			</div>
		</header>
		<main class="app__main">
			<section class="panel panel--diff">
				<div class="panel__header">
					<h2 data-i18n="headingDiff">Diff Signal</h2>
					<button id="refreshBtn" class="ghost" data-i18n="btnRefresh">Refresh</button>
				</div>
				<pre id="diffSummary" class="diff"></pre>
				<div id="diffMeta" class="diff__meta"></div>
			</section>
			<section class="panel panel--control">
				<div class="panel__header">
					<h2 data-i18n="headingInference">Inference</h2>
					<div id="gpuStatus" class="status" data-tooltip=""></div>
				</div>
				<div class="control__row">
					<label class="control__label" for="modelSelect" data-i18n="labelModel">Model</label>
					<select id="modelSelect" class="control__select">
						<option value="default" data-i18n="modelDefault">Default (Qwen2.5 3B)</option>
						<option value="large" data-i18n="modelLarge">Large (Qwen2.5 7B)</option>
						<option value="tiny" data-i18n="modelTiny">Tiny (Qwen2.5 0.5B)</option>
					</select>
				</div>
				<div class="control__row">
					<button id="generateBtn" class="primary" data-i18n="btnGenerate">Generate</button>
					<button id="abortBtn" class="ghost" data-i18n="btnAbort">Abort</button>
				</div>
				<div class="panel__header panel__header--tight">
					<h2 data-i18n="headingDraft">Commit Draft</h2>
					<button id="copyBtn" class="ghost" data-i18n="btnCopy">Copy</button>
				</div>
				<textarea id="commitOutput" class="output" rows="6" placeholder="Commit message appears here" data-i18n-placeholder="placeholderCommit"></textarea>
				<div class="control__row control__row--footer">
					<button id="acceptBtn" class="primary" data-i18n="btnAccept">Accept & Commit</button>
					<button id="regenBtn" class="ghost" data-i18n="btnRegen">Regenerate</button>
				</div>
			</section>
		</main>
		<div class="app__footer">
			<div class="footer__metric">
				<span data-i18n="footerSuccess">Success rate</span>
				<strong id="successRate">--</strong>
			</div>
			<div class="footer__metric">
				<span data-i18n="footerRenderer">Renderer</span>
				<strong id="renderer">--</strong>
			</div>
		</div>
	</div>
	<div id="progressOverlay" class="overlay hidden">
		<div class="overlay__card">
			<div class="spinner"></div>
			<div id="overlayText" class="overlay__text" data-i18n="overlayGenerating">Generating with WebLLM...</div>
		</div>
	</div>
	<div id="dialog" class="dialog hidden">
		<div class="dialog__card">
			<div id="dialogMessage" class="dialog__message"></div>
			<div class="dialog__actions">
				<button id="dialogCancel" class="ghost" data-i18n="dialogCancel">Cancel</button>
				<button id="dialogConfirm" class="primary" data-i18n="dialogConfirm">Confirm</button>
			</div>
		</div>
	</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce() {
	return crypto.randomBytes(16).toString('base64');
}

function resolveNexusCss(extensionPath: string, webview: vscode.Webview): string | null {
	const packageJsonPath = path.join(extensionPath, 'node_modules', '@sruim', 'nexus-design', 'package.json');
	const candidates: string[] = [];
	if (fs.existsSync(packageJsonPath)) {
		try {
			const raw = fs.readFileSync(packageJsonPath, 'utf8');
			const pkg = JSON.parse(raw) as { style?: string; module?: string; main?: string; exports?: unknown };
			if (pkg.style) {
				candidates.push(pkg.style);
			}
			if (typeof pkg.exports === 'object' && pkg.exports) {
				for (const value of Object.values(pkg.exports)) {
					if (typeof value === 'string' && value.endsWith('.css')) {
						candidates.push(value);
					}
				}
			}
		} catch {
			// ignore parse errors
		}
	}
	candidates.push('dist/nexus.css', 'dist/styles.css', 'dist/index.css', 'styles.css');
	for (const candidate of candidates) {
		const fullPath = path.join(extensionPath, 'node_modules', '@sruim', 'nexus-design', candidate);
		if (fs.existsSync(fullPath)) {
			return webview.asWebviewUri(vscode.Uri.file(fullPath)).toString();
		}
	}
	return null;
}

async function executeGitCommit(repoRoot: string, message: string) {
	const { runGit } = await import('./git.js');
	await runGit(repoRoot, ['commit', '-m', message]);
}

function hashContent(content: string): string {
	return crypto.createHash('sha256').update(content).digest('hex');
}
