import './styles.css';

declare const acquireVsCodeApi: () => { postMessage: (message: unknown) => void };

const vscode = acquireVsCodeApi();

type RepoInfo = {
	id: string;
	name: string;
	root: string;
	hasStaged: boolean;
};

type FileSummary = {
	path: string;
	changeType: string;
	additions: number;
	deletions: number;
	context: string[];
	highlights: string[];
	keywords: string[];
	weight: number;
};

type PreprocessResult = {
	repoRoot: string;
	files: FileSummary[];
	lockfileSummaries: string[];
	languageSignals: Record<string, number>;
	summaryText: string;
	rawDiff: string;
	truncated: boolean;
	totalAdditions: number;
	totalDeletions: number;
};

type AnalyticsState = {
	totalGenerated: number;
	commitAccepted: number;
	modelLatencyMs: number[];
	downloadTimesMs: number[];
	renderers: Record<string, number>;
};

type Settings = {
	promptConfigUrl: string;
	promptConfigTtlMinutes: number;
	defaultModel: 'default' | 'large' | 'tiny';
};

type Lang = 'en' | 'zh';

type GitContext = {
	statusSummary?: string;
	stagedNameStatus?: string;
	recentCommits?: string[];
};

type PromptConfig = {
	prefix?: string;
	suffix?: string;
	subjectStyle?: 'imperative' | 'sentence';
};

type InitProgressReport = {
	progress: number;
	text: string;
};

type WebLLMModelRecord = {
	model: string;
	model_id: string;
	model_lib: string;
	modelId?: string;
};

type WebLLMAppConfig = {
	model_list: WebLLMModelRecord[];
	useIndexedDBCache?: boolean;
};

type WebLLMModule = {
	prebuiltAppConfig?: WebLLMAppConfig;
	CreateMLCEngine: (
		modelId: string,
		config: {
			appConfig?: WebLLMAppConfig;
			initProgressCallback?: (report: InitProgressReport) => void;
			logLevel?: string;
		}
	) => Promise<any>;
};

type AppState = {
	repos: RepoInfo[];
	selectedRepoId: string | null;
	diff: PreprocessResult | null;
	analytics: AnalyticsState | null;
	settings: Settings;
	model: 'default' | 'large' | 'tiny';
	lang: Lang;
	gitContext: GitContext | null;
	busy: boolean;
	retryCount: number;
	renderer: string;
};

const state: AppState = {
	repos: [],
	selectedRepoId: null,
	diff: null,
	analytics: null,
	settings: { promptConfigUrl: '', promptConfigTtlMinutes: 1440, defaultModel: 'default' },
	model: 'default',
	lang: 'en',
	gitContext: null,
	busy: false,
	retryCount: 0,
	renderer: '--',
};

function isDebugEnabled() {
	try {
		return localStorage.getItem('smartCommitDebug') === '1';
	} catch {
		return false;
	}
}

function debugLog(label: string, data: Record<string, unknown>) {
	if (!isDebugEnabled()) {
		return;
	}
	console.debug('[SmartCommit]', label, data);
}

const I18N: Record<Lang, Record<string, string>> = {
	en: {
		brandSubtitle: 'Local-first / WebLLM / WebGPU',
		labelRepository: 'Repository',
		headingDiff: 'Diff Signal',
		btnRefresh: 'Refresh',
		headingInference: 'Inference',
		labelModel: 'Model',
		modelDefault: 'Default (Qwen2.5 3B)',
		modelLarge: 'Large (Qwen2.5 7B)',
		modelTiny: 'Tiny (Qwen2.5 0.5B)',
		btnGenerate: 'Generate',
		btnAbort: 'Abort',
		headingDraft: 'Commit Draft',
		btnCopy: 'Copy',
		placeholderCommit: 'Commit message appears here',
		btnAccept: 'Accept & Commit',
		btnRegen: 'Regenerate',
		footerSuccess: 'Success rate',
		footerRenderer: 'Renderer',
		overlayGenerating: 'Generating with WebLLM...',
		dialogConfirm: 'Confirm',
		dialogCancel: 'Cancel',
		repoNone: 'No git repositories found',
		repoClean: ' (clean)',
		diffEmpty: 'No staged diff available.',
		signalsLabel: 'Signals:',
		diffTruncated: ' - Diff truncated',
		signalsNone: 'no strong language signals',
		noStagedDialog: 'No staged changes detected. Stage files to generate a commit message.',
		noStagedGenerate: 'No staged diff. Stage changes before generating.',
		timeoutSwitchTiny: 'Inference timeout. Switch to the tiny model for faster results?',
		actionSwitch: 'Switch',
		actionStay: 'Stay',
		inferenceFailed: 'Inference failed.',
		commitSuccess: 'Commit created successfully.',
		commitFailed: 'Commit failed.',
		noRepoSelected: 'No repository selected.',
		emptyMessage: 'Commit message is empty.',
		repetitive: 'Result looked repetitive. Regenerating.',
		copied: 'Copied to clipboard.',
		gpuMissingLabel: 'WebGPU permission missing',
		gpuUnavailableTooltip: 'WebGPU unavailable. Enable WebGPU in chrome://flags.',
		gpuDisabledDialog: 'WebGPU is disabled. Enable it in chrome://flags, then reload Smart Commit.',
		gpuBusyLabel: 'GPU Busy',
		gpuBusyTooltip: 'GPU is busy. Close heavy GPU apps to continue.',
		gpuBusyDialog: 'GPU Busy: close heavy GPU apps or wait until resources free up.',
		gpuReadyLabel: 'GPU Ready',
		gpuReadyTooltip: 'WebGPU is ready for inference.',
		overlayLoading: 'Loading {model}...',
		overlayGeneratingModel: 'Generating with {model}...',
		overlayLoadingProgress: 'Loading model ({progress}%)',
		noModels: 'No WebLLM models available.',
		noModelsHint: 'No WebLLM models available. Check network access or model configuration.',
		langIndicator: 'VS Code: English',
		langIndicatorHint: 'Language follows VS Code setting.',
	},
	zh: {
		brandSubtitle: '本地优先 / WebLLM / WebGPU',
		labelRepository: '仓库',
		headingDiff: '变更摘要',
		btnRefresh: '刷新',
		headingInference: '推理',
		labelModel: '模型',
		modelDefault: '默认（Qwen2.5 3B）',
		modelLarge: '大型（Qwen2.5 7B）',
		modelTiny: '轻量（Qwen2.5 0.5B）',
		btnGenerate: '生成',
		btnAbort: '取消',
		headingDraft: '提交草稿',
		btnCopy: '复制',
		placeholderCommit: '提交信息会显示在这里',
		btnAccept: '确认并提交',
		btnRegen: '重新生成',
		footerSuccess: '成功率',
		footerRenderer: '渲染器',
		overlayGenerating: '正在使用 WebLLM 生成...',
		dialogConfirm: '确认',
		dialogCancel: '取消',
		repoNone: '未找到 Git 仓库',
		repoClean: '（干净）',
		diffEmpty: '暂无已暂存的变更。',
		signalsLabel: '信号：',
		diffTruncated: ' - 差异已截断',
		signalsNone: '没有明显的语言信号',
		noStagedDialog: '未检测到已暂存的变更，请先暂存文件再生成提交信息。',
		noStagedGenerate: '暂无已暂存的变更，请先暂存后再生成。',
		timeoutSwitchTiny: '推理超时，切换到轻量模型以加快速度？',
		actionSwitch: '切换',
		actionStay: '继续等待',
		inferenceFailed: '推理失败。',
		commitSuccess: '提交成功。',
		commitFailed: '提交失败。',
		noRepoSelected: '未选择仓库。',
		emptyMessage: '提交信息为空。',
		repetitive: '结果疑似重复，正在重新生成。',
		copied: '已复制到剪贴板。',
		gpuMissingLabel: 'WebGPU 未启用',
		gpuUnavailableTooltip: 'WebGPU 不可用，请在 chrome://flags 启用 WebGPU。',
		gpuDisabledDialog: 'WebGPU 已禁用，请在 chrome://flags 启用后重载 Smart Commit。',
		gpuBusyLabel: 'GPU 繁忙',
		gpuBusyTooltip: 'GPU 繁忙，请关闭高负载应用后重试。',
		gpuBusyDialog: 'GPU 繁忙：关闭高负载应用或等待资源释放。',
		gpuReadyLabel: 'GPU 就绪',
		gpuReadyTooltip: 'WebGPU 已就绪，可开始推理。',
		overlayLoading: '正在加载 {model}...',
		overlayGeneratingModel: '正在生成（{model}）...',
		overlayLoadingProgress: '正在加载模型（{progress}%）',
		noModels: '未找到可用的 WebLLM 模型。',
		noModelsHint: '未找到可用的 WebLLM 模型，请检查网络或模型配置。',
		langIndicator: 'VS Code：中文',
		langIndicatorHint: '语言跟随 VS Code 设置。',
	},
};


