import * as path from 'path';
import * as vscode from 'vscode';

type OperationType = 'addBefore' | 'removeAll' | 'editAll';
type PathRuleMode = 'ignore' | 'include';
type PathRule = {
	mode: PathRuleMode;
	path: string;
};

export function activate(context: vscode.ExtensionContext) {
	let panel: vscode.WebviewPanel | undefined;

	const runAddBefore = vscode.commands.registerCommand('add-before.run', async () => {
		if (panel) {
			panel.reveal(vscode.ViewColumn.Active);
			return;
		}

		panel = vscode.window.createWebviewPanel('addBeforeModal', 'Scoped Refactor', vscode.ViewColumn.Active, {
			enableScripts: true,
			retainContextWhenHidden: true
		});

		panel.webview.html = getModalHtml();
		panel.onDidDispose(() => {
			panel = undefined;
		});

		panel.webview.onDidReceiveMessage(async (message: unknown) => {
			if (!isActionMessage(message)) {
				return;
			}

			const operation = parseOperation(message.operation);
			const actionText = String(message.actionText ?? '').trim();
			const targetTexts = toStringArray(message.targetTexts);
			const pathRules = parsePathRules(message.pathRules);

			if (targetTexts.length === 0) {
				postResult(panel, 'Error: at least one target field is required.');
				return;
			}

			if ((operation === 'addBefore' || operation === 'editAll') && !actionText) {
				const inputName = operation === 'addBefore' ? 'Add before to...' : 'Edit all...';
				postResult(panel, `Error: "${inputName}" cannot be empty.`);
				return;
			}

			try {
				const applyChanges = message.command === 'confirm';
				const result = await analyzeWorkspace({
					operation,
					actionText,
					targetTexts,
					pathRules,
					applyChanges
				});

				if (message.command === 'preview') {
					const expectedOutput = buildExpectedOutput(operation, actionText, targetTexts);
					postResult(
						panel,
						`Potential changes (${operationLabel(operation)}): ${result.replacements} matches across ${result.filesChanged} files.\nExpected output: ${expectedOutput}`
					);
					return;
				}

				if (result.replacements === 0) {
					const expectedOutput = buildExpectedOutput(operation, actionText, targetTexts);
					postResult(panel, `No matches found for ${operationLabel(operation)} (or they were already updated).\nExpected output: ${expectedOutput}`);
					return;
				}

				const expectedOutput = buildExpectedOutput(operation, actionText, targetTexts);
				postResult(panel, `Applied ${operationLabel(operation)}: ${result.replacements} changes across ${result.filesChanged} files.\nExpected output: ${expectedOutput}`);
			} catch (error) {
				const messageText = error instanceof Error ? error.message : String(error);
				postResult(panel, `Error: ${messageText}`);
			}
		});
	});

	context.subscriptions.push(runAddBefore);
}

export function deactivate() {}

function getModalHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Add Before</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 16px;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		label {
			display: block;
			margin: 0 0 8px;
			font-weight: 600;
		}
		input, select {
			width: 100%;
			box-sizing: border-box;
			padding: 8px;
			margin-bottom: 10px;
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
		}
		.row {
			display: flex;
			gap: 8px;
			align-items: center;
			margin-bottom: 8px;
		}
		.row select {
			width: auto;
			min-width: 190px;
			margin-bottom: 0;
		}
		.row input {
			margin-bottom: 0;
			flex: 1;
		}
		.row button {
			padding: 6px 10px;
			margin-right: 0;
		}
		button {
			border: 0;
			padding: 8px 14px;
			cursor: pointer;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			margin-right: 8px;
		}
		button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.actions {
			margin-top: 8px;
		}
		#resultBox {
			width: 100%;
			box-sizing: border-box;
			margin-top: 12px;
			padding: 8px;
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			resize: vertical;
		}
	</style>
