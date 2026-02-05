import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export type RepoInfo = {
	id: string;
	name: string;
	root: string;
	hasStaged: boolean;
};

export async function discoverRepos(): Promise<RepoInfo[]> {
	const roots = await getWorkspaceGitRoots();
	const repos: RepoInfo[] = [];
	for (const root of roots) {
		const hasStaged = await hasStagedChanges(root);
		repos.push({
			id: toRepoId(root),
			name: root.split('/').pop() ?? root,
			root,
			hasStaged,
		});
	}
	return repos;
}

export async function hasStagedChanges(repoRoot: string): Promise<boolean> {
	try {
		const stdout = await runGit(repoRoot, ['diff', '--cached', '--name-only']);
		return stdout.trim().length > 0;
	} catch {
		return false;
	}
}

export async function getStagedDiff(repoRoot: string): Promise<string> {
	return runGit(repoRoot, ['diff', '--cached', '--patch', '--unified=4', '--no-color']);
}

export async function getStagedNameStatus(repoRoot: string): Promise<string> {
	return runGit(repoRoot, ['diff', '--cached', '--name-status']);
}

export async function getStatusSummary(repoRoot: string): Promise<string> {
	return runGit(repoRoot, ['status', '-sb']);
}

export async function getRecentCommitSubjects(repoRoot: string, limit = 20): Promise<string[]> {
	const stdout = await runGit(repoRoot, ['log', `-n`, String(limit), '--pretty=format:%s']);
	return stdout
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean);
}

export async function getWorkspaceGitRoots(): Promise<string[]> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	const roots = new Set<string>();
	for (const folder of folders) {
		try {
			const stdout = await runGit(folder.uri.fsPath, ['rev-parse', '--show-toplevel']);
			if (stdout.trim()) {
				roots.add(stdout.trim());
			}
		} catch {
			// ignore non-git folders
		}
	}
	return [...roots];
}

export async function runGit(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
	return stdout ?? '';
}

export function toRepoId(root: string): string {
	return Buffer.from(root).toString('base64url');
}