function t(key: string, vars?: Record<string, string | number>) {
	const template = I18N[state.lang][key] ?? I18N.en[key] ?? key;
	if (!vars) {
		return template;
	}
	return template.replace(/\{(\w+)\}/g, (_, token: string) => String(vars[token] ?? `{${token}}`));
}

function updateI18n() {
	document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
		const key = element.dataset.i18n;
		if (key) {
			element.textContent = t(key);
		}
	});
	document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach(element => {
		const key = element.dataset.i18nPlaceholder;
		if (key && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
			element.placeholder = t(key);
		}
	});
	const gpuLabelKey = elements.gpuStatus.dataset.i18nLabel;
	const gpuTooltipKey = elements.gpuStatus.dataset.i18nTooltip;
	if (gpuLabelKey) {
		elements.gpuStatus.textContent = t(gpuLabelKey);
	}
	if (gpuTooltipKey) {
		elements.gpuStatus.dataset.tooltip = t(gpuTooltipKey);
	}
	elements.langToggle.textContent = t('langIndicator');
	elements.langToggle.title = t('langIndicatorHint');
	elements.langToggle.disabled = true;
}

function setLanguage(lang: Lang) {
	state.lang = lang;
	updateI18n();
	updateRepoSelect();
	updateDiff();
	updateAnalytics();
}

function localizeErrorMessage(message: string): string {
	switch (message) {
		case 'No repository selected.':
			return t('noRepoSelected');
		case 'Commit message is empty.':
			return t('emptyMessage');
		case 'Commit failed.':
			return t('commitFailed');
		default:
			return message;
	}
}

let noStagedDialogShown = false;

const elements = {
	repoSelect: document.getElementById('repoSelect') as HTMLSelectElement,
	diffSummary: document.getElementById('diffSummary') as HTMLPreElement,
	diffMeta: document.getElementById('diffMeta') as HTMLDivElement,
	generateBtn: document.getElementById('generateBtn') as HTMLButtonElement,
	abortBtn: document.getElementById('abortBtn') as HTMLButtonElement,
	refreshBtn: document.getElementById('refreshBtn') as HTMLButtonElement,
	modelSelect: document.getElementById('modelSelect') as HTMLSelectElement,
	commitOutput: document.getElementById('commitOutput') as HTMLTextAreaElement,
	acceptBtn: document.getElementById('acceptBtn') as HTMLButtonElement,
	regenBtn: document.getElementById('regenBtn') as HTMLButtonElement,
	copyBtn: document.getElementById('copyBtn') as HTMLButtonElement,
	progressOverlay: document.getElementById('progressOverlay') as HTMLDivElement,
	overlayText: document.getElementById('overlayText') as HTMLDivElement,
	gpuStatus: document.getElementById('gpuStatus') as HTMLDivElement,
	successRate: document.getElementById('successRate') as HTMLDivElement,
	renderer: document.getElementById('renderer') as HTMLDivElement,
	langToggle: document.getElementById('langToggle') as HTMLButtonElement,
	dialog: document.getElementById('dialog') as HTMLDivElement,
	dialogMessage: document.getElementById('dialogMessage') as HTMLDivElement,
	dialogConfirm: document.getElementById('dialogConfirm') as HTMLButtonElement,
	dialogCancel: document.getElementById('dialogCancel') as HTMLButtonElement,
};

updateI18n();

let currentAbort: AbortController | null = null;
let timeoutId: number | null = null;
let gpuDevice: { destroy: () => void } | null = null;
let webllmModule: WebLLMModule | null = null;
let webllmEngine: Awaited<ReturnType<WebLLMModule['CreateMLCEngine']>> | null = null;
let webllmEngineModelId: string | null = null;
let webllmEnginePromise: Promise<Awaited<ReturnType<WebLLMModule['CreateMLCEngine']>>> | null = null;