</head>
<body>
	<label for="operation">Action</label>
	<select id="operation">
		<option value="addBefore">Add before to...</option>
		<option value="removeAll">Remove all...</option>
		<option value="editAll">Edit all...</option>
	</select>

	<label id="actionTextLabel" for="actionText">Add before to...</label>
	<input id="actionText" type="text" placeholder='Example: instancia.' />

	<label>Variable / text to find</label>
	<div id="targetsContainer"></div>
	<button id="addTargetBtn" type="button" style="margin-bottom: 16px;">+ Add target</button>

	<label>Path rules</label>
	<div id="pathRulesContainer"></div>
	<button id="addPathRuleBtn" type="button" style="margin-bottom: 16px;">+ Add path rule</button>

	<div class="actions">
		<button id="previewBtn">Validate results</button>
		<button id="confirmBtn">Confirm</button>
	</div>
	<textarea id="resultBox" rows="5" readonly></textarea>

	<script>
		const vscode = acquireVsCodeApi();
		const operationSelect = document.getElementById('operation');
		const actionLabel = document.getElementById('actionTextLabel');
		const actionInput = document.getElementById('actionText');
		const targetsContainer = document.getElementById('targetsContainer');
		const pathRulesContainer = document.getElementById('pathRulesContainer');
		const addTargetBtn = document.getElementById('addTargetBtn');
		const addPathRuleBtn = document.getElementById('addPathRuleBtn');
		const previewBtn = document.getElementById('previewBtn');
		const confirmBtn = document.getElementById('confirmBtn');
		const resultBox = document.getElementById('resultBox');

		function getInputsByRole(role) {
			return Array.from(document.querySelectorAll('input[data-role="' + role + '"]'));
		}

		function getTargetInputs() {
			return getInputsByRole('target');
		}

		function getPathRuleRows() {
			return Array.from(pathRulesContainer.querySelectorAll('.row'));
		}

		function createTargetRow(value) {
			const row = document.createElement('div');
			row.className = 'row';

			const input = document.createElement('input');
			input.type = 'text';
			input.setAttribute('data-role', 'target');
			input.placeholder = 'Example: life';
			input.value = value || '';
			input.addEventListener('input', persistState);
			row.appendChild(input);

			const removeBtn = document.createElement('button');
			removeBtn.type = 'button';
			removeBtn.textContent = '-';
			removeBtn.title = 'Remove';
			removeBtn.addEventListener('click', () => {
				row.remove();
				if (getTargetInputs().length === 0) {
					createTargetRow('');
				}
				persistState();
			});
			row.appendChild(removeBtn);

			targetsContainer.appendChild(row);
		}

		function createPathRuleRow(value) {
			const row = document.createElement('div');
			row.className = 'row';

			const modeSelect = document.createElement('select');
			const ignoreOption = document.createElement('option');
			ignoreOption.value = 'ignore';
			ignoreOption.textContent = 'Ignore path';
			const includeOption = document.createElement('option');
			includeOption.value = 'include';
			includeOption.textContent = 'Only modify this path';
			modeSelect.appendChild(ignoreOption);
			modeSelect.appendChild(includeOption);
			modeSelect.value = value && value.mode === 'include' ? 'include' : 'ignore';
			modeSelect.addEventListener('change', persistState);
			row.appendChild(modeSelect);

			const input = document.createElement('input');
			input.type = 'text';
			input.setAttribute('data-role', 'pathRule');
			input.placeholder = 'Example: src/package/* or src/.../name.java/py/...';
			input.value = value && value.path ? value.path : '';
			input.addEventListener('input', persistState);
			row.appendChild(input);

			const removeBtn = document.createElement('button');
			removeBtn.type = 'button';
			removeBtn.textContent = '-';
			removeBtn.title = 'Remove';
			removeBtn.addEventListener('click', () => {
				row.remove();
				if (getPathRuleRows().length === 0) {
					createPathRuleRow({ mode: 'ignore', path: '' });
				}
				persistState();
			});
			row.appendChild(removeBtn);

			pathRulesContainer.appendChild(row);
		}

		function collectPathRules() {
			const rows = getPathRuleRows();
			return rows.map((row) => {
				const modeEl = row.querySelector('select');
				const pathEl = row.querySelector('input[data-role="pathRule"]');
				return {
					mode: modeEl ? modeEl.value : 'ignore',
					path: pathEl ? pathEl.value : ''
				};
			});
		}

		function collectState() {
			return {
				operation: operationSelect.value,
				actionText: actionInput.value,
				targetTexts: getTargetInputs().map((input) => input.value),
				pathRules: collectPathRules(),
				resultText: resultBox.value
			};
		}

		function persistState() {
			vscode.setState(collectState());
		}

		function syncOperationUI() {
			const operation = operationSelect.value;
			if (operation === 'addBefore') {
				actionLabel.textContent = 'Add before to...';
				actionInput.placeholder = 'Example: instance.';
				actionInput.disabled = false;
				return;
			}

			if (operation === 'editAll') {
				actionLabel.textContent = 'Edit all...';
				actionInput.placeholder = 'Example: player.life';
				actionInput.disabled = false;
				return;
			}

			actionLabel.textContent = 'Remove all...';
			actionInput.placeholder = 'Not required for Remove all...';
			actionInput.disabled = true;
			actionInput.value = '';
		}

		const saved = vscode.getState();
		operationSelect.value = saved && saved.operation ? saved.operation : 'addBefore';
		actionInput.value = saved && saved.actionText ? saved.actionText : '';

		const initialTargets = saved && Array.isArray(saved.targetTexts) && saved.targetTexts.length
			? saved.targetTexts
			: [''];
		initialTargets.forEach((target) => createTargetRow(target));

		const initialPathRules = saved && Array.isArray(saved.pathRules) && saved.pathRules.length
			? saved.pathRules
			: [{ mode: 'ignore', path: '' }];
		initialPathRules.forEach((pathRule) => createPathRuleRow(pathRule));

		resultBox.value = saved && saved.resultText ? saved.resultText : 'Ready.';
		syncOperationUI();

		operationSelect.addEventListener('change', () => {
			syncOperationUI();
			persistState();
		});
		actionInput.addEventListener('input', persistState);

		addTargetBtn.addEventListener('click', () => {
			createTargetRow('');
			persistState();
		});
		addPathRuleBtn.addEventListener('click', () => {
			createPathRuleRow({ mode: 'ignore', path: '' });
			persistState();
		});

		function postAction(command) {
			const payload = collectState();
			vscode.postMessage({
				command,
				operation: payload.operation,
				actionText: payload.actionText,
				targetTexts: payload.targetTexts,
				pathRules: payload.pathRules
			});
		}

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (!message || message.command !== 'result') {
				return;
			}
			resultBox.value = message.text || '';
			persistState();
		});

		previewBtn.addEventListener('click', () => postAction('preview'));
		confirmBtn.addEventListener('click', () => postAction('confirm'));
	</script>
