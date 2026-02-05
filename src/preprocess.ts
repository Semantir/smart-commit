import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type FileSummary = {
	path: string;
	changeType: 'added' | 'deleted' | 'modified' | 'renamed' | 'binary';
	additions: number;
	deletions: number;
	context: string[];
	highlights: string[];
	keywords: string[];
	weight: number;
};

export type PreprocessResult = {
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

const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json']);

const LANGUAGE_WEIGHT: Record<string, { patterns: Array<{ regex: RegExp; weight: number; label: string }> }> = {
	ts: {
		patterns: [
			{ regex: /\binterface\s+\w+/g, weight: 3, label: 'interface' },
			{ regex: /\btype\s+\w+\s*=/g, weight: 2, label: 'type' },
			{ regex: /\bclass\s+\w+/g, weight: 2, label: 'class' },
			{ regex: /\bfunction\s+\w+\s*\(/g, weight: 1, label: 'function' },
			{ regex: /\bconst\s+\w+\s*=\s*\(/g, weight: 1, label: 'const fn' },
		],
	},
	js: {
		patterns: [
			{ regex: /\bclass\s+\w+/g, weight: 2, label: 'class' },
			{ regex: /\bfunction\s+\w+\s*\(/g, weight: 1, label: 'function' },
			{ regex: /\bconst\s+\w+\s*=\s*\(/g, weight: 1, label: 'const fn' },
			{ regex: /\bexport\s+(?:function|const|class)\s+\w+/g, weight: 1, label: 'export' },
		],
	},
	py: {
		patterns: [
			{ regex: /\bclass\s+\w+/g, weight: 3, label: 'class' },
			{ regex: /\bdef\s+\w+\s*\(/g, weight: 2, label: 'def' },
		],
	},
	rs: {
		patterns: [
			{ regex: /\btrait\s+\w+/g, weight: 3, label: 'trait' },
			{ regex: /\bstruct\s+\w+/g, weight: 2, label: 'struct' },
			{ regex: /\benum\s+\w+/g, weight: 2, label: 'enum' },
			{ regex: /\bimpl\s+\w+/g, weight: 1, label: 'impl' },
			{ regex: /\bfn\s+\w+\s*\(/g, weight: 1, label: 'fn' },
		],
	},
	cpp: {
		patterns: [
			{ regex: /\bclass\s+\w+/g, weight: 2, label: 'class' },
			{ regex: /\bstruct\s+\w+/g, weight: 2, label: 'struct' },
			{ regex: /\benum\s+\w+/g, weight: 2, label: 'enum' },
			{ regex: /\bnamespace\s+\w+/g, weight: 1, label: 'namespace' },
			{ regex: /^\s*(?:[\w:<>~*&]+\s+)+\w+\s*\(/gm, weight: 1, label: 'function' },
		],
	},
	c: {
		patterns: [
			{ regex: /\bstruct\s+\w+/g, weight: 2, label: 'struct' },
			{ regex: /\benum\s+\w+/g, weight: 2, label: 'enum' },
			{ regex: /^\s*(?:[\w_*]+\s+)+\w+\s*\(/gm, weight: 1, label: 'function' },
		],
	},
	cmake: {
		patterns: [
			{ regex: /\badd_library\s*\(/g, weight: 2, label: 'library' },
			{ regex: /\badd_executable\s*\(/g, weight: 2, label: 'executable' },
			{ regex: /\btarget_link_libraries\s*\(/g, weight: 1, label: 'linkage' },
			{ regex: /\bset\s*\(/g, weight: 1, label: 'config' },
		],
	},
};

const CONTEXT_PATTERNS: Record<string, RegExp[]> = {
	ts: [
		/\bexport\s+const\s+(\w+)\b/, 
		/\bconst\s+(\w+)\s*=\s*\(/,
		/\bfunction\s+(\w+)\b/,
		/\bclass\s+(\w+)\b/,
		/\binterface\s+(\w+)\b/,
		/\btype\s+(\w+)\b/,
	],
	js: [
		/\bexport\s+const\s+(\w+)\b/,
		/\bconst\s+(\w+)\s*=\s*\(/,
		/\bfunction\s+(\w+)\b/,
		/\bclass\s+(\w+)\b/,
	],
	py: [
		/^\s*def\s+(\w+)\b/,
		/^\s*class\s+(\w+)\b/,
	],
	rs: [
		/^\s*fn\s+(\w+)\b/,
		/^\s*struct\s+(\w+)\b/,
		/^\s*enum\s+(\w+)\b/,
		/^\s*trait\s+(\w+)\b/,
		/^\s*impl\s+(\w+)\b/,
	],
	cpp: [
		/^\s*class\s+(\w+)\b/,
		/^\s*struct\s+(\w+)\b/,
		/^\s*enum\s+(\w+)\b/,
		/^\s*namespace\s+(\w+)\b/,
		/^\s*(?:[\w:<>~*&]+\s+)+(\w+)\s*\(/,
	],
	c: [
		/^\s*struct\s+(\w+)\b/,
		/^\s*enum\s+(\w+)\b/,
		/^\s*(?:[\w_*]+\s+)+(\w+)\s*\(/,
	],
	cmake: [
		/^\s*project\(([^)\s]+)/i,
		/^\s*add_library\(([^)\s]+)/i,
		/^\s*add_executable\(([^)\s]+)/i,
		/^\s*set\(([^)\s]+)/i,
	],
};

export async function preprocessDiff(repoRoot: string, diff: string, maxChars = 28000): Promise<PreprocessResult> {
	const fileBlocks = diff.split(/^diff --git /m).filter(Boolean).map(block => 'diff --git ' + block);
	const summaries: FileSummary[] = [];
	const lockfileSummaries: string[] = [];
	const languageSignals: Record<string, number> = {};
	let totalAdditions = 0;
	let totalDeletions = 0;

	for (const block of fileBlocks) {
		const fileSummary = await summarizeFileBlock(repoRoot, block);
		if (!fileSummary) {
			continue;
		}
		if (LOCKFILES.has(path.basename(fileSummary.path))) {
			lockfileSummaries.push(...summarizeLockfile(block, fileSummary.path));
			continue;
		}
		summaries.push(fileSummary);
		totalAdditions += fileSummary.additions;
		totalDeletions += fileSummary.deletions;
		const lang = detectLang(fileSummary.path);
		if (lang) {
			languageSignals[lang] = (languageSignals[lang] ?? 0) + fileSummary.weight;
		}
	}

	const summaryText = formatSummaryText(summaries, lockfileSummaries, totalAdditions, totalDeletions);
	const truncated = diff.length > maxChars;
	const rawDiff = truncated ? diff.slice(0, maxChars) + '\n...diff truncated...' : diff;

	return {
		repoRoot,
		files: summaries,
		lockfileSummaries,
		languageSignals,
		summaryText,
		rawDiff,
		truncated,
		totalAdditions,
		totalDeletions,
	};
}

async function summarizeFileBlock(repoRoot: string, block: string): Promise<FileSummary | null> {
	const pathLine = block.match(/^\+\+\+ b\/(.+)$/m) ?? block.match(/^\+\+\+ \/dev\/null/m);
	const removedLine = block.match(/^--- a\/(.+)$/m) ?? block.match(/^--- \/dev\/null/m);
	let filePath = '';
	if (pathLine && pathLine[1]) {
		filePath = pathLine[1].trim();
	} else if (removedLine && removedLine[1]) {
		filePath = removedLine[1].trim();
	}
	if (!filePath) {
		return null;
	}

	const changeType = detectChangeType(block);
	if (changeType === 'binary') {
		return {
			path: filePath,
			changeType,
			additions: 0,
			deletions: 0,
			context: [],
			highlights: ['binary file updated'],
			keywords: [],
			weight: 1,
		};
	}

	const { additions, deletions, cleanedLines, hunkStarts, addedLines, removedLines } = parseDiffLines(block);
	const contextLabels = await findContextLabels(repoRoot, filePath, hunkStarts);
	const keywords = extractKeywords(filePath, addedLines, removedLines);
	const highlights = computeHighlights(filePath, cleanedLines, changeType);
	const weight = computeWeight(filePath, cleanedLines);

	return {
		path: filePath,
		changeType,
		additions,
		deletions,
		context: contextLabels,
		highlights,
		keywords,
		weight,
	};
}

function detectChangeType(block: string): FileSummary['changeType'] {
	if (/^new file mode/m.test(block)) {
		return 'added';
	}
	if (/^deleted file mode/m.test(block)) {
		return 'deleted';
	}
	if (/^rename from/m.test(block)) {
		return 'renamed';
	}
	if (/^Binary files/m.test(block)) {
		return 'binary';
	}
	return 'modified';
}

function parseDiffLines(block: string) {
	const lines = block.split('\n');
	let additions = 0;
	let deletions = 0;
	const cleanedLines: string[] = [];
	const removed: string[] = [];
	const added: string[] = [];
	const hunkStarts: number[] = [];

	for (const line of lines) {
		if (line.startsWith('@@')) {
			const match = /\+([0-9]+)(?:,([0-9]+))?/.exec(line);
			if (match) {
				hunkStarts.push(Number(match[1]));
			}
			continue;
		}
		if (line.startsWith('+++') || line.startsWith('---')) {
			continue;
		}
		if (line.startsWith('+')) {
			additions += 1;
			added.push(line.slice(1));
			continue;
		}
		if (line.startsWith('-')) {
			deletions += 1;
			removed.push(line.slice(1));
			continue;
		}
	}

	const removedSet = new Map<string, number>();
	for (const line of removed) {
		const key = normalizeLine(line);
		removedSet.set(key, (removedSet.get(key) ?? 0) + 1);
	}

	for (const line of added) {
		const key = normalizeLine(line);
		const count = removedSet.get(key);
		if (count && count > 0) {
			removedSet.set(key, count - 1);
			continue;
		}
		cleanedLines.push(line);
	}
	for (const [line, count] of removedSet.entries()) {
		if (count > 0) {
			cleanedLines.push(`-${line}`);
		}
	}

	return { additions, deletions, cleanedLines, hunkStarts, addedLines: added, removedLines: removed };
}

function normalizeLine(line: string): string {
	return line.replace(/\s+/g, ' ').trim();
}

async function findContextLabels(repoRoot: string, filePath: string, hunkStarts: number[]): Promise<string[]> {
	const lang = detectLang(filePath);
	if (!lang) {
		return [];
	}
	const fullPath = path.join(repoRoot, filePath);
	try {
		const content = await fs.readFile(fullPath, 'utf8');
		const lines = content.split(/\r?\n/);
		const patterns = CONTEXT_PATTERNS[lang] ?? [];
		const labels = new Set<string>();
		for (const start of hunkStarts) {
			const label = findNearestLabel(lines, start - 1, patterns);
			if (label) {
				labels.add(label);
			}
		}
		return [...labels].slice(0, 4);
	} catch {
		return [];
	}
}

function findNearestLabel(lines: string[], index: number, patterns: RegExp[]): string | null {
	for (let i = index; i >= 0; i -= 1) {
		const line = lines[i];
		for (const pattern of patterns) {
			const match = pattern.exec(line);
			if (match?.[1]) {
				return match[1];
			}
		}
	}
	return null;
}

function detectLang(filePath: string): 'ts' | 'js' | 'py' | 'rs' | 'cpp' | 'c' | 'cmake' | null {
	const lower = filePath.toLowerCase();
	if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
		return 'ts';
	}
	if (lower.endsWith('.js') || lower.endsWith('.jsx')) {
		return 'js';
	}
	if (lower.endsWith('.py')) {
		return 'py';
	}
	if (lower.endsWith('.rs')) {
		return 'rs';
	}
	if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx') || lower.endsWith('.hpp') || lower.endsWith('.hxx')) {
		return 'cpp';
	}
	if (lower.endsWith('.c') || lower.endsWith('.h')) {
		return 'c';
	}
	if (lower.endsWith('cmakelists.txt') || lower.endsWith('.cmake')) {
		return 'cmake';
	}
	return null;
}

function computeWeight(filePath: string, cleanedLines: string[]): number {
	const lang = detectLang(filePath);
	if (!lang) {
		return 1;
	}
	const patterns = LANGUAGE_WEIGHT[lang]?.patterns ?? [];
	let weight = 0;
	for (const line of cleanedLines) {
		for (const pattern of patterns) {
			const matches = line.match(pattern.regex);
			if (matches) {
				weight += matches.length * pattern.weight;
			}
		}
	}
	return Math.max(weight, 1);
}

function computeHighlights(
	filePath: string,
	cleanedLines: string[],
	changeType: FileSummary['changeType']
): string[] {
	const highlights: string[] = [];
	const seen = new Set<string>();
	const addHighlight = (value: string | null) => {
		if (!value || seen.has(value)) {
			return;
		}
		seen.add(value);
		highlights.push(value);
	};

	for (const hint of inferPathHighlights(filePath)) {
		addHighlight(hint);
	}

	for (const hint of inferContentHighlights(cleanedLines)) {
		addHighlight(hint);
	}

	const changeHint = changeType === 'added'
		? 'new file added'
		: changeType === 'deleted'
			? 'file removed'
			: changeType === 'renamed'
				? 'file renamed'
				: null;
	addHighlight(changeHint);

	if (highlights.length === 0 && cleanedLines.length > 0) {
		const base = path.basename(filePath);
		addHighlight(base ? `update ${base}` : 'update file');
	}

	return highlights.slice(0, 3);
}

function extractKeywords(filePath: string, addedLines: string[], removedLines: string[]): string[] {
	const keywords: string[] = [];
	const seen = new Set<string>();
	const addKeyword = (value: string | null) => {
		if (!value) {
			return;
		}
		const trimmed = value.trim();
		if (!trimmed) {
			return;
		}
		const normalized = trimmed.toLowerCase();
		if (seen.has(normalized)) {
			return;
		}
		seen.add(normalized);
		keywords.push(trimmed);
	};
	const lines = [...addedLines, ...removedLines].map(line => line.trim()).filter(Boolean);
	if (lines.length === 0) {
		return [];
	}
	const sample = lines.slice(0, 200);
	const joined = sample.join('\n');
	const lower = joined.toLowerCase();
	const lowerPath = filePath.toLowerCase();
	const isCss = lowerPath.endsWith('.css') || lowerPath.endsWith('.scss') || lowerPath.endsWith('.sass') || lowerPath.endsWith('.less');

	if (isCss) {
		const selectorMatches = joined.match(/[.#][a-zA-Z0-9_-]{2,}/g) ?? [];
		for (const selector of selectorMatches) {
			addKeyword(selector);
			if (keywords.length >= 3) {
				return keywords;
			}
		}
		const cssHints = [
			'grid',
			'flex',
			'font',
			'color',
			'layout',
			'gap',
			'spacing',
			'padding',
			'margin',
			'background',
			'shadow',
			'border',
			'radius',
			'animation',
			'transform',
			'transition',
		];
		for (const hint of cssHints) {
			if (lower.includes(hint)) {
				addKeyword(hint);
				if (keywords.length >= 3) {
					return keywords;
				}
			}
		}
	}

	const lang = detectLang(filePath);
	if (lang === 'ts' || lang === 'js') {
		const patterns = [
			/\bexport\s+(?:const|function|class|interface|type|enum)\s+([A-Za-z_]\w*)/g,
			/\bclass\s+([A-Za-z_]\w*)/g,
			/\bfunction\s+([A-Za-z_]\w*)/g,
			/\bconst\s+([A-Za-z_]\w*)\s*=/g,
			/\btype\s+([A-Za-z_]\w*)\s*=/g,
			/\binterface\s+([A-Za-z_]\w*)\b/g,
		];
		for (const pattern of patterns) {
			for (const match of joined.matchAll(pattern)) {
				addKeyword(match[1]);
				if (keywords.length >= 3) {
					return keywords;
				}
			}
		}
	}

	if (lang === 'cpp' || lang === 'c') {
		const patterns = [
			/\bnamespace\s+([A-Za-z_]\w*)/g,
			/\bclass\s+([A-Za-z_]\w*)/g,
			/\bstruct\s+([A-Za-z_]\w*)/g,
			/\benum\s+([A-Za-z_]\w*)/g,
			/^\s*(?:[\w:<>~*&]+\s+)+([A-Za-z_]\w*)\s*\(/gm,
		];
		for (const pattern of patterns) {
			for (const match of joined.matchAll(pattern)) {
				addKeyword(match[1]);
				if (keywords.length >= 3) {
					return keywords;
				}
			}
		}
	}

	if (lang === 'cmake') {
		const patterns = [
			/\badd_library\s*\(\s*([^\s\)]+)/gi,
			/\badd_executable\s*\(\s*([^\s\)]+)/gi,
			/\btarget_link_libraries\s*\(\s*([^\s\)]+)/gi,
			/\bset\s*\(\s*([^\s\)]+)/gi,
		];
		for (const pattern of patterns) {
			for (const match of joined.matchAll(pattern)) {
				addKeyword(match[1]);
				if (keywords.length >= 3) {
					return keywords;
				}
			}
		}
	}

	return keywords.slice(0, 3);
}

function inferPathHighlights(filePath: string): string[] {
	const lower = filePath.toLowerCase();
	const base = path.basename(lower);
	const ext = path.extname(lower);
	const results: string[] = [];

	if (base === '.gitignore') {
		results.push('gitignore rules updated');
	}
	if (base === 'cmakelists.txt' || ext === '.cmake') {
		results.push('cmake config updated');
	}
	if (lower.includes('/dist/') || lower.startsWith('dist/')) {
		results.push('distribution bundle updated');
	}
	if (lower.includes('/build/') || lower.startsWith('build/')) {
		results.push('build output updated');
	}
	if (base === 'package.json') {
		results.push('package metadata updated');
	}
	if (lower.includes('webpack') || lower.includes('rollup') || lower.includes('vite') || lower.includes('esbuild')) {
		results.push('build config updated');
	}
	if (lower.includes('eslint') || lower.includes('prettier')) {
		results.push('linting config updated');
	}
	if (lower.includes('test') || lower.includes('spec')) {
		results.push('tests updated');
	}
	if (ext === '.md' || lower.includes('readme')) {
		results.push('docs updated');
	}
	if (ext === '.json' || ext === '.yml' || ext === '.yaml' || ext === '.toml') {
		results.push('config updated');
	}
	if (ext === '.cpp' || ext === '.cc' || ext === '.cxx' || ext === '.hpp' || ext === '.hxx' || ext === '.c' || ext === '.h') {
		results.push('c/c++ sources updated');
	}
	if (ext === '.js' || ext === '.jsx') {
		results.push('javascript sources updated');
	}
	if (ext === '.ts' || ext === '.tsx') {
		results.push('typescript sources updated');
	}

	const topDir = filePath.split('/')[0];
	const baseName = path.basename(filePath, ext);
	if (topDir && topDir !== baseName && topDir !== base) {
		results.push(`${topDir} module updated`);
	}

	return results;
}

function inferContentHighlights(cleanedLines: string[]): string[] {
	const results: string[] = [];
	if (cleanedLines.length === 0) {
		return results;
	}
	const joined = cleanedLines.join('\n');
	const lower = joined.toLowerCase();

	if (lower.includes('add_library') || lower.includes('add_executable') || lower.includes('target_link_libraries')) {
		results.push('build targets updated');
	}
	if (lower.includes('#include')) {
		results.push('includes updated');
	}
	if (/\bnamespace\s+\w+/i.test(joined)) {
		results.push('namespace updated');
	}
	if (/\bclass\s+\w+/i.test(joined) || /\bstruct\s+\w+/i.test(joined)) {
		results.push('type definitions updated');
	}
	if (/\bexport\s+(?:function|const|class)\s+/i.test(joined) || /\bmodule\.exports\b/i.test(joined)) {
		results.push('exports updated');
	}
	if (/\bfix|bug|issue|crash|null pointer/i.test(lower)) {
		results.push('bug fix');
	}
	if (/\bperf|optimi[sz]e|latency|cache/i.test(lower)) {
		results.push('performance update');
	}

	return results;
}

function summarizeLockfile(block: string, filePath: string): string[] {
	const basename = path.basename(filePath);
	const lines = block.split('\n');
	let addVersions = 0;
	let removeVersions = 0;
	const packages = new Set<string>();

	for (const line of lines) {
		if (line.startsWith('+') || line.startsWith('-')) {
			const trimmed = line.slice(1);
			if (/version:/i.test(trimmed) || /"version"\s*:/i.test(trimmed)) {
				if (line.startsWith('+')) {
					addVersions += 1;
				}
				if (line.startsWith('-')) {
					removeVersions += 1;
				}
			}
			const pkgMatch = trimmed.match(/\/(.+?)@/);
			if (pkgMatch?.[1]) {
				packages.add(pkgMatch[1]);
			}
		}
	}

	const totalUpdates = Math.max(addVersions, removeVersions, packages.size);
	if (totalUpdates === 0) {
		return [`${basename}: lockfile updated`];
	}
	const pkgSnippet = packages.size > 0 ? ` (${[...packages].slice(0, 3).join(', ')}${packages.size > 3 ? ', ...' : ''})` : '';
	return [`${basename}: ${totalUpdates} version entries updated${pkgSnippet}`];
}

function formatSummaryText(files: FileSummary[], lockfileSummaries: string[], totalAdditions: number, totalDeletions: number): string {
	const lines: string[] = [];
	lines.push(`Files changed: ${files.length}${lockfileSummaries.length ? ` (+${lockfileSummaries.length} lockfile)` : ''}`);
	lines.push(`Lines: +${totalAdditions} / -${totalDeletions}`);
	for (const file of files.slice(0, 6)) {
		const changeTag = file.changeType !== 'modified' ? ` (${file.changeType})` : '';
		const context = file.context.length ? ` in ${file.context.join(', ')}` : '';
		const highlights = file.highlights.length ? ` - ${file.highlights.join(', ')}` : '';
		lines.push(`${file.path}${changeTag}${context} (+${file.additions}/-${file.deletions})${highlights}`);
	}
	for (const lock of lockfileSummaries) {
		lines.push(lock);
	}
	if (files.length > 6) {
		lines.push(`...and ${files.length - 6} more files`);
	}
	return lines.join('\n');
}