setupEventListeners();
void initGpu();
vscode.postMessage({ type: 'ready' });

	window.addEventListener('message', event => {
		const message = event.data;
		switch (message.type) {
			case 'init':
				state.repos = message.repos ?? [];
				state.selectedRepoId = message.selectedRepoId ?? null;
				state.diff = message.diff ?? null;
				state.analytics = message.analytics ?? null;
				state.settings = message.settings ?? state.settings;
				state.gitContext = message.gitContext ?? state.gitContext;
				state.model = state.settings.defaultModel ?? state.model;
				const hasLang = message.lang === 'en' || message.lang === 'zh';
				if (hasLang) {
					setLanguage(message.lang);
				}
				elements.modelSelect.value = state.model;
				noStagedDialogShown = false;
				if (!hasLang) {
					updateRepoSelect();
					updateDiff();
					updateAnalytics();
				}
				return;
			case 'diffUpdated':
				state.diff = message.diff ?? null;
				state.analytics = message.analytics ?? state.analytics;
				state.settings = message.settings ?? state.settings;
				state.gitContext = message.gitContext ?? state.gitContext;
				const hasUpdateLang = message.lang === 'en' || message.lang === 'zh';
				if (hasUpdateLang) {
					setLanguage(message.lang);
				}
				if (state.diff) {
					noStagedDialogShown = false;
				}
				if (!hasUpdateLang) {
					updateDiff();
					updateAnalytics();
				}
				return;
			case 'diffEmpty':
				state.diff = null;
				updateDiff();
				abortInference();
				if (!noStagedDialogShown) {
					noStagedDialogShown = true;
					showDialog(t('noStagedDialog'));
				}
				return;
			case 'commitResult':
				if (message.ok) {
					showDialog(t('commitSuccess'), { confirmLabel: t('dialogConfirm') });
				} else {
					const errorText = message.error ? localizeErrorMessage(message.error) : t('commitFailed');
					showDialog(errorText);
				}
				return;
		default:
			return;
	}
});

function setupEventListeners() {
	elements.repoSelect.addEventListener('change', () => {
		const repoId = elements.repoSelect.value || null;
		vscode.postMessage({ type: 'selectRepo', repoId });
	});

	elements.refreshBtn.addEventListener('click', () => {
		vscode.postMessage({ type: 'refreshDiff' });
	});

	elements.modelSelect.addEventListener('change', () => {
		const value = elements.modelSelect.value;
		state.model = value === 'large' ? 'large' : value === 'tiny' ? 'tiny' : 'default';
	});

	elements.generateBtn.addEventListener('click', () => {
		void startInference();
	});

	elements.abortBtn.addEventListener('click', () => {
		abortInference();
	});

	elements.regenBtn.addEventListener('click', () => {
		void startInference();
	});

	elements.acceptBtn.addEventListener('click', () => {
		const message = elements.commitOutput.value.trim();
		vscode.postMessage({ type: 'acceptCommit', message });
	});

	elements.copyBtn.addEventListener('click', () => {
		void copyCommit();
	});

	document.addEventListener('keydown', event => {
		if (event.key === 'Escape') {
			abortInference();
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			const message = elements.commitOutput.value.trim();
			vscode.postMessage({ type: 'acceptCommit', message });
		}
	});
}

function updateRepoSelect() {
	elements.repoSelect.innerHTML = '';
	if (state.repos.length === 0) {
		const option = document.createElement('option');
		option.textContent = t('repoNone');
		option.disabled = true;
		elements.repoSelect.appendChild(option);
		return;
	}
	for (const repo of state.repos) {
		const option = document.createElement('option');
		option.value = repo.id;
		const cleanSuffix = repo.hasStaged ? '' : ` ${t('repoClean')}`;
		option.textContent = `${repo.name}${cleanSuffix}`;
		if (repo.id === state.selectedRepoId) {
			option.selected = true;
		}
		elements.repoSelect.appendChild(option);
	}
}

function updateDiff() {
	if (!state.diff) {
		elements.diffSummary.textContent = t('diffEmpty');
		elements.diffMeta.textContent = '';
		return;
	}
	elements.diffSummary.textContent = state.diff.summaryText;
	const truncatedSuffix = state.diff.truncated ? t('diffTruncated') : '';
	elements.diffMeta.textContent = `${t('signalsLabel')} ${formatLanguageSignals(state.diff.languageSignals)}${truncatedSuffix}`;
}

function updateAnalytics() {
	if (!state.analytics) {
		elements.successRate.textContent = '--';
		return;
	}
	const { totalGenerated, commitAccepted } = state.analytics;
	if (totalGenerated === 0) {
		elements.successRate.textContent = '--';
		return;
	}
	const rate = Math.round((commitAccepted / totalGenerated) * 100);
	elements.successRate.textContent = `${rate}%`;
}

function formatLanguageSignals(signals: Record<string, number>) {
	const parts = Object.entries(signals)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([lang, weight]) => `${lang.toUpperCase()}:${weight}`);
	return parts.length > 0 ? parts.join(' - ') : t('signalsNone');
}

