import * as vscode from 'vscode';

export type AnalyticsState = {
	totalGenerated: number;
	commitAccepted: number;
	modelLatencyMs: number[];
	downloadTimesMs: number[];
	renderers: Record<string, number>;
};

const DEFAULT_STATE: AnalyticsState = {
	totalGenerated: 0,
	commitAccepted: 0,
	modelLatencyMs: [],
	downloadTimesMs: [],
	renderers: {},
};

const STORAGE_KEY = 'smartCommit.analytics';

export async function readAnalytics(context: vscode.ExtensionContext): Promise<AnalyticsState> {
	return context.globalState.get<AnalyticsState>(STORAGE_KEY, DEFAULT_STATE);
}

export async function updateAnalytics(
	context: vscode.ExtensionContext,
	updater: (current: AnalyticsState) => AnalyticsState
): Promise<AnalyticsState> {
	const current = await readAnalytics(context);
	const next = updater({ ...DEFAULT_STATE, ...current });
	await context.globalState.update(STORAGE_KEY, next);
	return next;
}

export function recordGeneration(state: AnalyticsState): AnalyticsState {
	return { ...state, totalGenerated: state.totalGenerated + 1 };
}

export function recordAccepted(state: AnalyticsState): AnalyticsState {
	return { ...state, commitAccepted: state.commitAccepted + 1 };
}

export function recordLatency(state: AnalyticsState, ms: number): AnalyticsState {
	return { ...state, modelLatencyMs: [...state.modelLatencyMs, ms].slice(-100) };
}

export function recordDownloadTime(state: AnalyticsState, ms: number): AnalyticsState {
	return { ...state, downloadTimesMs: [...state.downloadTimesMs, ms].slice(-100) };
}

export function recordRenderer(state: AnalyticsState, renderer: string): AnalyticsState {
	const renderers = { ...state.renderers };
	renderers[renderer] = (renderers[renderer] ?? 0) + 1;
	return { ...state, renderers };
}