</body>
</html>`;
}

async function analyzeWorkspace(params: {
	operation: OperationType;
	actionText: string;
	targetTexts: string[];
	pathRules: PathRule[];
	applyChanges: boolean;
}): Promise<{ replacements: number; filesChanged: number }> {
	const { operation, actionText, targetTexts, pathRules, applyChanges } = params;
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		throw new Error('Open a workspace folder first.');
	}

	const files = await vscode.workspace.findFiles(
		'**/*',
		'**/{node_modules,.git,out,dist,build,.next,.turbo,.vscode}/**'
	);

	const edit = new vscode.WorkspaceEdit();
	const uniqueTargets = [...new Set(targetTexts)];
	const patterns = uniqueTargets.map((targetText) => buildSearchPattern(targetText));
	let replacements = 0;
	let filesChanged = 0;

	for (const file of files) {
		const relativePath = normalizePath(vscode.workspace.asRelativePath(file, false));
		if (!shouldProcessPath(relativePath, pathRules)) {
			continue;
		}

		let document: vscode.TextDocument;
		try {
			document = await vscode.workspace.openTextDocument(file);
		} catch {
			continue;
		}

		const source = document.getText();
		if (document.isUntitled || document.lineCount === 0 || source.length > 1_000_000) {
			continue;
		}

		const hasAnyTarget = uniqueTargets.some((targetText) => source.includes(targetText));
		if (!hasAnyTarget) {
			continue;
		}

		let next = source;
		let fileReplacements = 0;
		for (const pattern of patterns) {
			const result = applyOperationIfNeeded(next, pattern, operation, actionText);
			next = result.text;
			fileReplacements += result.count;
		}

		if (next === source) {
			continue;
		}

		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(source.length)
		);
		if (applyChanges) {
			edit.replace(file, fullRange, next);
		}

		replacements += fileReplacements;
		filesChanged += 1;
	}

	if (applyChanges && filesChanged > 0) {
		await vscode.workspace.applyEdit(edit);
	}

	return { replacements, filesChanged };
}

function buildSearchPattern(targetText: string): RegExp {
	const escapedTarget = escapeRegExp(targetText);
	const isIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(targetText);
	const core = isIdentifier ? `\\b${escapedTarget}\\b` : escapedTarget;
	return new RegExp(core, 'g');
}

function applyOperationIfNeeded(
	source: string,
	pattern: RegExp,
	operation: OperationType,
	actionText: string
): { text: string; count: number } {
	const commentMask = createCommentMask(source);
	let count = 0;
	pattern.lastIndex = 0;

	const text = source.replace(pattern, (match: string, ...args: unknown[]) => {
		const index = Number(args[args.length - 2]);
		if (isCommentRange(commentMask, index, match.length)) {
			return match;
		}

		if (operation === 'addBefore') {
			const start = Math.max(0, index - actionText.length);
			const previous = source.slice(start, index);
			if (previous === actionText) {
				return match;
			}

			count += 1;
			return `${actionText}${match}`;
		}

		if (operation === 'removeAll') {
			count += 1;
			return '';
		}

		if (match === actionText) {
			return match;
		}

		count += 1;
		return actionText;
	});

	return { text, count };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseOperation(value: unknown): OperationType {
	const normalized = String(value ?? '').trim();
	if (normalized === 'removeAll') {
		return 'removeAll';
	}
	if (normalized === 'editAll') {
		return 'editAll';
	}
	return 'addBefore';
}

function parsePathRules(value: unknown): PathRule[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item: unknown) => {
			if (typeof item !== 'object' || item === null) {
				return null;
			}

			const maybeMode = String((item as { mode?: unknown }).mode ?? '').trim();
			const mode: PathRuleMode = maybeMode === 'include' ? 'include' : 'ignore';
			const pathValue = normalizePath(String((item as { path?: unknown }).path ?? '').trim()).replace(/^\.\//, '');
			if (!pathValue) {
				return null;
			}

			return { mode, path: pathValue };
		})
		.filter((rule: PathRule | null): rule is PathRule => rule !== null);
}

function operationLabel(operation: OperationType): string {
	if (operation === 'addBefore') {
		return 'Add before to...';
	}
	if (operation === 'removeAll') {
		return 'Remove all...';
	}
	return 'Edit all...';
}

function buildExpectedOutput(operation: OperationType, actionText: string, targetTexts: string[]): string {
	if (operation === 'addBefore') {
		return targetTexts.map((target) => actionText + target).join(', ');
	}

	if (operation === 'removeAll') {
		return targetTexts.join(', ') + ' will be removed.';
	}

	return targetTexts.map((target) => target + ' -> ' + actionText).join(', ');
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item: unknown) => String(item ?? '').trim())
		.filter((item: string) => item.length > 0);
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/');
}

function shouldProcessPath(relativePath: string, pathRules: PathRule[]): boolean {
	const includeRules = pathRules.filter((rule) => rule.mode === 'include');
	const ignoreRules = pathRules.filter((rule) => rule.mode === 'ignore');

	if (includeRules.length > 0) {
		const inIncludedPath = includeRules.some((rule) => matchesPathPattern(relativePath, rule.path));
		if (!inIncludedPath) {
			return false;
		}
	}

	const inIgnoredPath = ignoreRules.some((rule) => matchesPathPattern(relativePath, rule.path));
	return !inIgnoredPath;
}

function matchesPathPattern(relativePath: string, pattern: string): boolean {
	const basename = path.posix.basename(relativePath);
	const normalizedPattern = normalizePath(pattern);

	if (normalizedPattern.endsWith('/*')) {
		const folderPrefix = normalizedPattern.slice(0, -1);
		return relativePath.startsWith(folderPrefix);
	}

	if (normalizedPattern.includes('*')) {
		const regex = globToRegExp(normalizedPattern);
		return regex.test(relativePath);
	}

	if (normalizedPattern.includes('/')) {
		return relativePath === normalizedPattern;
	}

	return basename === normalizedPattern;
}

function globToRegExp(glob: string): RegExp {
	const escaped = escapeRegExp(glob).replace(/\\\*/g, '.*');
	return new RegExp(`^${escaped}$`);
}

function postResult(panel: vscode.WebviewPanel | undefined, text: string): void {
	if (!panel) {
		return;
	}

	panel.webview.postMessage({
		command: 'result',
		text
	});
}

function isActionMessage(
	value: unknown
): value is {
	command: 'confirm' | 'preview';
	operation?: unknown;
	actionText?: unknown;
	targetTexts?: unknown;
	pathRules?: unknown;
} {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const maybeCommand = (value as { command?: unknown }).command;
	return maybeCommand === 'confirm' || maybeCommand === 'preview';
}

function createCommentMask(source: string): Uint8Array {
	const mask = new Uint8Array(source.length);
	let i = 0;
	let inSingle = false;
	let inDouble = false;
	let inTemplate = false;

	while (i < source.length) {
		const current = source[i];
		const next = i + 1 < source.length ? source[i + 1] : '';

		if (inSingle) {
			if (current === '\\') {
				i += 2;
				continue;
			}
			if (current === '\'') {
				inSingle = false;
			}
			i += 1;
			continue;
		}

		if (inDouble) {
			if (current === '\\') {
				i += 2;
				continue;
			}
			if (current === '"') {
				inDouble = false;
			}
			i += 1;
			continue;
		}

		if (inTemplate) {
			if (current === '\\') {
				i += 2;
				continue;
			}
			if (current === '`') {
				inTemplate = false;
			}
			i += 1;
			continue;
		}

		if (current === '\'') {
			inSingle = true;
			i += 1;
			continue;
		}

		if (current === '"') {
			inDouble = true;
			i += 1;
			continue;
		}

		if (current === '`') {
			inTemplate = true;
			i += 1;
			continue;
		}

		if (current === '/' && next === '/') {
			markLineComment(mask, source, i);
			i = moveToLineEnd(source, i + 2);
			continue;
		}

		if (current === '/' && next === '*') {
			const end = markBlockComment(mask, source, i);
			i = end;
			continue;
		}

		if (current === '#' && isLineStart(source, i)) {
			markLineComment(mask, source, i);
			i = moveToLineEnd(source, i + 1);
			continue;
		}

		i += 1;
	}

	return mask;
}