async function initGpu() {
	const gpu = (navigator as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
	if (!gpu) {
		setGpuStatus('no-webgpu', 'gpuMissingLabel', 'gpuUnavailableTooltip');
		showDialog(t('gpuDisabledDialog'));
		return;
	}
	const adapter = (await gpu.requestAdapter()) as { requestDevice: () => Promise<{ destroy: () => void }>; requestAdapterInfo?: () => Promise<{ description?: string; vendor?: string }> } | null;
	if (!adapter) {
		setGpuStatus('busy', 'gpuBusyLabel', 'gpuBusyTooltip');
		showDialog(t('gpuBusyDialog'));
		return;
	}
	gpuDevice = await adapter.requestDevice();
	setGpuStatus('ready', 'gpuReadyLabel', 'gpuReadyTooltip');
	const info = (adapter as { requestAdapterInfo?: () => Promise<{ description?: string; vendor?: string }> }).requestAdapterInfo;
	if (info) {
		const adapterInfo = await info.call(adapter);
		state.renderer = adapterInfo.description || adapterInfo.vendor || 'Unknown';
		elements.renderer.textContent = state.renderer;
		vscode.postMessage({ type: 'analytics', event: 'renderer', renderer: state.renderer });
	} else {
		state.renderer = 'WebGPU';
		elements.renderer.textContent = state.renderer;
	}
}

function setGpuStatus(stateKey: string, labelKey: string, tooltipKey: string) {
	elements.gpuStatus.textContent = t(labelKey);
	elements.gpuStatus.dataset.state = stateKey;
	elements.gpuStatus.dataset.tooltip = t(tooltipKey);
	elements.gpuStatus.dataset.i18nLabel = labelKey;
	elements.gpuStatus.dataset.i18nTooltip = tooltipKey;
}

const MODEL_IDS = {
	default: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
	large: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
	tiny: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
} as const;

async function loadWebLLM(): Promise<WebLLMModule> {
	if (!webllmModule) {
		webllmModule = await import('@mlc-ai/web-llm');
	}
	return webllmModule;
}

function getModelIds(webllm: WebLLMModule): string[] {
	const models = webllm.prebuiltAppConfig?.model_list ?? [];
	return models
		.map(model => model.model_id ?? model.modelId ?? '')
		.filter((modelId): modelId is string => Boolean(modelId));
}

function pickModelId(webllm: WebLLMModule, kind: 'default' | 'large' | 'tiny'): string {
	const modelIds = getModelIds(webllm);
	if (modelIds.length === 0) {
		throw new Error('No WebLLM models available. Check network access or model configuration.');
	}
	const desired = MODEL_IDS[kind];
	if (modelIds.includes(desired)) {
		return desired;
	}
	const fallback = modelIds.find(id => Object.values(MODEL_IDS).includes(id as (typeof MODEL_IDS)[keyof typeof MODEL_IDS]));
	return fallback ?? modelIds[0];
}

function buildAppConfig(webllm: WebLLMModule): WebLLMAppConfig {
	const modelList = (webllm.prebuiltAppConfig?.model_list ?? []).filter((model: WebLLMModelRecord) =>
		Object.values(MODEL_IDS).includes(model.model_id as (typeof MODEL_IDS)[keyof typeof MODEL_IDS])
	);
	return {
		useIndexedDBCache: false,
		model_list: modelList,
	};
}

async function startInference(resetRetry = true) {
	if (!state.diff) {
		showDialog(t('noStagedGenerate'));
		return;
	}
	abortInference();
	state.busy = true;
	if (resetRetry) {
		state.retryCount = 0;
	}
	elements.commitOutput.value = '';
	setOverlay(true);

	let modelId: string;
	let webllm: WebLLMModule;
	try {
		webllm = await loadWebLLM();
		modelId = pickModelId(webllm, state.model);
	} catch (error) {
		setOverlay(false);
		state.busy = false;
		showDialog(t('noModelsHint'));
		return;
	}
	elements.overlayText.textContent = t('overlayLoading', { model: modelId });
	const start = performance.now();
	vscode.postMessage({ type: 'analytics', event: 'generation' });

	currentAbort = new AbortController();
	const signal = currentAbort.signal;

	timeoutId = window.setTimeout(async () => {
		const confirmed = await showDialog(
			t('timeoutSwitchTiny'),
			{ confirmLabel: t('actionSwitch'), cancelLabel: t('actionStay') }
		);
		if (confirmed) {
			state.model = 'tiny';
			elements.modelSelect.value = 'tiny';
			void startInference();
		}
	}, 15000);

	try {
		const engine = await ensureModelCached(webllm, modelId, signal);
		elements.overlayText.textContent = t('overlayGeneratingModel', { model: modelId });
		const promptConfig = await getPromptConfig();
		const message = await generateCommitMessage(engine, state.diff, promptConfig, { signal });
		if (signal.aborted) {
			return;
		}
		const elapsed = performance.now() - start;
		vscode.postMessage({ type: 'analytics', event: 'latency', value: Math.round(elapsed) });
		const filtered = postFilter(message);
		if (!filtered && state.retryCount < 1) {
			state.retryCount += 1;
			void startInference(false);
			return;
		}
		elements.commitOutput.value = filtered ?? message;
	} catch (error) {
		if (!signal.aborted) {
			showDialog(error instanceof Error ? error.message : t('inferenceFailed'));
		}
	} finally {
		setOverlay(false);
		state.busy = false;
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	}
}

function abortInference() {
	if (currentAbort) {
		currentAbort.abort();
		currentAbort = null;
	}
	if (webllmEngine) {
		void interruptGeneration(webllmEngine);
	}
	if (timeoutId) {
		clearTimeout(timeoutId);
		timeoutId = null;
	}
	setOverlay(false);
	releaseGpu();
}

function releaseGpu() {
	if (gpuDevice) {
		gpuDevice.destroy();
		gpuDevice = null;
	}
}

async function ensureModelCached(webllm: WebLLMModule, modelId: string, signal: AbortSignal) {
	const cached = await getCache(modelId);
	const start = performance.now();
	let downloadReported = Boolean(cached);

	const engine = await ensureWebLlmEngine(webllm, modelId, report => {
		if (signal.aborted) {
			return;
		}
		const progress = Math.round(report.progress * 100);
		const label =
			state.lang === 'en' && report.text
				? `${report.text} (${progress}%)`
				: t('overlayLoadingProgress', { progress });
		elements.overlayText.textContent = label;
		if (!downloadReported && report.progress >= 1) {
			downloadReported = true;
			void setCache(modelId, { cachedAt: Date.now() });
			const elapsed = Math.round(performance.now() - start);
			vscode.postMessage({ type: 'analytics', event: 'download', value: elapsed });
		}
	});

	if (!downloadReported && !cached) {
		downloadReported = true;
		await setCache(modelId, { cachedAt: Date.now() });
		const elapsed = Math.round(performance.now() - start);
		vscode.postMessage({ type: 'analytics', event: 'download', value: elapsed });
	}

	return engine;
}

async function ensureWebLlmEngine(
	webllm: WebLLMModule,
	modelId: string,
	initProgressCallback: (report: InitProgressReport) => void
) {
	if (webllmEngineModelId && webllmEngineModelId !== modelId) {
		webllmEngine = null;
		webllmEnginePromise = null;
	}
	if (webllmEngine && webllmEngineModelId === modelId) {
		return webllmEngine;
	}
	if (webllmEnginePromise && webllmEngineModelId === modelId) {
		return webllmEnginePromise;
	}
	webllmEngineModelId = modelId;
	webllmEnginePromise = webllm.CreateMLCEngine(modelId, {
		appConfig: buildAppConfig(webllm),
		initProgressCallback,
		logLevel: 'WARN',
	});
	webllmEngine = await webllmEnginePromise;
	webllmEnginePromise = null;
	return webllmEngine;
}

const DEFAULT_PROMPT_CONFIG: PromptConfig = {
	subjectStyle: 'imperative',
};

async function getPromptConfig(): Promise<PromptConfig> {
	const { promptConfigUrl, promptConfigTtlMinutes } = state.settings;
	if (!promptConfigUrl) {
		return DEFAULT_PROMPT_CONFIG;
	}
	const cacheKey = `prompt:${promptConfigUrl}`;
	const cached = await getConfig(cacheKey);
	const now = Date.now();
	if (cached && now - cached.savedAt < promptConfigTtlMinutes * 60_000) {
		return { ...DEFAULT_PROMPT_CONFIG, ...cached.value };
	}
	try {
		const response = await fetch(promptConfigUrl, { cache: 'no-store' });
		if (!response.ok) {
			throw new Error('Prompt config fetch failed');
		}
		const value = (await response.json()) as PromptConfig;
		await setConfig(cacheKey, { savedAt: now, value });
		return { ...DEFAULT_PROMPT_CONFIG, ...value };
	} catch {
		if (cached) {
			return { ...DEFAULT_PROMPT_CONFIG, ...cached.value };
		}
		return DEFAULT_PROMPT_CONFIG;
	}
}

async function generateCommitMessage(
engine: Awaited<ReturnType<WebLLMModule['CreateMLCEngine']>>,
diff: PreprocessResult,
promptConfig: PromptConfig,
options: { signal: AbortSignal }
) {
	if (options.signal.aborted) {
		throw new Error('Inference aborted');
	}

	const typeHint = deriveType(diff);
	const scopeHint = diff.files[0] ? deriveScope(diff.files[0].path) : 'repo';
	const subjectStyle = promptConfig.subjectStyle === 'sentence'
		? 'Use sentence case for the subject.'
		: 'Use imperative mood for the subject.';
	const languageHint = state.lang === 'zh'
		? 'Use Chinese for the commit message.'
		: 'Use English for the commit message.';
	const rankedFiles = [...diff.files].sort((a, b) => {
		const scoreA = (a.additions + a.deletions) || a.weight || 0;
		const scoreB = (b.additions + b.deletions) || b.weight || 0;
		return scoreB - scoreA;
	});
	const keyFiles = rankedFiles.slice(0, 3).map(file => {
		const parts: string[] = [];
		const keywords = file.keywords ?? [];
		if (file.context.length) {
			parts.push(`context: ${file.context.slice(0, 2).join(', ')}`);
		}
		if (keywords.length) {
			parts.push(`keywords: ${keywords.slice(0, 3).join(', ')}`);
		}
		if (file.highlights.length) {
			parts.push(`highlights: ${file.highlights.slice(0, 2).join(', ')}`);
		}
		const meta = parts.length ? ` | ${parts.join(' | ')}` : '';
		return `- ${file.path} (+${file.additions}/-${file.deletions})${meta}`;
	}).join('\n');
	const lockfileNotes = diff.lockfileSummaries.length
		? `Lockfiles: ${diff.lockfileSummaries.slice(0, 2).join(' / ')}`
		: '';
	const statusSummary = state.gitContext?.statusSummary
		? `Git status:\n${state.gitContext.statusSummary}`
		: '';
	const stagedNames = state.gitContext?.stagedNameStatus
		? `Staged files:\n${state.gitContext.stagedNameStatus}`
		: '';
	const recentCommits = state.gitContext?.recentCommits?.length
		? `Recent commits:\n- ${state.gitContext.recentCommits.slice(0, 8).join('\n- ')}`
		: '';
	const requiredTokenCount = diff.files.length > 10 ? 2 : 1;
	const changeMagnitude = diff.files.length + Math.round((diff.totalAdditions + diff.totalDeletions) / 200);
	const minSubjectLength = changeMagnitude >= 10 ? 300 : 0;
	const requiredTokens = buildRequiredTokens(rankedFiles.slice(0, 3));
	const requiredTokenHint = requiredTokens.length
		? `Subject must include at least ${requiredTokenCount} key item${requiredTokenCount > 1 ? 's' : ''}: ${requiredTokens.join(', ')}`
		: '';

	const systemPrompt = [
		'You are a Git commit message generator.',
		'Return exactly one line, no quotes or code fences.',
		'Format: type(scope): subject',
		`Subject must include at least ${requiredTokenCount} key items (file/module/identifier).`,
		'Prefer specificity even if longer.',
		'Include a short action phrase for each key item.',
		minSubjectLength > 0 ? 'Subject should be 300-400 characters to describe the change.' : '',
		'Be specific and mention a key file or component.',
		'Avoid generic phrases like "updated implementation details", "update logic", or "multiple files".',
	].join(' ');

	const userPrompt = [
		`Suggested type: ${typeHint}`,
		`Suggested scope: ${scopeHint}`,
		subjectStyle,
		languageHint,
		requiredTokenHint,
		'Key changes:',
		keyFiles || '- (no file details)',
		lockfileNotes,
		statusSummary,
		stagedNames,
		recentCommits,
		'Context:',
		diff.summaryText,
	].filter(Boolean).join('\n');

	let content = '';
	try {
		const stream = await engine.chat.completions.create({
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt },
			],
			temperature: 0.2,
			max_tokens: 128,
			stream: true,
		});
		for await (const chunk of stream) {
			if (options.signal.aborted) {
				await interruptGeneration(engine);
				throw new Error('Inference aborted');
			}
			const delta = chunk.choices?.[0]?.delta?.content ?? '';
			if (delta) {
				content += delta;
				elements.commitOutput.value = sanitizeCommitMessage(content);
			}
		}
	} catch (error) {
		if (options.signal.aborted) {
			throw error;
		}
		try {
			const response = await engine.chat.completions.create({
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt },
				],
				temperature: 0.2,
				max_tokens: 128,
			});
			content = response.choices?.[0]?.message?.content ?? '';
		} catch {
			const fallback = generateFallbackMessage(diff, promptConfig);
			return applyPromptConfig(fallback, promptConfig);
		}
	}

	if (options.signal.aborted) {
		throw new Error('Inference aborted');
	}

	const sanitized = sanitizeCommitMessage(content);
	debugLog('generation', {
		rawFirstLine: content.split(/\r?\n/).find(line => line.trim().length > 0) ?? '',
		sanitized,
		requiredTokenCount,
		requiredTokens,
		minSubjectLength,
		typeHint,
		scopeHint,
	});
	const finalMessage = sanitized || generateFallbackMessage(diff, promptConfig);
	const normalized = normalizeCommitMessage({
		message: finalMessage,
		typeHint,
		scopeHint,
		requiredTokens,
		requiredTokenCount,
		minSubjectLength,
		diff,
		promptConfig,
	});
	return applyPromptConfig(normalized, promptConfig);
}

