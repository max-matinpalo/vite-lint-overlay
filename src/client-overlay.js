const STYLES = `
	:host {
		position: fixed; top: 0; left: 0; z-index: 99999;
		width: 100%; height: 100%;
		pointer-events: none; display: none;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
	}
	:host([visible]) {
		display: flex; pointer-events: auto;
		background: #00000099; backdrop-filter: blur(4px);
		justify-content: center; align-items: center; padding: 20px;
	}
	.container {
		background: #1e1e1e; color: #d4d4d4;
		width: 100%; max-width: 900px; max-height: 800px;
		border-radius: 8px; border: 1px solid #333333;
		display: flex; flex-direction: column;
		box-shadow: 0 20px 50px #00000080; overflow: hidden;
	}
	.header {
		background: #252526; padding: 12px 16px;
		border-bottom: 1px solid #333333;
		display: flex; justify-content: space-between; align-items: center;
		flex-shrink: 0;
	}
	.title { font-weight: bold; font-size: 14px; color: #ffffff; }
	.close {
		cursor: pointer; background: transparent; border: none; color: #999999;
		font-size: 20px; line-height: 1; padding: 0;
	}
	.close:hover { color: #ffffff; }
	.body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
	h2 {
		margin: 0; padding: 10px 16px; font-size: 13px; font-weight: bold;
		background: #252526; border-bottom: 1px solid #333333;
		position: sticky; top: 0; z-index: 10;
		text-transform: uppercase; letter-spacing: 0.5px;
	}
	h2.red { color: #f44336; }
	h2.orange { color: #ff9800; border-top: 1px solid #333333; }
	.list { list-style: none; margin: 0; padding: 0; }
	.item {
		padding: 12px 16px; border-bottom: 1px solid #2d2d2d;
		border-left: 3px solid transparent;
		display: flex; flex-direction: column; gap: 6px;
	}
	.item.error { border-left-color: #f44336; background: #f443360d; }
	.item.warning { border-left-color: #ff9800; background: #ff98000d; }
	.meta {
		font-size: 12px; font-weight: bold; color: #888888; display: flex; align-items: center; 
		gap: 8px; font-family: Menlo, monospace;
	}
	.file { color: #aaaaaa; word-break: break-all; }
	.badge {
		padding: 3px 6px; border-radius: 4px; font-size: 10px; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.5px; color: #ffffff; background: #444444; 
	}
	.badge.ts { background: #3178c6; color: #ffffff; }
	.badge.eslint { background: #f7b93e; color: #000000; }
	.msg {
		white-space: pre-wrap; word-break: break-word; font-size: 13px; 
		line-height: 1.5; color: #cccccc; font-family: Menlo, monospace;
	}
`;


class SmartErrorOverlay extends HTMLElement {
	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
		this.root = this.shadowRoot;
	}

	connectedCallback() {
		this.root.innerHTML = `<style>${STYLES}</style><div id="mount"></div>`;
	}

	setErrors(errors) {
		if (!this.root.getElementById('mount')) this.connectedCallback();
		if (!errors || !errors.length) return this.removeAttribute('visible');
		this.setAttribute('visible', '');
		const errs = errors.filter(e => e.severity === 'error');
		const warns = errors.filter(e => e.severity === 'warning');
		const renderList = (list) => list.map(e => {
			const type = (e.source || 'unk').toLowerCase();
			const cleanFile = (e.file || 'Global').split(/\/|\\/).slice(-3).join('/');
			const hasPath = /[\\/]/.test(e.file || '');
			const fileDisplay = hasPath && cleanFile !== e.file
				? `.../${cleanFile}` : (e.file || 'Global');
			return `
				<li class="item ${e.severity || 'error'}">
					<div class="meta">
						<span class="badge ${type}">${e.source || 'UNK'}</span>
						<span class="file" title="${this.escape(e.file)}">
							${this.escape(fileDisplay)}${e.line ? ':' + e.line : ''}
						</span>
					</div>
					<div class="msg">${this.escape(e.message)}</div>
				</li>`;
		}).join('');
		this.root.getElementById('mount').innerHTML = `
			<div class="container">
				<div class="header"><span class="title">Dev Server Issues</span>
					<button id="close" class="close">×</button></div>
				<div class="body">
					${errs.length ? `<h2 class="red">Errors (${errs.length})</h2>
						<ul class="list">${renderList(errs)}</ul>` : ''}
					${warns.length ? `<h2 class="orange">Warnings (${warns.length})</h2>
						<ul class="list">${renderList(warns)}</ul>` : ''}
				</div>
			</div>`;
		this.root.getElementById('close').onclick = () => this.removeAttribute('visible');
	}

	escape(str) {
		return String(str || '').replace(/[&<>"']/g, (m) => ({
			'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
		})[m]);
	}
}


if (!customElements.get('smart-error-overlay')) {
	customElements.define('smart-error-overlay', SmartErrorOverlay);
}


if (import.meta.hot) {
	let overlay = document.querySelector('smart-error-overlay');
	if (!overlay) {
		overlay = document.createElement('smart-error-overlay');
		document.body.appendChild(overlay);
	}
	import.meta.hot.on('smart-overlay:update', (data) => {
		if (overlay) overlay.setErrors(data?.errors || []);
	});
}