function markLineComment(mask: Uint8Array, source: string, start: number): void {
	let i = start;
	while (i < source.length && source[i] !== '\n') {
		mask[i] = 1;
		i += 1;
	}
}

function markBlockComment(mask: Uint8Array, source: string, start: number): number {
	let i = start;
	mask[i] = 1;
	if (i + 1 < source.length) {
		mask[i + 1] = 1;
	}
	i += 2;
	while (i < source.length) {
		mask[i] = 1;
		if (source[i] === '*' && i + 1 < source.length && source[i + 1] === '/') {
			mask[i + 1] = 1;
			return i + 2;
		}
		i += 1;
	}
	return i;
}

function moveToLineEnd(source: string, start: number): number {
	let i = start;
	while (i < source.length && source[i] !== '\n') {
		i += 1;
	}
	return i;
}

function isLineStart(source: string, index: number): boolean {
	if (index === 0) {
		return true;
	}

	let i = index - 1;
	while (i >= 0) {
		const ch = source[i];
		if (ch === '\n' || ch === '\r') {
			return true;
		}
		if (ch !== ' ' && ch !== '\t') {
			return false;
		}
		i -= 1;
	}

	return true;
}

function isCommentRange(mask: Uint8Array, start: number, length: number): boolean {
	const end = Math.min(mask.length, start + length);
	for (let i = start; i < end; i += 1) {
		if (mask[i] === 1) {
			return true;
		}
	}
	return false;
}