function sanitizeCommitMessage(raw: string): string {
	if (!raw) {
		return '';
	}
	const firstLine = raw.split(/\r?\n/).find(line => line.trim().length > 0) ?? '';
	const trimmed = firstLine.replace(/^[-*]\s+/, '').trim();
	return trimmed.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
}

function isTooGeneric(message: string): boolean {
	return /updated implementation details|update logic|multiple files|misc|various/i.test(message) || message.length < 12;
}

async function interruptGeneration(engine: Awaited<ReturnType<WebLLMModule['CreateMLCEngine']>>) {
	const maybeInterrupt = engine as { interruptGenerate?: () => Promise<void> };
	if (typeof maybeInterrupt.interruptGenerate === 'function') {
		try {
			await maybeInterrupt.interruptGenerate();
		} catch {
			// ignore interrupt errors
		}
	}
}

type NormalizeOptions = {
	message: string;
	typeHint: string;
	scopeHint: string;
	requiredTokens: string[];
	requiredTokenCount: number;
	minSubjectLength: number;
	diff: PreprocessResult;
	promptConfig: PromptConfig;
};

function normalizeCommitMessage(options: NormalizeOptions): string {
	const parsed = parseCommitMessage(options.message);
	const subjectRaw = stripSubjectNoise(parsed.subject ?? options.message);
	const subject = ensureSpecificSubject({
		subject: subjectRaw,
		requiredTokens: options.requiredTokens,
		requiredTokenCount: options.requiredTokenCount,
		minSubjectLength: options.minSubjectLength,
		diff: options.diff,
		promptConfig: options.promptConfig,
	});
	const scope = parsed.scope && parsed.scope.trim().length > 0 ? parsed.scope.trim() : options.scopeHint;
	return formatCommitLine(options.typeHint, scope, subject);
}

function parseCommitMessage(message: string): { type?: string; scope?: string; subject?: string } {
	const match = /^([a-zA-Z][\w-]*)(?:\(([^)]+)\))?:\s*(.+)$/.exec(message.trim());
	if (!match) {
		return {};
	}
	return {
		type: match[1],
		scope: match[2],
		subject: match[3],
	};
}

function ensureSpecificSubject(options: {
	subject: string;
	requiredTokens: string[];
	requiredTokenCount: number;
	minSubjectLength: number;
	diff: PreprocessResult;
	promptConfig: PromptConfig;
}): string {
	const cleaned = options.subject.trim();
	const tokenMatch = matchRequiredTokens(cleaned, options.requiredTokens, options.requiredTokenCount);
	const reasons: string[] = [];
	if (cleaned.length === 0) {
		reasons.push('empty');
	}
	if (!tokenMatch.ok) {
		reasons.push('missingTokens');
	}
	if (isTooGeneric(cleaned)) {
		reasons.push('generic');
	}
	if (containsDiffStats(cleaned)) {
		reasons.push('diffStats');
	}
	if (options.minSubjectLength > 0 && cleaned.length < options.minSubjectLength) {
		reasons.push('tooShort');
	}
	const needsFallback = reasons.length > 0;
	debugLog('normalize', {
		subject: cleaned,
		requiredTokenCount: options.requiredTokenCount,
		requiredTokens: options.requiredTokens,
		matchedTokens: tokenMatch.matchedTokens,
		fallbackReasons: reasons,
		usedFallback: needsFallback,
		minSubjectLength: options.minSubjectLength,
	});
	if (needsFallback) {
		return buildSpecificSubject(
			options.diff,
			options.requiredTokens,
			options.requiredTokenCount,
			options.promptConfig,
			options.minSubjectLength
		);
	}
	const expanded = options.minSubjectLength > 0
		? ensureSubjectLength(cleaned, options.diff, options.requiredTokens, options.promptConfig, options.minSubjectLength)
		: cleaned;
	return applySubjectStyle(expanded, options.promptConfig);
}

function buildSpecificSubject(
	diff: PreprocessResult,
	requiredTokens: string[],
	requiredTokenCount: number,
	promptConfig: PromptConfig,
	minSubjectLength: number
): string {
	const tokens = requiredTokens.filter(Boolean);
	const rankedFiles = [...diff.files].sort((a, b) => {
		const scoreA = (a.additions + a.deletions) || a.weight || 0;
		const scoreB = (b.additions + b.deletions) || b.weight || 0;
		return scoreB - scoreA;
	});
	const primary = rankedFiles[0];
	const secondary = rankedFiles[1];
	const primaryFragment = primary ? buildSubjectFragment(primary) : '';
	const secondaryFragment = secondary ? buildSubjectFragment(secondary) : '';
	const fallbackHighlight = pickHighlight(diff);

	if (!primaryFragment) {
		const base = deriveDetailedSubject(diff, promptConfig);
		if (tokens.length === 0) {
			return base;
		}
		const preferred = tokens[0];
		const subject = fallbackHighlight
			? (state.lang === 'zh' ? `更新 ${preferred} ${fallbackHighlight}` : `update ${preferred} ${fallbackHighlight}`)
			: (state.lang === 'zh' ? `更新 ${preferred}` : `update ${preferred}`);
		return applySubjectStyle(subject, promptConfig);
	}

	let subject = '';
	if (requiredTokenCount > 1 && (secondaryFragment || tokens.length >= 2)) {
		const secondPair = secondaryFragment || tokens[1];
		subject = state.lang === 'zh'
			? `更新 ${primaryFragment} 与 ${secondPair}`
			: `update ${primaryFragment} and ${secondPair}`;
		return applySubjectStyle(
			minSubjectLength > 0
				? ensureSubjectLength(subject, diff, requiredTokens, promptConfig, minSubjectLength)
				: subject,
			promptConfig
		);
	}
	subject = state.lang === 'zh' ? `更新 ${primaryFragment}` : `update ${primaryFragment}`;
	return applySubjectStyle(
		minSubjectLength > 0
			? ensureSubjectLength(subject, diff, requiredTokens, promptConfig, minSubjectLength)
			: subject,
		promptConfig
	);
}

function applySubjectStyle(subject: string, promptConfig: PromptConfig): string {
	if (promptConfig.subjectStyle === 'sentence' && state.lang === 'en') {
		return subject.charAt(0).toUpperCase() + subject.slice(1);
	}
	return subject;
}

function formatCommitLine(type: string, scope: string, subject: string): string {
	const cleanSubject = subject.replace(/\s+/g, ' ').trim();
	const prefix = `${type}(${scope}): `;
	return `${prefix}${cleanSubject}`;
}

function buildRequiredTokens(files: FileSummary[]): string[] {
	const tokens: string[] = [];
	for (const file of files) {
		const parts = file.path.split('/');
		const base = parts[parts.length - 1];
		const topDir = parts.length > 1 ? parts[0] : '';
		if (base) {
			tokens.push(base);
		}
		for (const keyword of (file.keywords ?? []).slice(0, 2)) {
			if (keyword) {
				tokens.push(keyword);
			}
		}
		for (const label of file.context.slice(0, 2)) {
			if (label) {
				tokens.push(label);
			}
		}
		if (topDir && topDir !== base) {
			tokens.push(topDir);
		}
	}
	const seen = new Set<string>();
	return tokens.filter(token => {
		const normalized = token.toLowerCase();
		if (seen.has(normalized)) {
			return false;
		}
		seen.add(normalized);
		return token.length > 1;
	});
}

function normalizeForMatch(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function expandTokenVariants(token: string): string[] {
	const variants = new Set<string>();
	const trimmed = token.trim();
	if (!trimmed) {
		return [];
	}
	variants.add(trimmed);
	const stripped = trimmed.replace(/^[.#/]+/, '');
	if (stripped && stripped !== trimmed) {
		variants.add(stripped);
	}
	const base = trimmed.split('/').pop() ?? trimmed;
	if (base && base !== trimmed) {
		variants.add(base);
	}
	const noExt = base.replace(/\.[a-z0-9]+$/i, '');
	if (noExt && noExt !== base) {
		variants.add(noExt);
	}
	return [...variants];
}

function matchRequiredTokens(subject: string, tokens: string[], requiredCount: number): { ok: boolean; matchedTokens: string[] } {
	if (tokens.length === 0) {
		return { ok: true, matchedTokens: [] };
	}
	const normalizedSubject = normalizeForMatch(subject);
	const matchedTokens: string[] = [];
	const seen = new Set<string>();
	for (const token of tokens) {
		const variants = expandTokenVariants(token);
		for (const variant of variants) {
			const normalizedVariant = normalizeForMatch(variant);
			if (normalizedVariant.length < 3) {
				continue;
			}
			if (normalizedVariant && normalizedSubject.includes(normalizedVariant)) {
				if (!seen.has(token)) {
					seen.add(token);
					matchedTokens.push(token);
				}
				break;
			}
		}
	}
	const minCount = Math.max(1, requiredCount);
	return { ok: matchedTokens.length >= minCount, matchedTokens };
}

function containsDiffStats(subject: string): boolean {
	return /\(\+\d+\/-\d+\)|\+\d+\/-\d+|files changed|lines:/i.test(subject);
}

function stripSubjectNoise(subject: string): string {
	return subject
		.replace(/\(\+\d+\/-\d+\)/g, '')
		.replace(/\+\d+\/-\d+/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

function buildSubjectFragment(file: FileSummary): string {
	const base = file.path.split('/').pop() ?? file.path;
	const details: string[] = [];
	const keyword = (file.keywords?.[0] ?? '').trim();
	if (keyword) {
		details.push(keyword);
	}
	const context = (file.context?.[0] ?? '').trim();
	if (context && details.length < 2) {
		details.push(context);
	}
	const highlight = file.highlights?.find(item => !isGenericHighlight(item));
	const cleanedHighlight = highlight ? normalizeHighlight(highlight) : '';
	if (cleanedHighlight && details.length < 2) {
		details.push(cleanedHighlight);
	}
	if (details.length < 2) {
		const fallbackAction = inferDefaultAction(file.path);
		if (fallbackAction) {
			details.push(fallbackAction);
		}
	}
	return `${base} ${details.join(' ')}`.trim();
}

function ensureSubjectLength(
	subject: string,
	diff: PreprocessResult,
	requiredTokens: string[],
	promptConfig: PromptConfig,
	minLength: number
): string {
	if (minLength <= 0 || subject.length >= minLength) {
		return subject;
	}
	const fragments = buildDetailFragments(diff);
	const tokenSnippet = requiredTokens.length ? ` ${requiredTokens.slice(0, 6).join(', ')}` : '';
	const detailText = fragments.length ? fragments.join(state.lang === 'zh' ? '；' : '; ') : '';
	const prefix = state.lang === 'zh' ? '，涉及：' : ' — details: ';
	let expanded = `${subject}${prefix}${detailText}${tokenSnippet}`.replace(/\s+/g, ' ').trim();
	if (expanded.length < minLength && fragments.length > 2) {
		const extra = fragments.slice(0, 4).join(state.lang === 'zh' ? '；' : '; ');
		expanded = `${subject}${prefix}${extra}${tokenSnippet}`.replace(/\s+/g, ' ').trim();
	}
	return expanded;
}

function buildDetailFragments(diff: PreprocessResult): string[] {
	const rankedFiles = [...diff.files].sort((a, b) => {
		const scoreA = (a.additions + a.deletions) || a.weight || 0;
		const scoreB = (b.additions + b.deletions) || b.weight || 0;
		return scoreB - scoreA;
	});
	const fragments: string[] = [];
	for (const file of rankedFiles.slice(0, 5)) {
		const fragment = buildSubjectFragment(file);
		if (fragment) {
			fragments.push(fragment);
		}
	}
	return fragments;
}

function inferDefaultAction(filePath: string): string {
	const lower = filePath.toLowerCase();
	if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) {
		return 'styles';
	}
	if (
		lower.includes('cmake') ||
		lower.includes('makefile') ||
		lower.startsWith('build/') ||
		lower.includes('/build/')
	) {
		return 'build config';
	}
	if (lower.includes('docs') || lower.includes('readme') || lower.endsWith('.md')) {
		return 'docs';
	}
	return '';
}

function pickHighlight(diff: PreprocessResult): string | null {
	const top = diff.files[0];
	const highlight = top?.highlights?.find(item => !isGenericHighlight(item)) ?? '';
	if (!highlight) {
		return null;
	}
	return normalizeHighlight(highlight);
}

function normalizeHighlight(highlight: string): string {
	const cleaned = highlight
		.replace(/\bupdated\b/gi, '')
		.replace(/\btouched\b/gi, '')
		.replace(/\bfile\b/gi, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
	return cleaned || highlight;
}

function generateFallbackMessage(diff: PreprocessResult, promptConfig: PromptConfig): string {
	const topFile = diff.files[0];
	const scope = topFile ? deriveScope(topFile.path) : 'repo';
	const type = deriveType(diff);
	const subject = deriveDetailedSubject(diff, promptConfig);
	return `${type}(${scope}): ${subject}`;
}

function applyPromptConfig(message: string, promptConfig: PromptConfig): string {
	const withPrefix = promptConfig.prefix ? `${promptConfig.prefix} ${message}`.trim() : message.trim();
	const withSuffix = promptConfig.suffix ? `${withPrefix} ${promptConfig.suffix}`.trim() : withPrefix;
	return withSuffix;
}

function deriveDetailedSubject(diff: PreprocessResult, promptConfig: PromptConfig): string {
	const topFile = diff.files[0];
	const topHighlight = topFile?.highlights?.[0] ?? '';
	const topContext = topFile?.context?.[0];
	const fileBase = topFile ? topFile.path.split('/').pop() ?? topFile.path : 'repo';
	let subject = '';

	if (topHighlight && !isGenericHighlight(topHighlight)) {
		subject = topContext ? `${topHighlight} in ${topContext}` : topHighlight;
	} else if (topContext) {
		subject = `update ${topContext}`;
	} else if (topFile) {
		subject = `update ${fileBase}`;
	} else {
		subject = 'update implementation';
	}

	return applySubjectStyle(subject, promptConfig);
}

function isGenericHighlight(highlight: string): boolean {
	return /updated implementation details|update logic|logic updated/i.test(highlight);
}

function deriveType(diff: PreprocessResult) {
	const weights = { test: 0, docs: 0, config: 0, code: 0 };
	let total = 0;
	for (const file of diff.files) {
		const weight = (file.additions + file.deletions) || file.weight || 1;
		total += weight;
		const lower = file.path.toLowerCase();
		if (/test|spec/.test(lower)) {
			weights.test += weight;
			continue;
		}
		if (lower.includes('docs') || lower.includes('readme') || lower.endsWith('.md')) {
			weights.docs += weight;
			continue;
		}
		if (
			lower.includes('config') ||
			lower.endsWith('.yml') ||
			lower.endsWith('.yaml') ||
			lower.endsWith('.json') ||
			lower.endsWith('.toml') ||
			lower.endsWith('.ini') ||
			lower.includes('cmake') ||
			lower.includes('makefile') ||
			lower.startsWith('dist/') ||
			lower.includes('/dist/') ||
			lower.startsWith('build/') ||
			lower.includes('/build/')
		) {
			weights.config += weight;
			continue;
		}
		weights.code += weight;
	}

	const ratio = (value: number) => (total > 0 ? value / total : 0);
	if (ratio(weights.test) > 0.5) {
		return 'test';
	}
	if (ratio(weights.docs) > 0.5) {
		return 'docs';
	}
	if (ratio(weights.config) > 0.5) {
		return 'chore';
	}
	if (diff.totalDeletions > diff.totalAdditions) {
		return 'refactor';
	}
	return 'feat';
}

function deriveScope(filePath: string) {
	const parts = filePath.split('/');
	return parts.length > 1 ? parts[0] : 'core';
}

function deriveSubject(diff: PreprocessResult, promptConfig: PromptConfig) {
	const top = diff.files[0];
	const highlights = top?.highlights?.[0] ?? 'update logic';
	const context = top?.context?.[0];
	let subject = context ? `${highlights} in ${context}` : highlights;
	if (promptConfig.subjectStyle === 'sentence') {
		subject = subject.charAt(0).toUpperCase() + subject.slice(1);
	}
	return subject;
}

function postFilter(message: string): string | null {
	if (/(.)\1{6,}/.test(message)) {
		showDialog(t('repetitive'));
		return null;
	}
	if (/\b(\w+)\b(?:\s+\1\b){3,}/i.test(message)) {
		showDialog(t('repetitive'));
		return null;
	}
	return message;
}

function setOverlay(visible: boolean) {
	elements.progressOverlay.classList.toggle('hidden', !visible);
}

async function showDialog(message: string, options?: { confirmLabel?: string; cancelLabel?: string }) {
	elements.dialogMessage.textContent = message;
	elements.dialogConfirm.textContent = options?.confirmLabel ?? t('dialogConfirm');
	elements.dialogCancel.textContent = options?.cancelLabel ?? t('dialogCancel');
	elements.dialog.classList.remove('hidden');
	return new Promise<boolean>(resolve => {
		const cleanup = () => {
			elements.dialog.classList.add('hidden');
			elements.dialogConfirm.removeEventListener('click', confirm);
			elements.dialogCancel.removeEventListener('click', cancel);
		};
		const confirm = () => {
			cleanup();
			resolve(true);
		};
		const cancel = () => {
			cleanup();
			resolve(false);
		};
		elements.dialogConfirm.addEventListener('click', confirm);
		elements.dialogCancel.addEventListener('click', cancel);
	});
}

async function copyCommit() {
	const value = elements.commitOutput.value.trim();
	if (!value) {
		return;
	}
	try {
		await navigator.clipboard.writeText(value);
		showDialog(t('copied'), { confirmLabel: t('dialogConfirm'), cancelLabel: t('dialogCancel') });
	} catch {
		elements.commitOutput.select();
		document.execCommand('copy');
	}
}

function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('smartCommit', 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains('models')) {
				db.createObjectStore('models');
			}
			if (!db.objectStoreNames.contains('configs')) {
				db.createObjectStore('configs');
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function getCache(key: string) {
	const db = await openDb();
	return new Promise<unknown>(resolve => {
		const tx = db.transaction('models', 'readonly');
		const store = tx.objectStore('models');
		const request = store.get(key);
		request.onsuccess = () => resolve(request.result ?? null);
		request.onerror = () => resolve(null);
	});
}

async function setCache(key: string, value: unknown) {
	const db = await openDb();
	return new Promise<void>(resolve => {
		const tx = db.transaction('models', 'readwrite');
		const store = tx.objectStore('models');
		store.put(value, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => resolve();
	});
}

type CachedConfig = { savedAt: number; value: PromptConfig };

async function getConfig(key: string): Promise<CachedConfig | null> {
	const db = await openDb();
	return new Promise(resolve => {
		const tx = db.transaction('configs', 'readonly');
		const store = tx.objectStore('configs');
		const request = store.get(key);
		request.onsuccess = () => resolve((request.result as CachedConfig) ?? null);
		request.onerror = () => resolve(null);
	});
}

async function setConfig(key: string, value: CachedConfig) {
	const db = await openDb();
	return new Promise<void>(resolve => {
		const tx = db.transaction('configs', 'readwrite');
		const store = tx.objectStore('configs');
		store.put(value, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => resolve();
	});
}
